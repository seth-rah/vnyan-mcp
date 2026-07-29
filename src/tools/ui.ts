import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { rpc } from "../bridge.js";
import { jsonResult, safeHandler } from "../toolHelpers.js";

export function register(server: McpServer) {
  server.registerTool(
    "vnyan_ui",
    {
      title: "VNyan UI",
      description:
        "Read the active color theme, or open a native load/save file dialog to resolve a real local " +
        "file path (blocks until the user responds - use a generous timeout expectation). " +
        "Source: plugin (live).",
      inputSchema: {
        action: z.enum(["theme", "openLoadFileDialog", "openSaveFileDialog"]).describe("Which UI operation to perform"),
        header: z.string().optional().describe("Dialog title text shown to the user, for openLoadFileDialog/openSaveFileDialog"),
        extensions: z.array(z.string()).optional().describe("File extensions without the dot, e.g. ['png','jpg']"),
      },
    },
    safeHandler(async ({ action, header, extensions }) => {
      switch (action) {
        case "theme":
          return jsonResult(await rpc("ui.theme"));
        case "openLoadFileDialog":
          return jsonResult(await rpc("ui.openLoadFileDialog", { header, extensions }));
        case "openSaveFileDialog":
          return jsonResult(await rpc("ui.openSaveFileDialog", { header, extensions }));
      }
    })
  );

  server.registerTool(
    "vnyan_plugin_list",
    {
      title: "VNyan installed plugins",
      description:
        "Lists DLLs in Items\\Assemblies and reads their IVNyanPluginManifest metadata where present. " +
        "Source: plugin, read-only. Read-only inventory - installing a plugin DLL stays a user action.",
      inputSchema: {},
    },
    safeHandler(async () => jsonResult(await rpc("plugin.list")))
  );
}
