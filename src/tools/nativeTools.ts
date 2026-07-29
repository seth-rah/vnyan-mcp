import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiFire, wsSend, oscParam } from "../native.js";
import { textResult, safeHandler } from "../toolHelpers.js";

export function register(server: McpServer) {
  server.registerTool(
    "vnyan_api_fire",
    {
      title: "Fire VNyan REST API action",
      description:
        "POSTs {action, payload} to VNyan's built-in REST API (http://localhost:8069) to trigger a " +
        "matching API Message node in a node graph. Source: native port, no plugin required. " +
        "Fire-and-forget: no return value, payload values must be strings (binds to Dictionary<string,string>).",
      inputSchema: {
        action: z.string().describe("Must match an API Message node's configured Action"),
        payload: z.record(z.string(), z.string()).optional().describe("String-only key/value pairs"),
      },
    },
    safeHandler(async ({ action, payload }) => {
      await apiFire(action, payload ?? {});
      return textResult(`Fired API action '${action}'`);
    })
  );

  server.registerTool(
    "vnyan_ws_send",
    {
      title: "Send VNyan WebSocket command",
      description:
        "Sends a plain-text '<command> <message>' frame to ws://127.0.0.1:8000/vnyan to trigger a " +
        "matching WebSocket Command node. Source: native port, no plugin required. Fire-and-forget, no JSON.",
      inputSchema: {
        command: z.string().describe("Matched against a WebSocket Command node's Command Text"),
        message: z.string().optional().describe("Rest of the payload after the command"),
      },
    },
    safeHandler(async ({ command, message }) => {
      await wsSend(command, message ?? "");
      return textResult(`Sent WebSocket command '${command}'`);
    })
  );

  server.registerTool(
    "vnyan_osc_param",
    {
      title: "Set VNyan parameter via OSC",
      description:
        "Sends a UDP OSC message to 127.0.0.1:28569 to directly set a VNyan parameter " +
        "(/VNyan/Param/Float or /VNyan/Param/String depending on the value type). " +
        "Source: native port, no plugin required. Fire-and-forget, no graph node needed.",
      inputSchema: {
        name: z.string().describe("VNyan parameter name to set"),
        value: z.union([z.number(), z.string()]).describe(
          "The value to set - a number sends /VNyan/Param/Float, a string sends /VNyan/Param/String. " +
          "The address is chosen by this value's JS type, not by anything else in the call."
        ),
      },
    },
    safeHandler(async ({ name, value }) => {
      await oscParam(name, value);
      return textResult(`Sent OSC param '${name}' = ${value}`);
    })
  );
}
