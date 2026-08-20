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
}
interface Chain {
  name?: string;
  outputs?: ChainOutput[];
}

export interface SharedOutputTarget {
  target: string;
  kind: "gameObject" | "blendshape";
  chains: string[];
  severity: "conflict" | "review";
  note: string;
}

/**
 * Finds output targets written by more than one pendulum chain.
 *
 * gameObject collisions are a confirmed conflict - VNyan's developer states
 * only one pendulum may be linked directly to a GameObject, and stacking them
 * makes the motion cancel out. Blendshape overlap is only flagged for review:
 * the developer's statement covers GameObjects, and real rigs legitimately
 * layer several chains onto one blendshape, so calling those broken would be
 * wrong.
 */
export function findSharedOutputTargets(chains: Chain[]): SharedOutputTarget[] {
  const byTarget = new Map<string, { kind: "gameObject" | "blendshape"; chains: Set<string> }>();

  chains.forEach((chain, i) => {
    const chainName = chain?.name?.trim() || `(unnamed chain #${i})`;
    for (const out of chain?.outputs ?? []) {
      const targets: [string | undefined, "gameObject" | "blendshape"][] = [
        [out.gameObject, "gameObject"],
        [out.blendshape, "blendshape"],
        [out.negative, "blendshape"],
      ];
      for (const [raw, kind] of targets) {
        // Blendshape names have been observed with stray leading whitespace in
        // real configs, so normalize before grouping or the same target reads
        // as two different ones.
        const target = raw?.trim();
        if (!target) continue;
        const key = `${kind}:${target}`;
        if (!byTarget.has(key)) byTarget.set(key, { kind, chains: new Set() });
        byTarget.get(key)!.chains.add(chainName);
      }
    }
  });

  const shared: SharedOutputTarget[] = [];
  for (const [key, { kind, chains: names }] of byTarget) {
    if (names.size < 2) continue;
    const target = key.slice(key.indexOf(":") + 1);
    shared.push({
      target,
      kind,
      chains: [...names].sort(),
      severity: kind === "gameObject" ? "conflict" : "review",
      note:
        kind === "gameObject"
          ? "CONFLICT: only one pendulum may drive a GameObject directly - these will cancel each other " +
            "out. Fix by clearing 'gameObject' on each, giving each a unique 'param', and summing those " +
            "params in a node graph. See vnyan_guide topic:'pendulum-composition'."
          : "Review: several chains write this blendshape. That is often deliberate layering rather than a " +
            "bug (VNyan's one-per-target rule is documented for GameObjects), but if the motion looks like " +
            "it is fighting itself, the same param-and-sum pattern applies - see vnyan_guide " +
            "topic:'pendulum-composition'.",
    });
  }
  return shared.sort((a, b) => (a.severity === b.severity ? a.target.localeCompare(b.target) : a.severity === "conflict" ? -1 : 1));
}

export function register(server: McpServer) {
  server.registerTool(
    "vnyan_pendulum",
    {
      title: "VNyan pendulum chains",
      description:
        "'list' (disk, always readable) reads the pendulum chains configured in VNyan's UI (settings.json " +
        "'Chains' - spring-physics bone chains like ear/tail wiggle, each with input/output bindings), and " +
        "also reports any output target driven by more than one chain in 'sharedOutputTargets'. " +
        "'create'/'delete'/'setPosition'/'setRotation'/'chains' (plugin, live) manage a SEPARATE set of " +
        "chains created at runtime via this API, addressed by the numeric handle 'create' returns - they " +
        "are not the same chains as 'list' and don't persist across a VNyan restart. " +
        "CRITICAL CONSTRAINT: only ONE pendulum may be linked directly to a given GameObject. Two " +
        "pendulums pointing at the same target fight each other and their motion cancels out - a routing " +
        "problem that no amount of damping/elasticity tuning will fix. To layer several pendulums onto one " +
        "target, leave each pendulum's 'gameObject' empty, give each a unique 'param', and sum those " +
        "parameters in a node graph before applying them with a SINGLE ObjectRotNode (which zeroes any " +
        "axis you omit, so all three must be set together). Read vnyan_guide " +
        "topic:'pendulum-composition' for the full working recipe BEFORE adding a pendulum to a target " +
        "that already has one. See vnyan_guide topic:'pendulum-tuning' for the physics parameters.",
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
          "How much of the avatar's own movement is transferred into the chain, 0-1 (hard-clamped). " +
          "Default 0. For 'create', at runtime creation time only."
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
