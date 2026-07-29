import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { rpc } from "../bridge.js";
import { readDedicatedList } from "../settings/read.js";
import { jsonResult, safeHandler } from "../toolHelpers.js";

export function register(server: McpServer) {
  server.registerTool(
    "vnyan_prop",
    {
      title: "VNyan props",
      description:
        "List configured props (disk, always readable), or set/toggle an existing prop's visibility by " +
        "name (plugin, live - the same as the Toggle Prop node / a prop's Twitch redeem).",
      inputSchema: {
        action: z.enum(["list", "set", "toggle"]).describe("Which prop operation to perform"),
        name: z.string().optional().describe("Prop name (required for set/toggle)"),
        active: z.boolean().optional().describe("For 'set': true to show, false to hide (default true)"),
      },
    },
    safeHandler(async ({ action, name, active }) => {
      switch (action) {
        case "list":
          return jsonResult(await readDedicatedList("Props"));
        case "set":
          if (!name) throw new Error("'name' is required for set");
          return jsonResult(await rpc("prop.set", { name, active: active ?? true }));
        case "toggle":
          if (!name) throw new Error("'name' is required for toggle");
          return jsonResult(await rpc("prop.toggle", { name }));
      }
    })
  );
}
