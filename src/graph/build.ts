import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { requireVNyanClosed } from "../settings/processGuard.js";
import { redeemsPaths, getBackupDir } from "../settings/paths.js";
import { lookupNodeType, nodePath } from "./schema.js";
import type { GraphNode, GraphConnection, VNyanGraph } from "./model.js";

function newGuid(): string {
  return crypto.randomUUID();
}

// Doesn't need to be a REAL .NET DateTime.Ticks value - only a stable,
// distinct suffix per node so sockets created together are recognizably
// grouped, matching the shape VNyan itself writes (guid + digit run).
let socketCounter = 0;
function newSocketId(): string {
  socketCounter += 1;
  return `${newGuid()}${Date.now()}${socketCounter}`;
}

export interface NodeHandle {
  id: string;
  execIn: string[];
  execOut: string[];
  valueIn: string[];
  valueOut: string[];
}

export class GraphBuilder {
  private nodes: GraphNode[] = [];
  private connections: GraphConnection[] = [];
  private valueConnections: GraphConnection[] = [];
  private nextX = 0;
  private nextY = 0;

  addNode(typeName: string, values: Record<string, string> = {}): NodeHandle {
    const schema = lookupNodeType(typeName);
    if (!schema) throw new Error(`unknown node type: '${typeName}' (not in graph/schema.json - see vnyan_node_schema)`);

    const id = newGuid();
    const execIn = Array.from({ length: schema.execIn }, () => newSocketId());
    const execOut = Array.from({ length: schema.execOut }, () => newSocketId());
    const valueIn = Array.from({ length: schema.valueIn }, () => newSocketId());
    const valueOut = Array.from({ length: schema.valueOut }, () => newSocketId());

    const valuesArray = Object.entries(values).map(([key, value]) => ({ key, value: String(value) }));

    this.nodes.push({
      id,
      values: valuesArray,
      posX: this.nextX,
      posY: this.nextY,
      path: nodePath(typeName),
      ownerBlockId: "",
      inputSocketIds: execIn,
      outputSocketIds: execOut,
      headerColor: 0,
      inputValueSocketIds: valueIn,
      outputValueSocketIds: valueOut,
    });
    this.nextX += 260;
    if (this.nextX > 1500) {
      this.nextX = 0;
      this.nextY += 220;
    }

    return { id, execIn, execOut, valueIn, valueOut };
  }

  connectExec(fromOutputSocketId: string, toInputSocketId: string): void {
    this.connections.push({ id: newGuid(), outputSocketId: fromOutputSocketId, inputSocketId: toInputSocketId });
  }

  connectValue(fromOutputValueSocketId: string, toInputValueSocketId: string): void {
    this.valueConnections.push({ id: newGuid(), outputSocketId: fromOutputValueSocketId, inputSocketId: toInputValueSocketId });
  }

  toGraph(graphName: string): VNyanGraph {
    return {
      graphName,
      graphIsActive: true,
      nodes: this.nodes,
      blocks: [],
      connections: this.connections,
      valueConnections: this.valueConnections,
    };
  }
}

async function backupFile(filePath: string): Promise<string> {
  const dir = path.join(await getBackupDir(), `mcp-${Date.now()}`);
  await fs.mkdir(dir, { recursive: true });
  const dest = path.join(dir, path.basename(filePath));
  try {
    await fs.copyFile(filePath, dest);
  } catch {
    // slot may not have an existing file yet - nothing to back up
  }
  return dest;
}

export async function writeGraphToSlot(
  index: number,
  graph: VNyanGraph
): Promise<{ backupPath: string; main: string; mirror: string }> {
  const { main, mirror } = (await redeemsPaths(index + 1))[index];
  await requireVNyanClosed(`${path.basename(main)} (+ asredeems mirror)`);

  const backupPath = await backupFile(main);
  const text = JSON.stringify(graph, null, 2);
  await fs.writeFile(main, text, "utf-8");
  await fs.writeFile(mirror, text, "utf-8");
  return { backupPath, main, mirror };
}
