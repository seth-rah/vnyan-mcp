import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { rpc } from "../bridge.js";
import { readDedicatedList } from "../settings/read.js";
import { jsonResult, safeHandler } from "../toolHelpers.js";

export function register(server: McpServer) {
  server.registerTool(
    "vnyan_stretchbone",
    {
      title: "VNyan stretch bones",
      description:
        "'list' (disk, always readable) reads the persisted stretch bones (settings.json 'StretchBones'). " +
        "'add' (plugin, live, write-only) adds one at runtime - there is no live read-back for these, " +
        "only the persisted list. All clamp/scale/move/offset params are multipliers or local-space " +
        "offsets on the stretch bone's transform, not absolute world positions. Any field you omit uses " +
        "VNyanStretchBone's own default, listed on each param below.",
      inputSchema: {
        action: z.enum(["list", "add"]).describe("'list' reads the persisted set (disk); 'add' creates one at runtime (plugin)"),
        name: z.string().optional().describe("Required for 'add'"),
        targetName: z.string().optional().describe("Bone/object this stretch bone follows. Default \"\""),
        anchorName: z.string().optional().describe("Bone/object the stretch bone is anchored to. Default \"\""),
        stretchBoneName: z.string().optional().describe("The actual bone being stretched. Default \"\""),
        targetOffsetX: z.number().optional().describe("Target offset X, local units. Default 0"),
        targetOffsetY: z.number().optional().describe("Target offset Y, local units. Default 0"),
        targetOffsetZ: z.number().optional().describe("Target offset Z, local units. Default 0"),
        minClampX: z.number().optional().describe("Minimum scale clamp, X axis. Default 0.5"),
        minClampY: z.number().optional().describe("Minimum scale clamp, Y axis. Default 0.97"),
        minClampZ: z.number().optional().describe("Minimum scale clamp, Z axis. Default 0.5"),
        maxClampX: z.number().optional().describe("Maximum scale clamp, X axis. Default 1"),
        maxClampY: z.number().optional().describe("Maximum scale clamp, Y axis. Default 2"),
        maxClampZ: z.number().optional().describe("Maximum scale clamp, Z axis. Default 1"),
        scaleAmountX: z.number().optional().describe("How much stretch distance affects X scale. Default 0.5"),
        scaleAmountY: z.number().optional().describe("How much stretch distance affects Y scale. Default 1"),
        scaleAmountZ: z.number().optional().describe("How much stretch distance affects Z scale. Default 1"),
        moveAmountX: z.number().optional().describe("How much stretch distance affects X position. Default 0.19"),
        moveAmountY: z.number().optional().describe("How much stretch distance affects Y position. Default 0.03"),
        moveAmountZ: z.number().optional().describe("How much stretch distance affects Z position. Default 0.16"),
        offsetRotationX: z.number().optional().describe("Rotation offset X, degrees. Default 0"),
        offsetRotationY: z.number().optional().describe("Rotation offset Y, degrees. Default 0"),
        offsetRotationZ: z.number().optional().describe("Rotation offset Z, degrees. Default 0"),
        moveOffsetX: z.number().optional().describe("Move offset X, local units. Default -1"),
        moveOffsetY: z.number().optional().describe("Move offset Y, local units. Default -1"),
        moveOffsetZ: z.number().optional().describe("Move offset Z, local units. Default -1"),
        blendshapeName: z.string().optional().describe("Optional blendshape to drive from this stretch bone's motion instead of/alongside the transform. Default \"\" (unused)"),
        blendshapeAxis: z.number().optional().describe("Which axis of motion drives the blendshape (0=X, 1=Y, 2=Z). Default 0"),
        blendshapeInvert: z.boolean().optional().describe("Invert the blendshape-driving axis. Default false"),
        blendshapeMultiplier: z.number().optional().describe("Multiplier applied to the blendshape-driving value. Default 1"),
      },
    },
    safeHandler(async ({ action, ...rest }) => {
      if (action === "list") return jsonResult(await readDedicatedList("StretchBones"));
      if (!rest.name) throw new Error("'name' is required for add");
      return jsonResult(await rpc("stretchbone.add", rest));
    })
  );
}
