import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { rpc } from "../bridge.js";
import { jsonResult, safeHandler } from "../toolHelpers.js";

export function register(server: McpServer) {
  server.registerTool(
    "vnyan_trigger",
    {
      title: "VNyan triggers",
      description:
        "Call, queue, or reset VNyan's named Triggers (global across all node graphs - a TriggerNode " +
        "with this name fires), and read recently-observed trigger calls. Source: plugin (live, read+write). " +
        "'recent' only sees calls made since the plugin loaded.",
      inputSchema: {
        action: z.enum(["call", "enqueue", "resetQueue", "recent"]).describe("Which trigger operation to perform"),
        name: z.string().optional().describe("Trigger name (required for call/enqueue)"),
        queue: z.string().optional().describe("Queue name (required for enqueue/resetQueue)"),
        waitTimeAfterMs: z.number().optional().describe(
          "For 'enqueue': milliseconds to wait after this item runs before the queue dequeues the next one."
        ),
        value1: z.number().optional().describe(
          "Numeric param 1, passed to the TriggerNode as a whole INTEGER (truncates fractions - " +
          "e.g. 2.5 arrives as 2). For a precise decimal, use text1-3 instead and convert on the " +
          "receiving end with a TextToDecimalNode (see vnyan_guide topic:'node-authoring')."
        ),
        value2: z.number().optional().describe("Numeric param 2 - same int-truncation caveat as value1"),
        value3: z.number().optional().describe("Numeric param 3 - same int-truncation caveat as value1"),
        text1: z.string().optional().describe("Text param 1 - a free string, use this for decimals/precise values"),
        text2: z.string().optional().describe("Text param 2 - a free string"),
        text3: z.string().optional().describe("Text param 3 - a free string"),
        limit: z.number().optional().describe("Max entries for 'recent' (default 50)"),
      },
    },
    safeHandler(async (a) => {
      switch (a.action) {
        case "call":
          if (!a.name) throw new Error("'name' is required for call");
          return jsonResult(await rpc("trigger.call", a));
        case "enqueue":
          if (!a.queue || !a.name) throw new Error("'queue' and 'name' are required for enqueue");
          return jsonResult(await rpc("trigger.enqueue", a));
        case "resetQueue":
          if (!a.queue) throw new Error("'queue' is required for resetQueue");
          return jsonResult(await rpc("trigger.resetQueue", { queue: a.queue }));
        case "recent":
          return jsonResult(await rpc("trigger.recent", { limit: a.limit ?? 50 }));
      }
    })
  );
}
