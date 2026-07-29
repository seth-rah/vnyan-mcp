import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readDedicatedList } from "../settings/read.js";
import { jsonResult, safeHandler } from "../toolHelpers.js";

export function register(server: McpServer) {
  server.registerTool(
    "vnyan_gesture",
    {
      title: "VNyan hand gestures",
      description:
        "Lists configured hand gestures (settings.json 'Gestures' - recorded per-finger curl thresholds " +
        "for each hand). Source: disk, read-only: gestures are recognized from hand tracking " +
        "(GestureNode/FilterGestureNode read them) but nothing in VNyan's node system or plugin API can " +
        "set/fire one programmatically.",
      inputSchema: {},
    },
    safeHandler(async () => jsonResult(await readDedicatedList("Gestures")))
  );
}
