import fs from "node:fs/promises";
import { readSettings } from "../settings/read.js";
import { redeemsPaths } from "../settings/paths.js";
import type { VNyanGraph } from "./model.js";

export interface GraphSummary {
  index: number;
  file: string;
  graphName: string | null;
  graphIsActive: boolean | null;
  nodeCount: number;
}

export async function listGraphs(): Promise<GraphSummary[]> {
  const settings = await readSettings();
  const declaredCount = typeof settings.NodeGraphCount === "number" ? settings.NodeGraphCount : 1;

  // NodeGraphCount is not authoritative - it's a VNyan-maintained counter
  // that can lag behind reality (a graph file can exist in a slot beyond
  // the declared count, left over from before the count was last bumped -
  // VNyan will not execute it, but it still shows up on disk). Probe a few
  // slots past the declared count too, for display purposes.
  let count = declaredCount;
  const probeLimit = declaredCount + 5;
  for (let i = declaredCount; i < probeLimit; i++) {
    const { main } = (await redeemsPaths(i + 1))[i];
    try {
      await fs.access(main);
      count = i + 1;
    } catch {
      break;
    }
  }

  const files = await redeemsPaths(count);

  const summaries: GraphSummary[] = [];
  for (let i = 0; i < files.length; i++) {
    const { main } = files[i];
    try {
      const text = await fs.readFile(main, "utf-8");
      const graph = JSON.parse(text) as VNyanGraph;
      summaries.push({
        index: i,
        file: main,
        graphName: graph.graphName ?? null,
        graphIsActive: graph.graphIsActive ?? null,
        nodeCount: graph.nodes?.length ?? 0,
      });
    } catch (err) {
      summaries.push({ index: i, file: main, graphName: null, graphIsActive: null, nodeCount: -1 });
    }
  }
  return summaries;
}
