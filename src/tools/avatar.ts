import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { rpc } from "../bridge.js";
import { jsonResult, safeHandler } from "../toolHelpers.js";

export function register(server: McpServer) {
  server.registerTool(
    "vnyan_avatar",
    {
      title: "VNyan avatar status",
      description: "Whether an avatar is currently loaded. Source: plugin (live, read-only).",
      inputSchema: {},
    },
    safeHandler(async () => jsonResult(await rpc("avatar.loaded")))
  );

  server.registerTool(
    "vnyan_blendshape",
    {
      title: "VNyan blendshapes",
      description:
        "Read live blendshape values (all, or one by name) and set/clear override values that take " +
        "priority over tracking - the same mechanism as the Blendshape node. Source: plugin (live, read+write).",
      inputSchema: {
        action: z.enum(["list", "get", "setOverride", "clearOverride", "setMeshOverride", "clearMeshOverride"])
          .describe("Which blendshape operation to perform"),
        name: z.string().optional().describe("Blendshape name (required except for 'list')"),
        value: z.number().optional().describe(
          "0-100 (VNyan's Blendshape-node convention, not 0-1). Setting 0 removes the override entirely. " +
          "Required for set actions."
        ),
        mode: z.enum(["instant", "lastFrame"]).optional().describe("For 'get': instant value or accumulated last-frame value"),
      },
    },
    safeHandler(async ({ action, name, value, mode }) => {
      switch (action) {
        case "list":
          return jsonResult(await rpc("avatar.blendshapes"));
        case "get":
          if (!name) throw new Error("'name' is required for get");
          return jsonResult(await rpc("avatar.blendshape", { name, mode: mode ?? "instant" }));
        case "setOverride":
          if (!name || value === undefined) throw new Error("'name' and 'value' are required for setOverride");
          return jsonResult(await rpc("avatar.setBlendshapeOverride", { name, value }));
        case "clearOverride":
          if (!name) throw new Error("'name' is required for clearOverride");
          return jsonResult(await rpc("avatar.clearBlendshapeOverride", { name }));
        case "setMeshOverride":
          if (!name || value === undefined) throw new Error("'name' and 'value' are required for setMeshOverride");
          return jsonResult(await rpc("avatar.setMeshBlendshapeOverride", { name, value }));
        case "clearMeshOverride":
          if (!name) throw new Error("'name' is required for clearMeshOverride");
          return jsonResult(await rpc("avatar.clearMeshBlendshapeOverride", { name }));
      }
    })
  );

  server.registerTool(
    "vnyan_bone",
    {
      title: "VNyan bones",
      description:
        "Read a humanoid bone's current position/rotation (the composed pose from tracking/other layers, " +
        "before this plugin's own overrides), or set/clear a rotation override for it (Euler degrees). " +
        "Bone names are UnityEngine.HumanBodyBones values, e.g. 'Head', 'LeftUpperArm', 'Spine'. " +
        "Source: plugin (live, read+write). Note: reading a bone you just overrode still shows the " +
        "pre-override value - it reflects the incoming pose, not your own pending change. Full valid " +
        "bone-name list: vnyan_guide topic:'bone-names'.",
      inputSchema: {
        action: z.enum(["get", "set", "clear"]).describe("Which bone operation to perform"),
        bone: z.string().describe("HumanBodyBones name, e.g. 'Head', 'LeftUpperArm', 'Spine' - see vnyan_guide topic:'bone-names' for the full list"),
        x: z.number().optional().describe("Euler X degrees, for 'set'"),
        y: z.number().optional().describe("Euler Y degrees, for 'set'"),
        z: z.number().optional().describe("Euler Z degrees, for 'set'"),
      },
    },
    safeHandler(async ({ action, bone, x, y, z: zAxis }) => {
      switch (action) {
        case "get":
          return jsonResult(await rpc("bone.get", { bone }));
        case "set":
          return jsonResult(await rpc("bone.set", { bone, x: x ?? 0, y: y ?? 0, z: zAxis ?? 0 }));
        case "clear":
          return jsonResult(await rpc("bone.clear", { bone }));
      }
    })
  );
}
