import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { rpc, BridgeUnavailableError } from "../bridge.js";
import { getProfileDirInfo } from "../settings/paths.js";
import { allNodeTypes, schemaMetadata } from "../graph/schema.js";
import { jsonResult, safeHandler } from "../toolHelpers.js";

export function register(server: McpServer) {
  server.registerTool(
    "vnyan_status",
    {
      title: "VNyan bridge status",
      description:
        "Checks whether the VNyanMcp plugin bridge is reachable and reports per-system health " +
        "(props/colliders/spout2/stretchbones), the full list of registered bridge RPC methods, which " +
        "VNyan profile directory the disk-backed tools are reading (and how it was found - env var, " +
        "the running plugin, or the conventional path), and the VNyan/Unity version the bundled node " +
        "schema was generated from. No directory is hardcoded - this is the one place to confirm what " +
        "this server actually resolved on your machine. Source: plugin + disk.",
      inputSchema: {},
    },
    safeHandler(async () => {
      const profileDir = await getProfileDirInfo().catch((err) => ({ dir: null, source: null, error: err.message }));
      try {
        const [health, methods, uptime, profilePath] = await Promise.all([
          rpc("rpc.health"),
          rpc("rpc.methods"),
          rpc("app.uptime"),
          rpc("app.profilePath"),
        ]);
        return jsonResult({
          bridgeReachable: true,
          health,
          methodCount: (methods as unknown[]).length,
          methods,
          uptimeSeconds: uptime,
          profilePath,
          resolvedProfileDir: profileDir,
          nodeSchema: { ...schemaMetadata(), typeCount: allNodeTypes().length },
        });
      } catch (err) {
        if (err instanceof BridgeUnavailableError) {
          return jsonResult({ bridgeReachable: false, message: err.message, resolvedProfileDir: profileDir });
        }
        throw err;
      }
    })
  );
}
