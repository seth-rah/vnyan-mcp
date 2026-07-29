import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BRIDGE_ACTIONS, buildBridgeGraph, scanExistingTriggerNames, checkBridgeCollisions } from "../graph/bridge.js";
import { writeGraphToSlot } from "../graph/build.js";
import { rpc } from "../bridge.js";
import { getGraphExportDir } from "../config.js";
import { jsonResult, textResult, safeHandler } from "../toolHelpers.js";

export function register(server: McpServer) {
  server.registerTool(
    "vnyan_bridge_graph",
    {
      title: "VNyan capability bridge graph",
      description:
        "The bridge graph is how post-processing effects and lights become controllable with no " +
        "reflection: one TriggerNode per capability (namespaced 'mcp.*'), wired to the effect/light node, " +
        "callable via vnyan_trigger or the vnyan_effect/vnyan_light convenience tools. 'preview' (disk, " +
        "read-only) lists the actions it would install and checks for trigger-name collisions against " +
        "every existing graph - triggers are global. 'install' (disk, write) by default EXPORTS the " +
        "graph as a file - import it into a spare tab via VNyan's own 'Load Graph' menu, no restart " +
        "needed. Pass 'slot' instead to write directly into that slot (REQUIRES VNyan closed, backs up " +
        "the slot first). Refuses on any trigger-name collision either way.",
      inputSchema: {
        action: z.enum(["preview", "install"]).describe("'preview' checks for collisions without writing; 'install' writes the graph"),
        slot: z.number().optional().describe("Advanced/fallback: write directly into this slot instead of exporting a file. REQUIRES VNyan closed."),
      },
    },
    safeHandler(async ({ action, slot }) => {
      const existing = await scanExistingTriggerNames(action === "install" ? slot : undefined);
      const collisions = checkBridgeCollisions(existing);

      if (action === "preview") {
        return jsonResult({
          actions: BRIDGE_ACTIONS.map((a) => ({ key: a.key, triggerName: a.triggerName, targetType: a.targetType })),
          collisions,
        });
      }

      if (collisions.length > 0) {
        throw new Error(`Trigger name collision(s), refusing to install: ${collisions.join(", ")}`);
      }

      const graph = buildBridgeGraph();

      if (slot !== undefined) {
        const result = await writeGraphToSlot(slot, graph);
        return jsonResult({ mode: "slot", ...result, actions: BRIDGE_ACTIONS.map((a) => a.key) });
      }

      const exportDir = await getGraphExportDir();
      await fs.mkdir(exportDir, { recursive: true });
      const filePath = path.join(exportDir, "MCP Bridge.json");
      await fs.writeFile(filePath, JSON.stringify(graph, null, 2), "utf-8");
      return jsonResult({
        mode: "export",
        file: filePath,
        actions: BRIDGE_ACTIONS.map((a) => a.key),
        instructions: `Wrote to ${filePath} - in VNyan, open a spare graph tab and use its 'Load Graph' action to import this file.`,
      });
    })
  );

  const actionKeys = BRIDGE_ACTIONS.map((a) => a.key) as [string, ...string[]];

  server.registerTool(
    "vnyan_effect",
    {
      title: "Fire a bridged post-processing effect",
      description:
        "Drives a post-processing effect (bloom/vignette) via the installed bridge graph's TriggerNode. " +
        "REQUIRES vnyan_bridge_graph action 'install' to have been run once. Source: plugin trigger.call " +
        "(live). This node type has no getter in VNyan at any tier - the MCP tracks the value it just " +
        "sent, it does not read back the actual applied state.",
      inputSchema: {
        key: z.enum(actionKeys).describe("Bridge action key, e.g. 'bloom' or 'vignette'"),
        intensity: z.number().optional().describe("Default 0"),
        toggle: z.boolean().optional().describe("Default true (most of these effects toggle off on a repeat call with the same state)"),
      },
    },
    safeHandler(async ({ key, intensity, toggle }) => {
      const action = BRIDGE_ACTIONS.find((a) => a.key === key && a.category === "effect");
      if (!action) throw new Error(`'${key}' is not an effect bridge action`);
      const params: Record<string, unknown> = { name: action.triggerName, text1: String(intensity ?? 0) };
      if (action.toggleFieldIndex !== undefined) params.text2 = toggle === false ? "0" : "1";
      await rpc("trigger.call", params);
      return textResult(`Fired '${action.triggerName}' (intensity=${intensity ?? 0}, toggle=${toggle ?? true}) - not read back, see tool description.`);
    })
  );

  server.registerTool(
    "vnyan_light",
    {
      title: "Fire a bridged light",
      description:
        "Drives ambient light intensity via the installed bridge graph's TriggerNode - live-parametrized. " +
        "'sunLight' is fire-only: every value-socket wired into SunLightNode crashes VNyan's trigger " +
        "processing (root cause not identified, looks like a VNyan-side bug specific to this node class), " +
        "so firing it just turns the sun light on at fixed defaults - 'intensity'/'toggle' are ignored for it. " +
        "REQUIRES vnyan_bridge_graph action 'install' to have been run once. Source: plugin trigger.call " +
        "(live). No getter exists at any tier - the MCP tracks the value it just sent, it does not read " +
        "back the actual applied state.",
      inputSchema: {
        key: z.enum(actionKeys).describe("Bridge action key, e.g. 'ambientLight' or 'sunLight'"),
        intensity: z.number().optional().describe("Default 0. Ignored for sunLight - see tool description"),
        toggle: z.boolean().optional().describe("Ignored for sunLight - see tool description"),
      },
    },
    safeHandler(async ({ key, intensity, toggle }) => {
      const action = BRIDGE_ACTIONS.find((a) => a.key === key && a.category === "light");
      if (!action) throw new Error(`'${key}' is not a light bridge action`);
      const params: Record<string, unknown> = { name: action.triggerName, text1: String(intensity ?? 0) };
      if (action.toggleFieldIndex !== undefined) params.text2 = toggle === false ? "0" : "1";
      await rpc("trigger.call", params);
      return textResult(`Fired '${action.triggerName}' (intensity=${intensity ?? 0}) - not read back, see tool description.`);
    })
  );
}
