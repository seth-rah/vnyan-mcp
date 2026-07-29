import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GUIDE_TOPICS, TOPIC_SUMMARIES, getGuideTopic } from "../docs.js";
import { jsonResult, textResult, safeHandler } from "../toolHelpers.js";

export function register(server: McpServer) {
  server.registerTool(
    "vnyan_guide",
    {
      title: "VNyan MCP reference guide",
      description:
        "Long-form reference documentation for this MCP - node-authoring rules and the runtime type-" +
        "safety gotcha, the full bone-name list, a live settings.json key index, pendulum physics " +
        "semantics, the restart policy, and known limits. Omit 'topic' to list what's available. " +
        "The same content is also published as MCP resources under vnyan://guide/<topic>.",
      inputSchema: {
        topic: z.enum(GUIDE_TOPICS).optional().describe("Which guide topic to read - omit to list all topics"),
      },
    },
    safeHandler(async ({ topic }) => {
      if (!topic) {
        return jsonResult(
          GUIDE_TOPICS.map((t) => ({ topic: t, summary: TOPIC_SUMMARIES[t] }))
        );
      }
      return textResult(await getGuideTopic(topic));
    })
  );
}
