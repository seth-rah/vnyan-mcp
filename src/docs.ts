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
  "pendulum-composition",
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
  "pendulum-tuning": "What damping/elasticity/stiffness/inert actually do in VNyan's pendulum chains.",
  "pendulum-composition":
    "REQUIRED READING before pointing more than one pendulum at the same target - only one pendulum may " +
    "write a GameObject or blendshape directly, so multiple pendulums must each publish to their own " +
    "parameter and be summed in a node graph. Includes the full working recipe for both transforms and " +
    "blendshapes.",
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

**The exception is branching nodes**, which genuinely do have multiple exec
outputs: \`OrderedNode\`/\`OrderedFlexNode\`, every \`Filter*Node\`,
\`CompareTextNode\`, \`CompareDecimalNode\`, \`RandomNode\`, \`CyclerNode\`,
\`TextSwitchNode\` and friends. These declare their outputs as a prefab-sized
array, so \`vnyan_node_schema\` marks them \`dynamicSockets: ["execOut"]\` and
the count it reports is a **floor**, not a ceiling - wiring past it is
allowed and the sockets get created. If you need the exact real count, run
\`vnyan_graph_read\` on a graph that already uses the node.

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

**Before adding a second pendulum to a bone or GameObject that already has
one, read \`vnyan_guide topic:'pendulum-composition'\`.** Only one pendulum
may drive a target directly; stacking them makes their motion cancel out,
and tuning these four parameters will not fix it.
`;

const PENDULUM_COMPOSITION = `# Combining multiple pendulums on one target

## The rule

**Only ONE pendulum may write a given output target directly.** This applies
to every output kind - GameObjects *and* blendshapes alike. From VNyan's
developer:

> "You cannot have more than one pendulum directly linked to one gameobject.
> If you need to combine values then you should likely pass the value to
> parameters and make a node graph to combine the values before passing them
> to a object rotation node."

Point two pendulums at the same target and they clash - the result is motion
that cancels itself out rather than layering. No amount of damping/elasticity
tuning fixes this; it is a routing problem, not a physics one.

**There is exactly one supported way to layer several pendulums onto one
target:** each pendulum writes to its own parameter, a node graph sums those
parameters, and a single node applies the total. Anything else is two
pendulums fighting.

## Why partial writes cancel

\`ObjectRotNode\`'s own help text is explicit: *"Rotation X / Rotation Y /
Rotation Z - **Will set to 0 if not specified**"*. So a node that sets only
X actively **zeroes Y and Z**. That is why the developer stresses applying
every axis together:

> "You should apply all of them at the same time … then use the parameter
> operation nodes to calculate each axis together."

One \`ObjectRotNode\` per target, receiving all three axes. Never one node
per axis.

## The pattern

**Step 1 - stop linking pendulums directly.** For each pendulum output
(\`settings.json\` \`Chains[].outputs[]\`, which \`vnyan_pendulum action:'list'\`
returns), leave \`gameObject\` **empty** and set \`param\` to a unique name
instead. Each pendulum now publishes its value to its own parameter rather
than fighting for the target:

    pendulum "EarBounce"  -> param "_pend_ear_x"
    pendulum "HeadBob"    -> param "_pend_bob_x"

No new machinery - both fields already exist on every output entry.

**Step 2 - sum them in a node graph on a fast timer loop.** Nodes involved,
with every value key verified:

| Node | values | Role |
|---|---|---|
| \`TimerNode\` | \`{timerName: "PendulumCombine"}\` | Event source. execIn 0, execOut 1. Fires when a matching timer elapses. |
| \`ParamOpNode\` | \`{paramName, value1, value2, operation}\` | One per axis. Math on two values, result stored to a parameter. |
| \`ObjectRotNode\` | \`{name, rotx, roty, rotz}\` | Applies all three axes at once. |
| \`SetTimerNode\` | \`{timerName, seconds}\` | Re-arms the timer, closing the loop. |

Three details that will bite otherwise:

1. **\`ParamOpNode.operation\` is a dropdown index, as a string:**
   \`"0"\` = add, \`"1"\` = subtract, \`"2"\` = multiply, \`"3"\` = divide,
   \`"4"\` = modulo. Use \`"0"\`.
2. **\`SetTimerNode\`'s \`seconds\` key is actually MILLISECONDS** despite the
   name - VNyan's help says "Milliseconds to trigger". Use \`"10"\` for the
   ~10 ms tick the developer suggests, not \`"0.01"\`.
3. **\`ParamOpNode\` has no value output.** It writes to a parameter, and the
   next node reads it back by name in brackets. That is the seam between the
   two steps.

## The \`[brackets]\` convention

Any node value documented as "or parameter in brackets" reads that parameter
at evaluation time. So \`ObjectRotNode\` with \`rotx: "[_pend_sum_x]"\` picks up
whatever \`ParamOpNode\` last stored there - no wire needed. This is what lets
the sums flow from step 2's math into step 2's output node.

\`ParamOpNode\` takes exactly **two** inputs, so for three or more pendulums
on one axis, chain them - each op folding the running total:

    _pend_sum_x = [_pend_ear_x] + [_pend_bob_x]
    _pend_sum_x = [_pend_sum_x] + [_pend_third_x]

## Worked example

Two pendulums (\`_pend_ear_x/y/z\`, \`_pend_bob_x/y/z\`) summed onto one
GameObject, in \`vnyan_graph_write\` spec form:

\`\`\`json
{
  "graphName": "Pendulum Combine",
  "nodes": [
    { "id": "tick",  "type": "TimerNode",     "values": { "timerName": "PendulumCombine" } },
    { "id": "sumX",  "type": "ParamOpNode",   "values": { "paramName": "_pend_sum_x", "value1": "[_pend_ear_x]", "value2": "[_pend_bob_x]", "operation": "0" } },
    { "id": "sumY",  "type": "ParamOpNode",   "values": { "paramName": "_pend_sum_y", "value1": "[_pend_ear_y]", "value2": "[_pend_bob_y]", "operation": "0" } },
    { "id": "sumZ",  "type": "ParamOpNode",   "values": { "paramName": "_pend_sum_z", "value1": "[_pend_ear_z]", "value2": "[_pend_bob_z]", "operation": "0" } },
    { "id": "apply", "type": "ObjectRotNode", "values": { "name": "YourGameObjectName", "rotx": "[_pend_sum_x]", "roty": "[_pend_sum_y]", "rotz": "[_pend_sum_z]" } },
    { "id": "loop",  "type": "SetTimerNode",  "values": { "timerName": "PendulumCombine", "seconds": "10" } }
  ],
  "connections": [
    { "from": "tick", "to": "sumX" },
    { "from": "tick", "to": "sumY" },
    { "from": "tick", "to": "sumZ" },
    { "from": "tick", "to": "apply" },
    { "from": "tick", "to": "loop" }
  ]
}
\`\`\`

Every wire comes off \`tick\`'s single execOut, because \`ParamOpNode\`,
\`ObjectRotNode\` and \`SetTimerNode\` are all terminal (zero execOut) - see
\`vnyan_guide topic:'node-authoring'\` for why chaining them instead would
silently run only the first.

Kick the loop off once (fire a \`SetTimerNode\` for \`PendulumCombine\` from any
graph, or add an \`AppStartNode\` -> \`SetTimerNode\` pair) and it self-sustains.

## On execution order

The developer suggests an Ordered Execution node:

> "You could use for example Ordered Execution node and then use the
> parameter operation nodes to calculate each axis together."

That is a **refinement, not a correctness requirement** here. Because the
sums travel through parameters rather than wires, the worst case without
ordering is that \`ObjectRotNode\` reads the previous tick's values - a ~10 ms
lag, normally imperceptible. If you do want strict ordering, insert an
\`OrderedNode\` (or \`OrderedFlexNode\`) between \`tick\` and the rest and wire
each step to a separate exec output in the intended order. Both types size
their exec outputs from the Unity prefab, so \`vnyan_node_schema\` reports a
floor - \`vnyan_graph_write\` lets you wire past it and creates sockets as
needed.

## Applying to something other than rotation

Same shape, different terminal node: \`ObjectPosNode\` (\`posx/posy/posz\`) and
\`ObjectScaleNode\` (\`scalex/scaley/scalez\`). Both carry the identical
zero-what-you-omit behavior, confirmed in their own help text - so both need
all three axes in one call.

**\`ObjectScaleNode\` is the dangerous one:** an omitted axis is set to 0, so
a partial write collapses the object to zero size on that axis rather than
merely mispositioning it. Always send all three.

## Blendshape outputs clash exactly the same way

Two pendulum chains writing the **same blendshape** clash just as two chains
on one GameObject do. This is the most common way a rig ends up with
pendulums quietly cancelling each other, because a blendshape name is easy to
reuse across several chains without noticing - and unlike a GameObject, the
same blendshape often legitimately appears as the \`blendshape\` field of one
output and the \`negative\` field of another. Both count as writing it.

The fix is the same param-and-sum pattern, and it is **simpler than the
rotation case** - blendshapes have no
"zeroes-the-axes-you-omit" behavior, so there is nothing to bundle. One
\`BlendshapeNode\` per blendshape, fed the summed parameter:

\`\`\`json
{
  "graphName": "Blendshape Combine",
  "nodes": [
    { "id": "tick", "type": "TimerNode",      "values": { "timerName": "BsCombine" } },
    { "id": "sum",  "type": "ParamOpNode",    "values": { "paramName": "_bs_sum_short_l", "value1": "[_pend_squint_short_l]", "value2": "[_pend_blink_short_l]", "operation": "0" } },
    { "id": "app",  "type": "BlendshapeNode", "values": { "bsName": "Highlight_Short_L", "bsValue": "[_bs_sum_short_l]", "smoothTime": "0", "isToggle": "0" } },
    { "id": "loop", "type": "SetTimerNode",   "values": { "timerName": "BsCombine", "seconds": "10" } }
  ],
  "connections": [
    { "from": "tick", "to": "sum" },
    { "from": "tick", "to": "app" },
    { "from": "tick", "to": "loop" }
  ]
}
\`\`\`

Scale it by adding one \`ParamOpNode\` + one \`BlendshapeNode\` pair per
blendshape, all hanging off the same \`tick\`. For a signed pair (a chain using
\`blendshape\` for the positive direction and \`negative\` for the other), sum
into one parameter and let the single \`BlendshapeNode\` take the signed total -
don't split it back into two nodes, or you have recreated the clash.

\`vnyan_pendulum action:'list'\` reports every shared target - GameObject or
blendshape - as a \`conflict\`, so you can see the full set before you start.
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
  "pendulum-composition": PENDULUM_COMPOSITION,
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
