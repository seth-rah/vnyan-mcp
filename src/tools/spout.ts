import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { rpc } from "../bridge.js";
import { jsonResult, safeHandler } from "../toolHelpers.js";

export function register(server: McpServer) {
  server.registerTool(
    "vnyan_spout",
    {
      title: "VNyan Spout2 cameras",
      description:
        "List Spout2 output cameras, or add a new one. Source: plugin (live, read+write). There is no " +
        "safe runtime way to remove a Spout2 camera - do that from VNyan's own Spout2 Cameras panel.",
      inputSchema: {
        action: z.enum(["listCameras", "addCamera"]).describe("Which Spout2 operation to perform"),
        name: z.string().optional().describe("Camera/Spout output name (required for addCamera)"),
        width: z.number().optional().describe("Render width in pixels. Default 1920"),
        height: z.number().optional().describe("Render height in pixels. Default 1080"),
        linkToMainCamera: z.boolean().optional().describe(
          "If true, this camera follows the main VNyan camera's position/rotation/FOV every frame " +
          "(posX/Y/Z, rotX/Y/Z, focalLength below are then ignored). Default true."
        ),
        posX: z.number().optional().describe("Camera position X, world units. Ignored if linkToMainCamera. Default 0"),
        posY: z.number().optional().describe("Camera position Y, world units. Ignored if linkToMainCamera. Default 0"),
        posZ: z.number().optional().describe("Camera position Z, world units. Ignored if linkToMainCamera. Default 0"),
        rotX: z.number().optional().describe("Camera rotation X, Euler degrees. Ignored if linkToMainCamera. Default 0"),
        rotY: z.number().optional().describe("Camera rotation Y, Euler degrees. Ignored if linkToMainCamera. Default 0"),
        rotZ: z.number().optional().describe("Camera rotation Z, Euler degrees. Ignored if linkToMainCamera. Default 0"),
        focalLength: z.number().optional().describe("Camera focal length (FOV). Ignored if linkToMainCamera. Default 35"),
        flag1: z.boolean().optional().describe(
          "4th positional bool arg to VNyan's AddCamera - meaning not identified (obfuscated signature). Default false."
        ),
        flag2: z.boolean().optional().describe("5th positional bool arg to AddCamera - meaning not identified. Default false."),
        flag3: z.boolean().optional().describe("6th positional bool arg to AddCamera - meaning not identified. Default false."),
        flag4: z.boolean().optional().describe("7th positional bool arg to AddCamera - meaning not identified. Default false."),
      },
    },
    safeHandler(async ({ action, name, ...rest }) => {
      if (action === "listCameras") return jsonResult(await rpc("spout.listCameras"));
      if (!name) throw new Error("'name' is required for addCamera");
      return jsonResult(await rpc("spout.addCamera", { name, ...rest }));
    })
  );
}
