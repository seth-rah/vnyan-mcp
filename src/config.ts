import path from "node:path";
import { getProfileDir } from "./settings/paths.js";

/** Where authored/exported node graphs are written for live import via
 * VNyan's own Load Graph UI (no restart needed). Defaults to a subfolder of
 * VNyan's own profile directory - never a fixed path - so it's always
 * somewhere the user can find relative to their own install. */
export async function getGraphExportDir(): Promise<string> {
  const override = process.env.VNYAN_MCP_GRAPH_EXPORT_DIR;
  if (override) return override;
  return path.join(await getProfileDir(), "Exports");
}
