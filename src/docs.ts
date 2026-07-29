import { readSettings } from "./settings/read.js";
import { areaOf, SETTINGS_AREAS, type SettingsArea } from "./settings/schema.js";

/**
 * Single source of truth for long-form reference content, served through
 * both the vnyan_guide tool and matching MCP resources (vnyan://guide/<topic>)
 * so the text exists exactly once. Short warnings that must reach a caller
 * even without an explicit lookup live inline in tool descriptions instead -
 * this module is for content too long for a `.describe()` string.
 */

export const GUIDE_TOPICS = [
  "node-authoring",
  "bone-names",
  "settings-keys",
  "pendulum-tuning",
  "restart-policy",
  "known-limits",
] as const;
export type GuideTopic = (typeof GUIDE_TOPICS)[number];

export const TOPIC_SUMMARIES: Record<GuideTopic, string> = {
  "node-authoring":
    "How to author VNyan node graphs with vnyan_graph_write: socket model, the runtime type-safety rule " +
    "and converter nodes, terminal-node fan-out, encrypted file paths, NodeGraphCount gating, Load Graph " +
    "persistence timing, and a worked example.",
  "bone-names": "The full UnityEngine.HumanBodyBones name list accepted by vnyan_bone.",
  "settings-keys": "Which settings.json keys fall under each of the six vnyan_settings_get areas, generated from the live file.",
  "pendulum-tuning": "What damping/elasticity/stiffness/inert actually do in VNyan's pendulum chains, with real tuned values.",
  "restart-policy": "Which VNyan MCP operations require closing VNyan vs. work with it running.",
  "known-limits": "Write-only areas, the SunLightNode bug, and which capabilities depend on reflection that can break on a VNyan update.",
};

const NODE_AUTHORING = `# Authoring VNyan node graphs

## The graph model

A graph is nodes + two kinds of wiring: **exec connections** (control flow -
"then do this") and **value connections** (data flow - "read this value from
here"). Both are between named socket indices on nodes, looked up via
\`vnyan_node_schema\`.

## Rule 1 - most nodes are terminal

Most action node types (SetParamNode, CallTriggerNode, most Effect*Nodes,
...) have **zero execOut sockets**. They do not chain. To run several
actions off one event, connect that event's single execOut to EACH action's
execIn directly:

\`\`\`
APIMessageNode --execOut--> SetParamNode.execIn
              \\-execOut--> CallTriggerNode.execIn
\`\`\`

NOT \`APIMessageNode -> SetParamNode -> CallTriggerNode\` (SetParamNode has no
execOut to continue the chain with - this was reproduced directly: a 3-node
chained graph loaded with no error but only the first node ever ran).

## Rule 2 - value sockets are strongly typed at runtime

\`values[]\` in the saved JSON is always strings, even for numbers and
booleans (e.g. \`"1"\`/\`"0"\`). But **wired value sockets carry real typed
data at runtime** (float, bool, Color, ...). Wiring a raw int/text output
straight into a float/bool input throws \`InvalidCastException\` inside
VNyan's \`TriggerSystem.Update()\` and **silently aborts the entire call** -
not even the plugin's own trigger listener fires, so \`trigger.recent\` shows
nothing and nothing errors anywhere except VNyan's own log file. This was
reproduced directly while building the bridge graph.

Fix: route through a converter node.
- \`TextToDecimalNode\` (1 valueIn \`textInput\`, 1 valueOut \`decimalOutput\`) - text to float
- \`TextToBoolNode\` (1 valueIn \`textInput\`, 1 valueOut \`boolOutput\`) - text to bool
- Both have zero exec sockets - pure pull-based value transforms, no exec wiring needed.

\`TriggerNode\`'s value outputs are ints for \`value1Output\`/\`value2Output\`/\`value3Output\`
and strings for \`text1Output\`/\`text2Output\`/\`text3Output\` - so route anything
needing a fractional value (like an intensity) through a text output, never
a value output, even though both look interchangeable in the schema.

## Rule 3 - local file paths are encrypted

\`SoundNode.soundFile\`, \`LoadAvatarNode.avatarFile\` and similar are AES-then-
double-base64 encrypted in the saved format - you cannot set them as a
literal string. Wire a \`SetTextParamNode\` or \`TextReplaceNode\` output into
the file-path value socket instead (VNyan's own Crowd Control example graph
does exactly this).

## Rule 4 - NodeGraphCount gates execution

VNyan only **executes** graph slots covered by \`settings.json\`'s
\`NodeGraphCount\`. A graph placed in a slot beyond that count loads with **no
error** and simply never runs - reproduced directly (fixed by bumping the
count and confirming the same file then executed correctly). Check
\`vnyan_settings_get area:'misc'\` before writing to a new slot number.

## Rule 5 - Load Graph persists on VNyan quit, not immediately

If you use the default export-and-import workflow (write a file, then use
VNyan's own "Load Graph" menu to import it into a tab), the running graph
updates immediately but \`redeemsN.json\` on disk does **not** change until
VNyan quits. \`vnyan_graph_read\`/\`vnyan_graph_list\` reflect disk, so they can
lag behind what's actually live. This was confirmed by direct observation.

## Worked example

A 3-node graph fired via the REST API, verified live: an API Message event
fans out to setting a parameter and firing a trigger.

\`\`\`json
{
  "graphName": "Example",
  "nodes": [
    { "id": "api",  "type": "APIMessageNode",  "values": { "action": "ExampleAction", "dict": "exampleDict" } },
    { "id": "setp", "type": "SetParamNode",     "values": { "paramName": "ExampleParam", "value": "99" } },
    { "id": "call", "type": "CallTriggerNode",  "values": { "triggerName": "ExampleTrigger", "callTime": "0" } }
  ],
  "connections": [
    { "from": "api", "to": "setp" },
    { "from": "api", "to": "call" }
  ]
}
\`\`\`

Firing \`vnyan_api_fire action:"ExampleAction"\` sets \`ExampleParam\` to 99 AND
fires \`ExampleTrigger\`, both from the one API event - because both wires
come directly off \`api\`'s single execOut, not chained through \`setp\`.
`;

const PENDULUM_TUNING = `# Pendulum chain tuning

VNyan's pendulum chains are a DynamicBone-style spring physics
implementation (confirmed by decompiling \`Assembly-CSharp.dll\`'s
\`DynamicBone.cs\`, which \`ChainSystem.cs\` assigns these four values onto
directly). All four parameters are hard-clamped to **0-1**
(\`Mathf.Clamp01\`).

| Param | What it does | Default | Direction |
|---|---|---|---|
| damping | How fast motion decays | 0.1 | Higher = settles sooner |
| elasticity | Restoring force pulling the bone back to rest | 0.1 | **Lower = floppier / more swing-bounce**, higher = snaps back fast |
| stiffness | Resistance to being rotated away from rest orientation | 0.1 | Higher = resists deformation more |
| inert | How much the avatar's own movement transfers into the chain | 0 | Higher = chain follows body movement more |

**On elasticity specifically:** it is a *return-strength*, not a
*bounce-amount* - the source line is literally
\`m_Position += (restPosition - currentPosition) * (m_Elasticity * dt)\`.
A LOW value means a weak pull back to rest, which looks and behaves like
more bounce/swing, especially as it accumulates down the chain. This is
forward behavior for what elasticity actually is, not an inversion.

**Per-bone scaling:** DynamicBone supports an \`AnimationCurve\` (evaluated at
\`boneLength/totalChainLength\`, root to tip) to scale each parameter
differently per bone in the chain - but **VNyan never sets these curves**
(confirmed: zero references outside \`DynamicBone.cs\` itself). So all four
parameters apply **uniformly across the whole chain** in VNyan. The
stronger motion visible on lower/tip bones is inherent pendulum
accumulation down the chain, not a per-bone parameter difference.

Note: \`vnyan_pendulum\`'s create/delete/setPosition/setRotation/chains
actions manage a SEPARATE, runtime-only set of chains from the persisted
ones \`vnyan_pendulum action:'list'\` reads - they don't share state and the
runtime ones don't survive a VNyan restart.
`;

const RESTART_POLICY = `# When VNyan needs to be closed

**Only \`settings.json\` writes require VNyan closed** - this includes the
dedicated-tool write paths that also live inside settings.json (Props,
Chains, StretchBones, Gestures, Expressions via their respective import/add
tools). VNyan triple-writes settings.json (\`.json\`, \`.dat\`, \`_as.json\`) on
every save and would silently clobber an external edit; there is no live
reload path for it.

**Everything else is live, no restart:**
- All plugin-backed RPC tools (params, triggers, avatar, bones, pendulum
  create/delete/drive, props set/toggle, colliders get/set, Spout2 list/add,
  stretch bone add, VNyanNet, UI theme/dialogs) work while VNyan runs.
- Node graph authoring defaults to **export + VNyan's own "Load Graph"
  menu** specifically so it does NOT need a restart - direct-to-slot writing
  (the \`slot\` parameter) is a fallback for when VNyan happens to already be
  closed, and that fallback path does still need it closed.
- Reading anything from disk (settings, graphs, colliders, pendulums,
  expressions, gestures) works regardless of whether VNyan is running.

If a plugin-backed tool is called while VNyan is closed, it returns one
clear message rather than a stack trace or hang - the same message
\`vnyan_status\` reports as \`bridgeReachable: false\`.
`;

const KNOWN_LIMITS = `# Known limits

- **Post-processing effects and lights have no getter at any tier.** The
  MCP tracks the value it last sent for the bridge-graph actions
  (vnyan_effect/vnyan_light) - it cannot read back the actual applied
  state. Never present that tracked value as an observed one.
- **SunLightNode throws InvalidCastException on ANY wired value socket** -
  reproduced with intensity alone and with intensity+toggle together, via
  the identical converter-node pattern that works cleanly for
  EffectBloomNode/EffectVignetteNode's equivalent float/bool fields. Root
  cause not identified (looks like a VNyan-side bug specific to this one
  node class). Its bridge action (vnyan_light key:'sunLight') is
  consequently fire-only with fixed defaults - intensity/toggle params are
  accepted but ignored.
- **Reflection-backed capabilities depend on names surviving obfuscation in
  the current Assembly-CSharp.dll build**: props (vnyan_prop),
  colliders (vnyan_collider get/set), Spout2 (vnyan_spout), stretch bones
  (vnyan_stretchbone add). A VNyan update can break any of these silently.
  Check \`vnyan_status\` (\`rpc.health\`) after any VNyan update - it probes
  each system with a cheap live call.
- **Stickers have no MCP coverage at all** - no safely-identifiable entry
  point exists (8 decoy methods share an identical signature with no real
  name surviving obfuscation for any of them).
- **Spout2 cameras can only be added, not removed** via the plugin - no
  safely-identifiable remove/delete method exists in this build. Remove one
  from VNyan's own Spout2 Cameras panel.
- **The 4 trailing bool flags on \`vnyan_spout addCamera\`** (\`flag1\`-\`flag4\`)
  have no recoverable meaning - the underlying method's signature is
  obfuscated positionally with no names to read.
`;

const STATIC_DOCS: Record<Exclude<GuideTopic, "settings-keys">, string> = {
  "node-authoring": NODE_AUTHORING,
  "bone-names": buildBoneNamesDoc(),
  "pendulum-tuning": PENDULUM_TUNING,
  "restart-policy": RESTART_POLICY,
  "known-limits": KNOWN_LIMITS,
};

function buildBoneNamesDoc(): string {
  // UnityEngine.HumanBodyBones - the standard Mecanim humanoid rig, stable
  // across Unity versions. Index shown for reference; vnyan_bone takes the
  // name, not the index. LastBone is a sentinel, not a real bone.
  const bones = [
    "Hips", "LeftUpperLeg", "RightUpperLeg", "LeftLowerLeg", "RightLowerLeg", "LeftFoot", "RightFoot",
    "Spine", "Chest", "Neck", "Head", "LeftShoulder", "RightShoulder", "LeftUpperArm", "RightUpperArm",
    "LeftLowerArm", "RightLowerArm", "LeftHand", "RightHand", "LeftToes", "RightToes", "LeftEye", "RightEye",
    "Jaw",
    "LeftThumbProximal", "LeftThumbIntermediate", "LeftThumbDistal",
    "LeftIndexProximal", "LeftIndexIntermediate", "LeftIndexDistal",
    "LeftMiddleProximal", "LeftMiddleIntermediate", "LeftMiddleDistal",
    "LeftRingProximal", "LeftRingIntermediate", "LeftRingDistal",
    "LeftLittleProximal", "LeftLittleIntermediate", "LeftLittleDistal",
    "RightThumbProximal", "RightThumbIntermediate", "RightThumbDistal",
    "RightIndexProximal", "RightIndexIntermediate", "RightIndexDistal",
    "RightMiddleProximal", "RightMiddleIntermediate", "RightMiddleDistal",
    "RightRingProximal", "RightRingIntermediate", "RightRingDistal",
    "RightLittleProximal", "RightLittleIntermediate", "RightLittleDistal",
    "UpperChest",
  ];
  return (
    `# vnyan_bone valid bone names\n\n` +
    `The UnityEngine.HumanBodyBones names accepted by \`bone\` in vnyan_bone (${bones.length} bones):\n\n` +
    bones.map((b) => `- ${b}`).join("\n") +
    `\n\nNames are case-sensitive matches to the enum member name exactly as listed above.`
  );
}

async function buildSettingsKeysDoc(): Promise<string> {
  const settings = await readSettings();
  const byArea: Record<SettingsArea, string[]> = {
    tracking: [], output: [], graphics: [], audio: [], connections: [], misc: [],
  };
  for (const key of Object.keys(settings)) {
    byArea[areaOf(key)].push(key);
  }
  let md = "# settings.json key index\n\n" +
    "settings.json is a single flat namespace (no nesting) - this list is generated live from the " +
    "actual file, grouped by the area vnyan_settings_get uses.\n\n";
  for (const area of SETTINGS_AREAS) {
    const keys = byArea[area].sort();
    md += `## ${area} (${keys.length} keys)\n\n${keys.join(", ")}\n\n`;
  }
  md += "\nProps, Chains, StretchBones, Gestures, Expressions, and the collider size/offset keys are " +
    "NOT listed here - they have dedicated tools (vnyan_prop, vnyan_pendulum, vnyan_stretchbone, " +
    "vnyan_gesture, vnyan_expression, vnyan_collider).";
  return md;
}

export async function getGuideTopic(topic: GuideTopic): Promise<string> {
  if (topic === "settings-keys") return buildSettingsKeysDoc();
  return STATIC_DOCS[topic];
}
