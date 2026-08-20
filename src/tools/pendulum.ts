import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { rpc } from "../bridge.js";
import { readDedicatedList } from "../settings/read.js";
import { jsonResult, safeHandler } from "../toolHelpers.js";

interface ChainOutput {
  gameObject?: string;
  blendshape?: string;
  negative?: string;
  param?: string;
  transform?: number;
}
interface Chain {
  name?: string;
  outputs?: ChainOutput[];
}

export interface SharedOutputTarget {
  target: string;
  kind: "gameObject" | "blendshape" | "param";
  /** Only meaningful for gameObject targets - the rotation axis that collides. */
  axis?: "X" | "Y" | "Z";
  /** Chain names, or "<chain> (xN)" where one chain writes the target more than once. */
  writers: string[];
  severity: "conflict";
  note: string;
}

const AXES = ["X", "Y", "Z"] as const;

/**
 * Finds output targets written more than once, at the granularity VNyan
 * actually keys each output kind by (all verified against decompiled source):
 *
 *   blendshape  -> BlendShapeSystem.AddOverrideBlendshape, keyed by name.
 *                  Counts whether the name appears as `blendshape` (positive
 *                  direction) or `negative` - both write it.
 *   gameObject  -> PosRotSystem.SetAddChainRotation, keyed by
 *                  (name.ToLower(), transform). Separate axes write separate
 *                  xValue/yValue/zValue fields, so the SAME object on
 *                  DIFFERENT axes is not a conflict.
 *   param       -> ParamSystem set, keyed by name.
 *
 * All three assign rather than accumulate, despite two of them being named
 * "Add…", so a second writer overwrites the first every frame.
 *
 * Duplicate writes from within a single chain count: one chain driving one
 * blendshape from two different bones self-clashes exactly the same way.
 */
export function findSharedOutputTargets(chains: Chain[]): SharedOutputTarget[] {
  interface Group {
    kind: SharedOutputTarget["kind"];
    target: string;
    axis?: "X" | "Y" | "Z";
    writers: Map<string, number>;
  }
  const groups = new Map<string, Group>();

  const add = (key: string, group: Omit<Group, "writers">, writer: string) => {
    let g = groups.get(key);
    if (!g) {
      g = { ...group, writers: new Map() };
      groups.set(key, g);
    }
    g.writers.set(writer, (g.writers.get(writer) ?? 0) + 1);
  };

  chains.forEach((chain, i) => {
    const writer = chain?.name?.trim() || `(unnamed chain #${i})`;
    for (const out of chain?.outputs ?? []) {
      // Real configs have been seen with stray leading whitespace/tabs in
      // blendshape names, so normalize before grouping or one target reads as
      // two.
      const bs = out.blendshape?.trim();
      const neg = out.negative?.trim();
      const obj = out.gameObject?.trim();
      const param = out.param?.trim();

      if (bs) add(`bs:${bs}`, { kind: "blendshape", target: bs }, writer);
      // A chain using the same name for both directions (absolute-value
      // semantics) is one writer, not two - don't count it twice.
      if (neg && neg !== bs) add(`bs:${neg}`, { kind: "blendshape", target: neg }, writer);

      if (obj) {
        const t = out.transform ?? 0;
        const axis = AXES[t] ?? undefined;
        add(`go:${obj.toLowerCase()}:${t}`, { kind: "gameObject", target: obj, axis }, writer);
      }

      if (param) add(`p:${param}`, { kind: "param", target: param }, writer);
    }
  });

  const noteFor = (g: Group, writerCount: number): string => {
    const where =
      g.kind === "gameObject"
        ? `this GameObject's ${g.axis ?? "selected"} rotation axis`
        : g.kind === "blendshape"
          ? "this blendshape"
          : "this parameter";
    const terminal =
      g.kind === "gameObject"
        ? "a single ObjectRotNode (set all three axes together - it zeroes any axis you omit)"
        : g.kind === "blendshape"
          ? "a single BlendshapeNode per shape (a signed pair needs a FilterParamNode sign split - see the guide)"
          : "whatever single node consumes it";
    return (
      `CONFLICT: ${writerCount} writer(s) drive ${where} directly, so they overwrite each other ` +
      `every frame and the motion cancels out. Only one pendulum may write a target directly. Fix by ` +
      `clearing the direct output field on each, giving each output its OWN unique 'param', summing ` +
      `those params in a node graph, and applying the total with ${terminal}. ` +
      `See vnyan_guide topic:'pendulum-composition'.`
    );
  };

  const shared: SharedOutputTarget[] = [];
  for (const g of groups.values()) {
    const total = [...g.writers.values()].reduce((a, b) => a + b, 0);
    if (total < 2) continue;
    shared.push({
      target: g.target,
      kind: g.kind,
      ...(g.axis ? { axis: g.axis } : {}),
      writers: [...g.writers.entries()]
        .map(([name, n]) => (n > 1 ? `${name} (x${n})` : name))
        .sort(),
      severity: "conflict",
      note: noteFor(g, total),
    });
  }

  const kindOrder = { gameObject: 0, blendshape: 1, param: 2 } as const;
  return shared.sort(
    (a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.target.localeCompare(b.target)
  );
}

export function register(server: McpServer) {
  server.registerTool(
    "vnyan_pendulum",
    {
      title: "VNyan pendulum chains",
      description:
        "'list' (disk, always readable) reads the pendulum chains configured in VNyan's UI (settings.json " +
        "'Chains') and reports every output target written more than once in 'sharedOutputTargets'. " +
        "'create'/'delete'/'setPosition'/'setRotation'/'chains' (plugin, live) manage a SEPARATE set of " +
        "chains created at runtime via this API, addressed by the numeric handle 'create' returns - they " +
        "are not the same chains as 'list' and don't persist across a VNyan restart. " +
        "CRITICAL CONSTRAINT: only ONE pendulum may write a given output target directly. VNyan assigns " +
        "rather than accumulates on all three output paths, so a second writer overwrites the first every " +
        "frame and the motion cancels out - a routing problem no damping/elasticity tuning will fix. The " +
        "granularity differs per kind: blendshapes key on NAME (and a name counts as written whether it " +
        "appears as an output's 'blendshape' or its 'negative'); GameObjects key on (name, transform axis), " +
        "so the same object on DIFFERENT axes does NOT clash; parameters key on name, so two outputs must " +
        "never share a 'param'. To layer several pendulums on one target: clear the direct output field on " +
        "each, give each output its own unique 'param', sum those in a node graph, and apply the total with " +
        "a single node - ObjectRotNode for transforms (set all three axes together, it zeroes omitted " +
        "ones), or for a SIGNED blendshape pair a FilterParamNode sign split into two BlendshapeNodes, " +
        "since one BlendshapeNode cannot drive two different shapes. Read vnyan_guide " +
        "topic:'pendulum-composition' for the verified recipe and the full field-by-field data model " +
        "BEFORE changing a chain's outputs. See vnyan_guide topic:'pendulum-tuning' for the spring params.",
      inputSchema: {
        action: z.enum(["list", "create", "delete", "setPosition", "setRotation", "chains"])
          .describe("Which pendulum operation to perform"),
        handle: z.number().optional().describe("Handle from a prior 'create' (required for all but 'create')"),
        boneCount: z.number().optional().describe("For 'create'. Typical chains use 2-4 bones. Default 4"),
        damping: z.number().optional().describe(
          "How fast motion decays, 0-1 (hard-clamped by VNyan). Default 0.1. Higher = settles sooner. " +
          "For 'create', at runtime creation time only."
        ),
        elasticity: z.number().optional().describe(
          "Restoring force pulling each bone back to its rest position, 0-1 (hard-clamped). Default 0.1. " +
          "LOWER = floppier / more swing-bounce; higher = snaps back fast - it's a return-strength, not a " +
          "bounce-amount, so low values look bouncier. Applies uniformly across the whole chain (VNyan does " +
          "not use per-bone distribution curves), though motion naturally accumulates toward the chain tip. " +
          "For 'create', at runtime creation time only."
        ),
        stiffness: z.number().optional().describe(
          "Resistance to being rotated away from the rest orientation, 0-1 (hard-clamped). Default 0.1. " +
          "For 'create', at runtime creation time only."
        ),
        inert: z.number().optional().describe(
          "How rigidly the chain FOLLOWS the avatar's own movement, 0-1 (hard-clamped). Default 0. " +
          "Reads backwards from the name, so mind the direction: DynamicBone integrates " +
          "'position += velocity*(1-damping) + gravity + objectMove*inert', i.e. the object's motion is " +
          "ADDED to each particle in proportion to inert. 1 = the chain travels with the avatar, so moving " +
          "or turning it induces NO swing; 0 = the chain ignores the avatar, so avatar motion produces " +
          "MAXIMUM swing. Raise it when head movement shakes a chain that should only react to its own " +
          "input value. For 'create', at runtime creation time only."
        ),
        value: z.number().optional().describe(
          "Drive value for setPosition/setRotation - setPosition makes the pendulum swing back and forth " +
          "as this value changes over repeated calls; setRotation swings it to this angle and holds it there."
        ),
      },
    },
    safeHandler(async (a) => {
      switch (a.action) {
        case "list": {
          const chains = (await readDedicatedList("Chains")) as Chain[];
          return jsonResult({ chains, sharedOutputTargets: findSharedOutputTargets(chains) });
        }
        case "create":
          return jsonResult(await rpc("pendulum.create", a));
        case "delete":
          if (a.handle === undefined) throw new Error("'handle' is required for delete");
          return jsonResult(await rpc("pendulum.delete", { handle: a.handle }));
        case "setPosition":
          if (a.handle === undefined || a.value === undefined) throw new Error("'handle' and 'value' are required for setPosition");
          return jsonResult(await rpc("pendulum.setPosition", { handle: a.handle, value: a.value }));
        case "setRotation":
          if (a.handle === undefined || a.value === undefined) throw new Error("'handle' and 'value' are required for setRotation");
          return jsonResult(await rpc("pendulum.setRotation", { handle: a.handle, value: a.value }));
        case "chains":
          if (a.handle === undefined) throw new Error("'handle' is required for chains");
          return jsonResult(await rpc("pendulum.chains", { handle: a.handle }));
      }
    })
  );
}
