import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { rpc } from "../bridge.js";
import { jsonResult, safeHandler } from "../toolHelpers.js";

export function register(server: McpServer) {
  server.registerTool(
    "vnyan_param",
    {
      title: "VNyan parameters",
      description:
        "Get or set VNyan's numeric/text parameters and expand [bracketed] parameter references in a " +
        "string. These are the same parameters SetParamNode/FilterParamNode read and write in node graphs. " +
        "Source: plugin (live, read+write).",
      inputSchema: {
        action: z.enum(["getFloat", "setFloat", "getString", "setString", "fillString", "internal"])
          .describe("Which parameter operation to perform"),
        name: z.string().optional().describe("Parameter name (required for get/set actions)"),
        value: z.union([z.number(), z.string()]).optional().describe("Value to set"),
        text: z.string().optional().describe("Text containing [bracketed] parameter refs, for fillString"),
        which: z.enum(["heartbeat", "heartpercent"]).optional().describe("Which built-in, for 'internal'"),
      },
    },
    safeHandler(async ({ action, name, value, text, which }) => {
      switch (action) {
        case "getFloat":
          if (!name) throw new Error("'name' is required for getFloat");
          return jsonResult(await rpc("param.getFloat", { name }));
        case "setFloat":
          if (!name || typeof value !== "number") throw new Error("'name' and numeric 'value' are required for setFloat");
          return jsonResult(await rpc("param.setFloat", { name, value }));
        case "getString":
          if (!name) throw new Error("'name' is required for getString");
          return jsonResult(await rpc("param.getString", { name }));
        case "setString":
          if (!name || value === undefined) throw new Error("'name' and 'value' are required for setString");
          return jsonResult(await rpc("param.setString", { name, value: String(value) }));
        case "fillString":
          if (!text) throw new Error("'text' is required for fillString");
          return jsonResult(await rpc("param.fillString", { text }));
        case "internal":
          return jsonResult(await rpc("param.internal", { which: which ?? "heartbeat" }));
      }
    })
  );

  server.registerTool(
    "vnyan_dict",
    {
      title: "VNyan dictionaries",
      description:
        "Get/set/clear entries in VNyan's named dictionaries - the same store JsonDictionaryNode and " +
        "GetDictionaryValueNode use in node graphs, and where the REST API's payload lands. " +
        "Source: plugin (live, read+write).",
      inputSchema: {
        action: z.enum(["get", "set", "clear"]).describe("Which dictionary operation to perform"),
        dict: z.string().describe("Dictionary name"),
        key: z.string().optional().describe("Key (required for get/set)"),
        value: z.string().optional().describe("Value (required for set)"),
      },
    },
    safeHandler(async ({ action, dict, key, value }) => {
      switch (action) {
        case "get":
          if (!key) throw new Error("'key' is required for get");
          return jsonResult(await rpc("dict.get", { dict, key }));
        case "set":
          if (!key || value === undefined) throw new Error("'key' and 'value' are required for set");
          return jsonResult(await rpc("dict.set", { dict, key, value }));
        case "clear":
          return jsonResult(await rpc("dict.clear", { dict }));
      }
    })
  );
}
