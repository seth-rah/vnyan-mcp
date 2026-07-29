import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { rpc } from "../bridge.js";
import { readDedicatedList } from "../settings/read.js";
import { jsonResult, safeHandler } from "../toolHelpers.js";

export function register(server: McpServer) {
  server.registerTool(
    "vnyan_pendulum",
    {
      title: "VNyan pendulum chains",
      description:
        "'list' (disk, always readable) reads the pendulum chains configured in VNyan's UI (settings.json " +
        "'Chains' - spring-physics bone chains like ear/tail wiggle, each with input/output bindings). " +
        "'create'/'delete'/'setPosition'/'setRotation'/'chains' (plugin, live) manage a SEPARATE set of " +
        "chains created at runtime via this API, addressed by the numeric handle 'create' returns - they " +
        "are not the same chains as 'list' and don't persist across a VNyan restart. See " +
        "vnyan_guide topic:'pendulum-tuning' for the full physics explanation.",
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
        case "list":
          return jsonResult(await readDedicatedList("Chains"));
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
