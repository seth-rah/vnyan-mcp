import { z } from "zod";
import fs from "node:fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readDedicatedList } from "../settings/read.js";
import { writeDedicatedList } from "../settings/write.js";
import { jsonResult, safeHandler } from "../toolHelpers.js";

interface ExpressionEntry {
  name: string;
  [key: string]: unknown;
}

export function register(server: McpServer) {
  server.registerTool(
    "vnyan_expression",
    {
      title: "VNyan expressions",
      description:
        "Expression Mapper entries: input blendshape value windows (AND-gated, case-insensitive match) " +
        "that force output blendshape values when all inputs are in range. 'list'/'read' (disk, always " +
        "readable) read settings.json 'Expressions'. 'export' writes one entry out as a standalone " +
        ".vnexp JSON file. 'import' reads a .vnexp file and adds/replaces it by name in settings.json - " +
        "REQUIRES VNyan closed, same guard as vnyan_settings_set.",
      inputSchema: {
        action: z.enum(["list", "read", "export", "import"]).describe("Which expression operation to perform"),
        name: z.string().optional().describe("Expression name (required for read/export)"),
        path: z.string().optional().describe(".vnexp file path (required for import/export)"),
      },
    },
    safeHandler(async ({ action, name, path }) => {
      switch (action) {
        case "list":
          return jsonResult(await readDedicatedList("Expressions"));

        case "read": {
          if (!name) throw new Error("'name' is required for read");
          const list = (await readDedicatedList("Expressions")) as ExpressionEntry[];
          const found = list.find((e) => e?.name === name);
          if (!found) throw new Error(`no expression named '${name}'`);
          return jsonResult(found);
        }

        case "export": {
          if (!name || !path) throw new Error("'name' and 'path' are required for export");
          const list = (await readDedicatedList("Expressions")) as ExpressionEntry[];
          const found = list.find((e) => e?.name === name);
          if (!found) throw new Error(`no expression named '${name}'`);
          await fs.writeFile(path, JSON.stringify(found, null, 2), "utf-8");
          return jsonResult({ wrote: path });
        }

        case "import": {
          if (!path) throw new Error("'path' is required for import");
          const text = await fs.readFile(path, "utf-8");
          const entry = JSON.parse(text) as ExpressionEntry;
          if (!entry?.name) throw new Error(".vnexp file has no 'name' field");
          const list = (await readDedicatedList("Expressions")) as ExpressionEntry[];
          const idx = list.findIndex((e) => e?.name === entry.name);
          if (idx >= 0) list[idx] = entry;
          else list.push(entry);
          const result = await writeDedicatedList("Expressions", list);
          return jsonResult({ imported: entry.name, ...result });
        }
      }
    })
  );
}
