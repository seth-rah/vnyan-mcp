import fs from "node:fs/promises";
import type { GraphConnection, GraphNode, VNyanGraph } from "./model.js";

export async function readGraphFile(filePath: string): Promise<VNyanGraph> {
  const text = await fs.readFile(filePath, "utf-8");
  return JSON.parse(text) as VNyanGraph;
}

function looksEncrypted(value: string | null | undefined): boolean {
  if (!value || value.length < 40) return false;
  if (!/^[A-Za-z0-9+/=]+$/.test(value)) return false;
  try {
    const inner = Buffer.from(value, "base64").toString("ascii");
    if (!/^[A-Za-z0-9+/=]+$/.test(inner)) return false;
    const raw = Buffer.from(inner, "base64");
    // AES-ECB ciphertext: exact multiple of the 16-byte block size, no IV.
    return raw.length > 0 && raw.length % 16 === 0;
  } catch {
    return false;
  }
}

interface SocketRef {
  nodeId: string;
  nodeType: string;
  role: "execIn" | "execOut" | "valueIn" | "valueOut";
  index: number;
  key: string | null;
}

function typeName(node: GraphNode): string {
  return node.path.replace(/^Nodes\//, "");
}

function buildSocketIndex(nodes: GraphNode[]): Map<string, SocketRef> {
  const map = new Map<string, SocketRef>();
  for (const node of nodes) {
    const type = typeName(node);
    const valueKeys = node.values.map((v) => v.key);
    node.inputSocketIds.forEach((id, i) => map.set(id, { nodeId: node.id, nodeType: type, role: "execIn", index: i, key: null }));
    node.outputSocketIds.forEach((id, i) => map.set(id, { nodeId: node.id, nodeType: type, role: "execOut", index: i, key: null }));
    node.inputValueSocketIds.forEach((id, i) =>
      map.set(id, { nodeId: node.id, nodeType: type, role: "valueIn", index: i, key: valueKeys[i] ?? null })
    );
    node.outputValueSocketIds.forEach((id, i) =>
      map.set(id, { nodeId: node.id, nodeType: type, role: "valueOut", index: i, key: null })
    );
  }
  return map;
}

export interface DescribedConnection {
  from: SocketRef | null;
  to: SocketRef | null;
  fromRaw: string;
  toRaw: string;
}

export interface DescribedNode {
  id: string;
  type: string;
  posX: number;
  posY: number;
  values: Record<string, string>;
  encryptedKeys: string[];
  messageBoxText: string | null;
}

export interface DescribedGraph {
  graphName: string | null;
  graphIsActive: boolean | null;
  nodes: DescribedNode[];
  connections: DescribedConnection[];
  valueConnections: DescribedConnection[];
  blocks: { id: string; title: string; nodeIds: string[] }[];
}

export function describeGraph(graph: VNyanGraph): DescribedGraph {
  const socketIndex = buildSocketIndex(graph.nodes);

  const describedNodes: DescribedNode[] = graph.nodes.map((node) => {
    const type = typeName(node);
    const values: Record<string, string> = {};
    const encryptedKeys: string[] = [];
    for (const { key, value } of node.values) {
      if (looksEncrypted(value)) {
        encryptedKeys.push(key);
        values[key] = "<encrypted local file path>";
      } else {
        values[key] = value;
      }
    }
    return {
      id: node.id,
      type,
      posX: node.posX,
      posY: node.posY,
      values,
      encryptedKeys,
      messageBoxText: type === "MessageBoxNode" ? values["message"] ?? null : null,
    };
  });

  const describe = (c: GraphConnection): DescribedConnection => ({
    from: socketIndex.get(c.outputSocketId) ?? null,
    to: socketIndex.get(c.inputSocketId) ?? null,
    fromRaw: c.outputSocketId,
    toRaw: c.inputSocketId,
  });

  const blocksById = new Map((graph.blocks ?? []).map((b) => [b.id, b]));
  const blockNodeIds = new Map<string, string[]>();
  for (const node of graph.nodes) {
    if (node.ownerBlockId && blocksById.has(node.ownerBlockId)) {
      const arr = blockNodeIds.get(node.ownerBlockId) ?? [];
      arr.push(node.id);
      blockNodeIds.set(node.ownerBlockId, arr);
    }
  }

  return {
    graphName: graph.graphName ?? null,
    graphIsActive: graph.graphIsActive ?? null,
    nodes: describedNodes,
    connections: (graph.connections ?? []).map(describe),
    valueConnections: (graph.valueConnections ?? []).map(describe),
    blocks: Array.from(blocksById.values()).map((b) => ({
      id: b.id,
      title: b.title,
      nodeIds: blockNodeIds.get(b.id) ?? [],
    })),
  };
}
