import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listGraphs } from "../graph/list.js";
import { readGraphFile, describeGraph } from "../graph/read.js";
import { redeemsPaths } from "../settings/paths.js";
import { GraphBuilder, writeGraphToSlot } from "../graph/build.js";
import { lookupNodeType, allNodeTypes, schemaMetadata } from "../graph/schema.js";
import { getGraphExportDir } from "../config.js";
import { jsonResult, safeHandler } from "../toolHelpers.js";
import type { VNyanGraph } from "../graph/model.js";

const nodeSpecSchema = z.object({
  id: z.string().describe("Caller-chosen id, referenced by connections below - not written to the VNyan graph file"),
  type: z.string().describe("Node type, e.g. 'CallTriggerNode' - see vnyan_node_schema"),
  values: z.record(z.string(), z.string()).optional().describe(
    "Literal values[] entries not driven by a wired socket, e.g. {triggerName: 'foo'}. All values are " +
    "strings even for numbers/booleans (VNyan's own convention, e.g. \"1\"/\"0\" for booleans)."
  ),
});

const execConnectionSchema = z.object({
  from: z.string().describe("A node id from the 'nodes' array - the execution-flow SOURCE"),
  fromIndex: z.number().optional().describe("execOut socket index on the source node, default 0"),
  to: z.string().describe("A node id from the 'nodes' array - the execution-flow TARGET"),
  toIndex: z.number().optional().describe("execIn socket index on the target node, default 0"),
});

const valueConnectionSchema = z.object({
  from: z.string().describe("A node id from the 'nodes' array - the value SOURCE (e.g. a converter node or a trigger's value output)"),
  fromIndex: z.number().optional().describe("outputValueSocket index on the source node, default 0"),
  to: z.string().describe("A node id from the 'nodes' array - the value TARGET (e.g. an effect node's parameter input)"),
  toIndex: z.number().describe(
    "inputValueSocket index on the target node - see vnyan_node_schema. IMPORTANT: value sockets are " +
    "strongly typed at runtime even though values[] is always strings in the saved JSON - wiring a raw " +
    "int/text output straight into a float/bool input throws inside VNyan and silently aborts the whole " +
    "call (no error surfaces anywhere but VNyan's own log). Route through a 'TextToDecimalNode' (text -> " +
    "float) or 'TextToBoolNode' (text -> bool) in between. See vnyan_guide topic:'node-authoring'."
  ),
});

type NodeSpec = z.infer<typeof nodeSpecSchema>;
type ExecConnectionSpec = z.infer<typeof execConnectionSchema>;
type ValueConnectionSpec = z.infer<typeof valueConnectionSchema>;

function buildGraphFromSpec(
  graphName: string,
  nodes: NodeSpec[],
  connections: ExecConnectionSpec[] | undefined,
  valueConnections: ValueConnectionSpec[] | undefined
): VNyanGraph {
  const builder = new GraphBuilder();
  const handles = new Map<string, ReturnType<GraphBuilder["addNode"]>>();
  for (const n of nodes) {
    if (handles.has(n.id)) throw new Error(`duplicate node id '${n.id}'`);
    handles.set(n.id, builder.addNode(n.type, n.values ?? {}));
  }
  const resolve = (id: string) => {
    const h = handles.get(id);
    if (!h) throw new Error(`connection references unknown node id '${id}'`);
    return h;
  };
  for (const c of connections ?? []) {
    const from = resolve(c.from);
    const to = resolve(c.to);
    const fromSocket = from.execOut[c.fromIndex ?? 0];
    const toSocket = to.execIn[c.toIndex ?? 0];
    if (!fromSocket) throw new Error(`node '${c.from}' has no execOut socket at index ${c.fromIndex ?? 0}`);
    if (!toSocket) throw new Error(`node '${c.to}' has no execIn socket at index ${c.toIndex ?? 0}`);
    builder.connectExec(fromSocket, toSocket);
  }
  for (const c of valueConnections ?? []) {
    const from = resolve(c.from);
    const to = resolve(c.to);
    const fromSocket = from.valueOut[c.fromIndex ?? 0];
    const toSocket = to.valueIn[c.toIndex];
    if (!fromSocket) throw new Error(`node '${c.from}' has no outputValueSocket at index ${c.fromIndex ?? 0}`);
    if (!toSocket) throw new Error(`node '${c.to}' has no inputValueSocket at index ${c.toIndex}`);
    builder.connectValue(fromSocket, toSocket);
  }
  return builder.toGraph(graphName);
}

export function register(server: McpServer) {
  server.registerTool(
    "vnyan_graph_list",
    {
      title: "List VNyan node graphs",
      description:
        "Lists the node-graph tabs (redeems.json, redeems1.json, ...) with their name, active flag, and " +
        "node count. Source: disk, always readable.",
      inputSchema: {},
    },
    safeHandler(async () => jsonResult(await listGraphs()))
  );

  server.registerTool(
    "vnyan_graph_read",
    {
      title: "Read a VNyan node graph",
      description:
        "Parses one graph slot and resolves every connection to (node type, socket role, index) pairs, " +
        "decodes MessageBoxNode documentation text, and flags AES-encrypted local-file-path values " +
        "instead of dumping their ciphertext. Source: disk, always readable.",
      inputSchema: {
        slot: z.number().describe("0 = redeems.json, 1 = redeems1.json, 2 = redeems2.json, ..."),
      },
    },
    safeHandler(async ({ slot }) => {
      const { main } = (await redeemsPaths(slot + 1))[slot];
      const graph = await readGraphFile(main);
      return jsonResult(describeGraph(graph));
    })
  );

  server.registerTool(
    "vnyan_node_schema",
    {
      title: "VNyan node type schema",
      description:
        "Looks up a node type's socket layout (exec-in/out and value-in/out counts, field names in " +
        "socket order, and the `values[]` keys VNyan writes by default) - or lists all known node types " +
        "when 'type' is omitted. Derived by decompiling Assembly-CSharp and extracting each node class's " +
        "declared socket fields; `possiblyIncomplete: true` means the values[] key list may be missing " +
        "one entry (usually an encrypted file-path field). Source: bundled reference data (offline, no " +
        "VNyan connection needed).",
      inputSchema: {
        type: z.string().optional().describe("e.g. 'CallTriggerNode' - omit to list all ~300 known types"),
      },
    },
    safeHandler(async ({ type }) => {
      if (!type) return jsonResult({ meta: schemaMetadata(), types: allNodeTypes() });
      const schema = lookupNodeType(type);
      if (!schema) throw new Error(`unknown node type: '${type}'`);
      return jsonResult(schema);
    })
  );

  server.registerTool(
    "vnyan_graph_write",
    {
      title: "Author a VNyan node graph",
      description:
        "Builds a node graph from a friendly spec (nodes with caller-chosen ids + literal values, " +
        "exec/value connections referencing those ids). By default (no 'slot') it EXPORTS the graph as " +
        "a plain JSON file - import it into VNyan live via its own 'Load Graph' menu (replaces the " +
        "currently active tab, VNyan stays running, no restart). Pass 'slot' instead to write directly " +
        "into that graph slot (redeemsN.json + its asredeemsN.json mirror), REPLACING its contents - " +
        "this REQUIRES VNyan closed (same guard as vnyan_settings_set) and backs up the slot first; use " +
        "it only when VNyan is already closed for other reasons. " +
        "Most action nodes have zero execOut sockets (check vnyan_node_schema) - they are terminal, not " +
        "links in a serial chain. To run several actions off one event/trigger, fan its single execOut " +
        "out to each action's execIn directly, rather than chaining action-to-action. " +
        "Node-value file-path fields (sound/avatar files) can't be set as literals here since VNyan " +
        "encrypts them - wire a SetTextParamNode/TextReplaceNode into that value socket instead, the " +
        "same pattern VNyan's own Crowd Control example graph uses. " +
        "VALUE SOCKETS ARE STRONGLY TYPED AT RUNTIME despite values[] always being strings in the saved " +
        "JSON - wiring a raw int/text output straight into a float/bool input throws inside VNyan and " +
        "silently aborts the whole call (see valueConnections.toIndex below). If writing directly to a " +
        "slot, VNyan only EXECUTES slots covered by settings.json 'NodeGraphCount' - a graph placed beyond " +
        "that count loads with no error but never runs; use vnyan_settings_get area:'misc' to check it " +
        "first. If using the default export+Load-Graph workflow instead, note VNyan's live Load Graph " +
        "updates the running graph immediately but only writes it to redeemsN.json on VNyan's own quit - " +
        "vnyan_graph_read can lag behind what's actually loaded until then. Full cookbook: vnyan_guide " +
        "topic:'node-authoring'.",
      inputSchema: {
        graphName: z.string().describe("Display name for the graph tab"),
        nodes: z.array(nodeSpecSchema).min(1).describe("Every node in the graph"),
        connections: z.array(execConnectionSchema).optional().describe(
          "Execution-flow wiring. Most action nodes have ZERO execOut sockets (check vnyan_node_schema) - " +
          "they are terminal, not links in a chain. To run several actions off one event, add one " +
          "connection per action from that same event node, rather than chaining action-to-action."
        ),
        valueConnections: z.array(valueConnectionSchema).optional().describe(
          "Data-flow wiring between value sockets - see valueConnections.toIndex for the critical type-safety rule."
        ),
        slot: z.number().optional().describe("Advanced/fallback: write directly into this slot instead of exporting a file. REQUIRES VNyan closed."),
        exportFileName: z.string().optional().describe("File name for the export (default: graphName + '.json'), written under the configured export directory"),
      },
    },
    safeHandler(async ({ graphName, nodes, connections, valueConnections, slot, exportFileName }) => {
      const graph = buildGraphFromSpec(graphName, nodes, connections, valueConnections);

      if (slot !== undefined) {
        const result = await writeGraphToSlot(slot, graph);
        return jsonResult({ mode: "slot", ...result });
      }

      const exportDir = await getGraphExportDir();
      await fs.mkdir(exportDir, { recursive: true });
      const fileName = exportFileName ?? `${graphName}.json`;
      const filePath = path.join(exportDir, fileName);
      await fs.writeFile(filePath, JSON.stringify(graph, null, 2), "utf-8");
      return jsonResult({
        mode: "export",
        file: filePath,
        instructions: `Wrote to ${filePath} - in VNyan, open the graph tab to replace and use its 'Load Graph' action to import this file.`,
      });
    })
  );
}
