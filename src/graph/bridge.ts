import { GraphBuilder } from "./build.js";
import { lookupNodeType } from "./schema.js";
import { redeemsPaths } from "../settings/paths.js";
import { readSettings } from "../settings/read.js";
import { readGraphFile } from "./read.js";
import type { VNyanGraph } from "./model.js";

/**
 * Capability-bridge actions: precedence tier 3 (a generated node graph,
 * using only officially-supported node types) for capabilities with no
 * VNyanInterface method and no safely-reflectable Assembly-CSharp entry
 * point - post-processing effects, lights. Each action is one TriggerNode
 * whose value-outputs feed the target node's value-inputs; firing it via
 * vnyan_trigger (ITriggerInterface.callTrigger) drives the effect live.
 *
 * Ceiling: callTrigger carries exactly 3 ints (value1-3) + 3 strings
 * (text1-3). Only scalar params are wired here, and only through the TEXT
 * channels + a converter node (TextToDecimalNode/TextToBoolNode) - value
 * sockets are strongly typed at runtime (unlike the always-string `values[]`
 * JSON), so wiring value1-3 (hard ints) or a raw text output straight into a
 * float/bool input throws InvalidCastException inside VNyan's
 * TriggerSystem.Update() and silently aborts the whole call (confirmed
 * against the live app - see the missing toggleFieldIndex on sunLight below
 * for a case that still fails even through the converter, root cause not
 * yet found). Composite params (color) are NOT wired - a single
 * color-picker value-socket doesn't map cleanly onto CallTrigger's 6 flat
 * scalar slots, so colors are fixed at their default here. Extend
 * BRIDGE_ACTIONS with the same shape for more capabilities.
 */
export interface BridgeAction {
  key: string;
  category: "effect" | "light";
  triggerName: string;
  targetType: string;
  /** Literal `values[]` defaults for every key NOT driven by a wired socket. */
  defaults: Record<string, string>;
  /** valueInFields index (ground truth from schema.json) carrying intensity, via TriggerNode.text1Output. */
  intensityFieldIndex?: number;
  /** valueInFields index carrying a 0/1 toggle, via TriggerNode.value1Output. */
  toggleFieldIndex?: number;
}

const TRIGGER_PREFIX = "mcp.";

function fieldIndex(targetType: string, fieldName: string): number {
  const schema = lookupNodeType(targetType);
  const idx = schema?.valueInFields.indexOf(fieldName) ?? -1;
  if (idx < 0) throw new Error(`${targetType} has no valueIn field '${fieldName}' - bridge action definition is stale`);
  return idx;
}

export const BRIDGE_ACTIONS: BridgeAction[] = [
  {
    key: "bloom",
    category: "effect",
    triggerName: `${TRIGGER_PREFIX}effect.bloom`,
    targetType: "EffectBloomNode",
    defaults: { threshold: "0", diffusion: "1", color_r: "1", color_g: "1", color_b: "1", color_i: "0", active: "1" },
    intensityFieldIndex: fieldIndex("EffectBloomNode", "intensityInput"),
    toggleFieldIndex: fieldIndex("EffectBloomNode", "toggleInput"),
  },
  {
    key: "vignette",
    category: "effect",
    triggerName: `${TRIGGER_PREFIX}effect.vignette`,
    targetType: "EffectVignetteNode",
    defaults: { smoothness: "0.2", active: "1" },
    intensityFieldIndex: fieldIndex("EffectVignetteNode", "intensityInput"),
    toggleFieldIndex: fieldIndex("EffectVignetteNode", "toggleInput"),
  },
  {
    key: "ambientLight",
    category: "light",
    triggerName: `${TRIGGER_PREFIX}light.ambient`,
    targetType: "AmbientNode",
    defaults: { color_r: "1", color_g: "1", color_b: "1", seconds: "0" },
    intensityFieldIndex: fieldIndex("AmbientNode", "intensityInput"),
  },
  {
    key: "sunLight",
    category: "light",
    triggerName: `${TRIGGER_PREFIX}light.sun`,
    targetType: "SunLightNode",
    // No sockets wired at all: EVERY value-socket wired into SunLightNode
    // (intInput alone, or intInput+toggleInput together) throws
    // InvalidCastException inside VNyan's TriggerSystem.Update() and
    // silently aborts the call - reproduced with intensity-only wiring
    // through the same TextToDecimalNode->float pattern that works fine for
    // EffectBloomNode's intensityInput (same field type, same converter,
    // same wiring shape). Root cause not identified; VNyan bug suspected in
    // this specific node class. Firing this trigger applies the literal
    // defaults below (turns the sun light on at fixed values) - it is not
    // live-parametrized like bloom/vignette/ambientLight.
    defaults: { intensity: "1", color_r: "1", color_g: "1", color_b: "1", seconds: "0", toggle: "1", active: "1" },
  },
];

export function buildBridgeGraph(): VNyanGraph {
  const builder = new GraphBuilder();
  for (const action of BRIDGE_ACTIONS) {
    const trigger = builder.addNode("TriggerNode", { triggerName: action.triggerName });
    const target = builder.addNode(action.targetType, action.defaults);
    builder.connectExec(trigger.execOut[0], target.execIn[0]);
    // Value sockets are strongly typed at runtime (unlike the always-string
    // `values[]` JSON) - wiring TriggerNode's raw text/int outputs straight
    // into a float/bool input throws InvalidCastException inside VNyan's
    // TriggerSystem.Update() and silently aborts the whole call (confirmed
    // against the live app). Route every parameter through VNyan's own
    // converter nodes instead: text1 -> TextToDecimalNode -> float input,
    // text2 -> TextToBoolNode -> bool input.
    if (action.intensityFieldIndex !== undefined) {
      const conv = builder.addNode("TextToDecimalNode");
      // TriggerNode.valueOutFields order: value1,value2,value3,text1,text2,text3 -> text1 is index 3
      builder.connectValue(trigger.valueOut[3], conv.valueIn[0]);
      builder.connectValue(conv.valueOut[0], target.valueIn[action.intensityFieldIndex]);
    }
    if (action.toggleFieldIndex !== undefined) {
      const conv = builder.addNode("TextToBoolNode");
      builder.connectValue(trigger.valueOut[4], conv.valueIn[0]); // text2
      builder.connectValue(conv.valueOut[0], target.valueIn[action.toggleFieldIndex]);
    }
  }
  return builder.toGraph("MCP Bridge");
}

/**
 * Every TriggerNode.triggerName already in use across all redeemsN.json
 * graphs - triggers are global. Pass `excludeSlot` when checking ahead of
 * an install into that same slot: re-installing/refreshing the bridge
 * graph into the slot it already occupies is not a collision with itself.
 */
export async function scanExistingTriggerNames(excludeSlot?: number): Promise<Set<string>> {
  const settings = await readSettings();
  const count = typeof settings.NodeGraphCount === "number" ? settings.NodeGraphCount : 1;
  const names = new Set<string>();
  const paths = await redeemsPaths(count);
  for (let i = 0; i < paths.length; i++) {
    if (i === excludeSlot) continue;
    try {
      const graph = await readGraphFile(paths[i].main);
      for (const node of graph.nodes) {
        if (node.path === "Nodes/TriggerNode") {
          const name = node.values.find((v) => v.key === "triggerName")?.value;
          if (name) names.add(name);
        }
      }
    } catch {
      // slot file missing/unreadable - nothing to scan
    }
  }
  return names;
}

export function checkBridgeCollisions(existing: Set<string>): string[] {
  return BRIDGE_ACTIONS.map((a) => a.triggerName).filter((name) => existing.has(name));
}
