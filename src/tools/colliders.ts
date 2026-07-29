import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { rpc } from "../bridge.js";
import { listColliderOverrides } from "../settings/read.js";
import { jsonResult, safeHandler } from "../toolHelpers.js";

export function register(server: McpServer) {
  server.registerTool(
    "vnyan_collider",
    {
      title: "VNyan avatar colliders",
      description:
        "Read or set the current avatar's head/torso/hand collider size and offset - 'get'/'set' are " +
        "live (plugin) and take effect immediately, VNyan re-applies these every frame. 'diskList' " +
        "(disk, always readable) lists every per-avatar override file under colliders\\, since the " +
        "currently-loaded avatar's filename isn't otherwise exposed - compare against 'get' to see " +
        "whether the running values match a saved override.",
      inputSchema: {
        action: z.enum(["get", "set", "diskList"]).describe("Which collider operation to perform"),
        headSize: z.number().optional().describe(
          "Head collider scale multiplier (Unity world-space, not pixels/percent). Typical value ~0.2 " +
          "(this avatar's is 0.207). For 'set' only."
        ),
        headOffset: z.number().optional().describe(
          "Head collider offset along the head's up-axis, world units. Typical value ~0.06. For 'set' only."
        ),
        torsoSize: z.number().optional().describe(
          "Torso collider scale multiplier, world-space. Typical value ~0.27. For 'set' only."
        ),
        torsoOffset: z.number().optional().describe(
          "Torso collider vertical offset, world units. Typical value ~0.04. For 'set' only."
        ),
        handSize: z.number().optional().describe(
          "Hand collider scale multiplier, world-space. Default 0.19. For 'set' only."
        ),
      },
    },
    safeHandler(async ({ action, ...rest }) => {
      if (action === "get") return jsonResult(await rpc("collider.get"));
      if (action === "diskList") return jsonResult(await listColliderOverrides());
      return jsonResult(await rpc("collider.set", rest));
    })
  );
}
