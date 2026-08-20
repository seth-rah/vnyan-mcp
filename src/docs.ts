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
  "graph-performance",
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
    "and converter nodes, terminal-node fan-out AND the fact that fan-out executes in connection order, " +
    "BlendshapeNode's int-cast / semicolon / zero-removes-override edges, encrypted file paths, " +
    "NodeGraphCount gating, Load Graph persistence timing, and a worked example.",
  "graph-performance":
    "REQUIRED READING before putting any graph on a fast timer. MathExpNode re-parses and rebuilds a " +
    "closure tree on EVERY evaluation and will destroy your frame rate; the parameter-math nodes are " +
    "orders of magnitude cheaper. Includes measured numbers and a cookbook for abs/min/max/clamp without " +
    "MathExpNode.",
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

### Fan-out runs in CONNECTION ORDER, within the same tick

Terminal nodes cannot be chained, but that does **not** mean they are
unordered. \`SocketOutput.SetValue\` invokes a **multicast delegate**, and .NET
invokes handlers in the order they were added, so the order you wire the
connections **is** the order they execute - and they all run inside one tick.

That makes read-after-write across terminal nodes safe. A chain of
\`ParamOpNode\`s where each reads the parameter the previous one wrote resolves
completely in a single tick, with no lag and no \`OrderedNode\` needed:

\`\`\`
tick --> ParamOpNode  sum = a + b        (wire this one first)
     \\-> ParamOpNode  sum = sum + c      (then this one)
     \\-> ParamOpNode  out = sum * gain   (then this)
\`\`\`

Verified empirically: a 60-node \`ParamOpNode\` chain, each node adding 1 to the
previous node's parameter, went from seed to seed+60 **within one tick**.

Two consequences worth internalising:
- **You do not need \`MathExpNode\` to avoid ordering problems.** Reaching for it
  for that reason is a costly mistake - see \`vnyan_guide topic:'graph-performance'\`.
- **Connection order is load-bearing.** Re-wiring a generated graph by hand can
  silently change the arithmetic. Say so in a \`MessageBoxNode\` if a human will
  ever open the graph.

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

## Rule 5 - VNyan's in-memory graph wins over the file on disk

If you use the default export-and-import workflow (write a file, then use
VNyan's own "Load Graph" menu to import it into a tab), the running graph
updates immediately but \`redeemsN.json\` on disk does **not** change until
VNyan quits. \`vnyan_graph_read\`/\`vnyan_graph_list\` reflect disk, so they can
lag behind what's actually live. This was confirmed by direct observation.

**The same precedence makes a closed-VNyan \`slot\` write unreliable.** A
176-node graph was written directly to \`redeems5.json\` with VNyan closed and
verified on disk - and was then silently replaced by VNyan persisting its own
older in-memory copy of that tab. The written graph survived only in the
\`as<name>.json\` mirror (\`asredeems5.json\`), which is where to look if a slot
write appears to have vanished.

So: **prefer \`Load Graph\` even when VNyan happens to be closed.** Reopen it
and import, rather than writing to the slot. The \`slot\` parameter is for when
you also need the graph present before VNyan next starts, and it should be
re-verified afterwards rather than assumed.

## Rule 6 - BlendshapeNode has four sharp edges

- **The wired value socket is cast to \`int\`** (\`num = (int)obj\`, then
  \`num / 100f\`). A float source throws \`InvalidCastException\` and the write is
  silently dropped, so put a \`DecimalToNumberNode\` in between. Two knock-ons:
  graph-driven blendshape writes **quantise to 1% steps** (unlike a pendulum's
  direct float write), and any value below 1 truncates to **zero** - which
  looks exactly like "the graph isn't running".
- **\`bsName\` is split on \`;\`**, so one node can drive several shapes from a
  single evaluation (\`"Shape_L;Shape_R"\`). Worth using wherever shapes share a
  value - it cuts both node count and per-tick cost.
- **\`bsValue: "0"\` REMOVES the override**, it does not write a zero. That resets
  the smoothing origin, so **never write \`0\` and then a value to the same shape
  in the same tick** - the value gets suppressed and the shape stays dark. Give
  each shape exactly one write per tick, and zero it on the branches that do
  not drive it.
- It affects blendshape **clips** only, not mesh shape keys (its help text is
  explicit). Unknown names are accepted and simply create a registry entry, so
  a typo is silent.

## Rule 7 - a missing parameter reads as 0, not an error

\`[someParam]\` that no node or chain writes substitutes to \`0\`. Nothing warns.
A typo, a rename, or a chain that hasn't published yet all look identical to a
legitimate zero, so verify parameter names rather than trusting silence -
\`vnyan_param action:'fillString'\` expands a bracketed string on demand and is
the quickest way to check.

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

const GRAPH_PERFORMANCE = `# Node graph performance

Graph node cost varies by **orders of magnitude**, and the difference only
shows up once a graph runs on a timer. A graph that is instant as a one-shot
redeem can halve your frame rate at 100 Hz.

## The one rule

**Never put \`MathExpNode\` on a fast timer.** Use the parameter-math nodes.

## Why - the two cost tiers

\`MathExpNode\` does all of this on **every single evaluation, with no caching**:

1. \`ParamSystem.PNGNHMHMOBK(text)\` - a \`Regex.Matches\` over the whole
   expression, then per \`[param]\`: a dictionary lookup, a **formatted**
   \`ToString("0.#######")\`, and a \`Replace\` that allocates a brand-new copy of
   the entire string. It also rebuilds \`[heartrate]\`/\`[heartpercent]\`
   unconditionally. That is ~14 string allocations per call.
2. \`COFMPGPGHHJ(text, ...)()\` - **tokenises the expression and builds a fresh
   closure tree, then invokes it.** Cost scales with expression length and
   operator count.

The cheap nodes - \`ParamOpNode\`, \`ParamMathNode\`, \`FilterParamNode\`,
\`SetParamNode\`, and \`BlendshapeNode\` reading a literal \`[param]\` - all bottom
out in \`ParamSystem.ODJGKNOHHLO\` -> \`PINHGCLDDOH\`: a couple of \`Contains\`
checks and **one dictionary lookup**. No regex, no allocation storm, no
delegate construction.

## Measured, on a real rig

| graph | tick | result |
|---|---|---|
| 20 \`MathExpNode\`, ~370-420 char expressions | 33 ms | **120 fps -> 30 fps** |
| 60 \`ParamOpNode\` | 10 ms | **no measurable cost** |

One tick of the \`MathExpNode\` version consumed roughly a whole frame (~25 ms
for 20 evaluations). The same rig rebuilt with ~112 cheap node executions per
tick at 10 ms ran at the frame cap.

\`MathExpNode\` is still the right tool for a one-shot or event-driven
calculation, where a millisecond is free and one readable expression beats
fifteen nodes.

## Cookbook - doing maths without MathExpNode

\`ParamOpNode\` is binary: \`operation\` is a dropdown index as a string -
\`"0"\` add, \`"1"\` subtract, \`"2"\` multiply, \`"3"\` divide, \`"4"\` modulo.
\`ParamMathNode\` is unary: \`"0"\` sin, \`"1"\` cos, \`"2"\` tan, **\`"3"\` abs**.

- **Sum a list** - a chain of \`ParamOpNode\`s accumulating into one parameter.
  Safe in a single tick because fan-out executes in connection order (see
  \`vnyan_guide topic:'node-authoring'\`, Rule 1).
- **abs(x)** - \`ParamMathNode operation:"3"\`. Exact and cheap.
- **negate** - \`ParamOpNode operation:"1"\` with \`value1: "0"\`.
- **min / max / clamp** - there is no min or max node. Branch with
  \`FilterParamNode\` (execOut \`0\` = greater, \`1\` = equal, \`2\` = less) and write
  the ceiling on the \`>\` branch, the value on the others. Only the taken branch
  executes, so a branch is cheaper than it looks.
- **Sign split** (drive two opposing shapes from one signed value) -
  \`FilterParamNode\` against \`0\`, then write the positive shape on \`>\` and the
  negated value to the other shape on \`<\`.
- **x squared / integer powers** - repeated \`ParamOpNode\` multiply. **There is
  no power operator among the cheap nodes**; \`^\` (\`Mathf.Pow\`) exists only
  inside \`MathExpNode\`, so a fractional exponent is the one case that genuinely
  needs it. Prefer restructuring to integer powers over reintroducing
  \`MathExpNode\` into a hot loop.

## Other things that cost you

- **Tick faster than the frame rate is wasted work.** A 10 ms timer on a 60 fps
  render evaluates everything roughly twice per displayed frame. Make the
  interval a parameter (\`SetTimerNode.seconds\` accepts \`[bracketed]\` values) so
  it can be tuned live instead of re-authored.
- **Prefer smoothing over a faster tick.** \`BlendshapeNode.smoothTime\`
  interpolates inside VNyan's blendshape system, per frame, outside your graph.
  A slow tick plus smoothing is smoother *and* cheaper than a fast tick.
- **Collapse duplicate writes.** \`BlendshapeNode.bsName\` splits on \`;\`, so
  shapes sharing a value cost one evaluation instead of several.
- **Count evaluations, not nodes.** With \`FilterParamNode\` branching, only the
  taken path runs, so a 176-node graph can be ~112 executions per tick.
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
| inert | How rigidly the chain travels WITH the avatar | 0 | Higher = follows the body, so body motion induces **less** swing |

**On inert specifically - the name reads backwards.** The integration line is
\`m_Position += velocity * (1 - damping) + gravity + objectMove * inert\`, so the
avatar's movement is *added to the particle*: the chain is dragged along with
the body in proportion to \`inert\`. At **1** the chain moves rigidly with the
avatar and turning or walking induces **no** swing at all; at **0** the chain
ignores the avatar entirely and body motion produces the **maximum** swing.

The practical consequence: if a chain is being shaken by head movement when it
should only respond to its own input value, **raise** inert. Lowering it - the
intuitive reading of "less inertia transferred" - makes it worse.

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

**Chain amplitude depends on frame rate.** DynamicBone integrates per frame, so
the same chain produces noticeably larger displacements at 30 fps than at 120.
Anything calibrated against a chain's output - a gain in a combine graph, a
multiplier chosen by eye - is calibrated against the frame rate it was tuned
at, and wants rechecking if the frame cap changes or the scene gets heavier.

Note: \`vnyan_pendulum\`'s create/delete/setPosition/setRotation/chains
actions manage a SEPARATE, runtime-only set of chains from the persisted
ones \`vnyan_pendulum action:'list'\` reads - they don't share state and the
runtime ones don't survive a VNyan restart.

**Before pointing a second pendulum at any target that already has one - a
GameObject axis, a blendshape, or a parameter - read
\`vnyan_guide topic:'pendulum-composition'\`.** Only one pendulum may write a
target directly; stacking them makes their motion cancel out, and tuning
these four parameters will not fix it, because it is a routing problem rather
than a physics one.
`;

const PENDULUM_COMPOSITION = `# Combining multiple pendulums on one target

Every claim here is tagged with how it was established: \`[source]\` decompiled
VNyan code, \`[dev-doc]\` VNyan's shipped \`VNyanInterface.xml\`, \`[help]\`
VNyan's shipped help files, \`[observed]\` a real VNyan-written config or graph,
\`[repro]\` reproduced live against a running VNyan.

## The rule

**Only ONE pendulum may write a given output target directly.** Two pendulums
on the same target clash - the second overwrites the first each frame, so
their motion cancels rather than layering. This is a routing problem; no
amount of damping/elasticity tuning fixes it. \`[source]\`

VNyan's developer:

> "You cannot have more than one pendulum directly linked to one gameobject.
> If you need to combine values then you should likely pass the value to
> parameters and make a node graph to combine the values before passing them
> to a object rotation node."

The **granularity** differs per output kind:

| Output kind | Keyed by | One writer per |
|---|---|---|
| \`blendshape\` / \`negative\` | blendshape name | the name |
| \`gameObject\` | \`(name.ToLower(), transform)\` | object **and axis** |
| \`param\` | parameter name | the name |

\`[source]\` Blendshapes go through \`BlendShapeSystem.AddOverrideBlendshape\`,
GameObjects through \`PosRotSystem.SetAddChainRotation\`, parameters through
\`ParamSystem\`. **All three assign rather than accumulate** - see the naming
trap below.

Two consequences people get wrong:

- Two pendulums on the **same GameObject but different \`transform\` axes do
  NOT clash** - they write separate \`xValue\`/\`yValue\`/\`zValue\` fields.
- Two outputs sharing a **\`param\` name DO clash**. That is why the fix pattern
  insists every output gets its *own* parameter.

## Naming trap - do not trust these method names

\`AddOverrideBlendshape\` and \`SetAddChainRotation\` both sound additive. Neither
is. \`[source]\`

\`\`\`csharp
// AddOverrideBlendshape - "Add" means add a DICTIONARY ENTRY
previous = entry.Value;
entry.Value = value;         // replaces
entry.StartValue = previous; // old value survives only as a tween origin

// SetAddChainRotation - assigns per axis, no +=
switch (transform) { case 0: value.xValue = amount; ... }
\`\`\`

## The complete data model

### Chain level

| Field | Meaning | Evidence |
|---|---|---|
| \`name\` | display name | \`[observed]\` |
| \`bones\` | number of simulated bones in the chain | \`[observed]\` |
| \`damping\` \`elasticity\` \`stiffness\` \`inert\` | DynamicBone spring params, all \`Mathf.Clamp01\` | \`[source: DynamicBone.cs]\` |

See \`vnyan_guide topic:'pendulum-tuning'\` for what each spring param does.

### inputs[] - what drives the chain

| Field | Meaning | Evidence |
|---|---|---|
| \`valueName\` | a blendshape name or a parameter name | \`[source]\` |
| \`isBlendshape\` | \`true\` reads a blendshape via \`BlendShapeSystem.GetAccumulatedValue\`; \`false\` reads a numeric parameter from \`ParamSystem\` | \`[source: ValueChainRoot.cs]\` |
| \`multiplier\` | scales the driving value (stored internally as \`efficiency\`) | \`[source]\` |
| \`isRotation\` | selects **which property of the chain root** the input drives - see below | \`[source]\` + \`[dev-doc]\` |

**\`isRotation\` in full**, because it is the least obvious field:

- \`false\` -> accumulates into the root's **\`localPosition\`** (X). The root is
  *translated*, the bones lag behind, so the chain **swings back and forth as
  the value changes and settles when it stops.** Impulse-like.
- \`true\` -> accumulates into the root's **\`localRotation\`**
  (\`Quaternion.Euler\`, Z). The root is *tilted*, so the chain **swings to an
  angle proportional to the value and stays there.** Absolute-like.

\`[source: ValueChainRoot.cs]\` - the two accumulators end in
\`transform.localPosition = zero;\` and
\`transform.localRotation = Quaternion.Euler(zero2);\`, consistent across every
obfuscated duplicate. \`[dev-doc]\` corroborates: the plugin API exposes the same
two modes, documented as \`setPositionValue\` = *"changes of this value will make
the pendulum swing back and forth"* and \`setRotationValue\` = *"makes pendulum
swing to a certain angle and remain there"*.

### outputs[] - what the chain drives

| Field | Meaning | Evidence |
|---|---|---|
| \`bone\` | index into the chain's bones; higher = further from root = more lag and accumulated motion | \`[source]\` |
| \`multiplier\`, \`offset\` | every path computes \`num * multiplier + offset\`, where \`num\` is that bone's X displacement from the chain root | \`[source]\` |
| \`blendshape\` | written **only when \`num > 0\`**, as \`num * multiplier + offset\` | \`[source]\` |
| \`negative\` | written **only when \`num < 0\`**, as \`(-num) * multiplier + offset\` | \`[source]\` |
| \`param\` | written **always**, as \`num * multiplier + offset\` - the **raw signed** value, with no positive/negative split | \`[source]\` |
| \`gameObject\` | \`SetAddChainRotation(name.ToLower(), transform, num * multiplier + offset)\` - matching is **case-insensitive** | \`[source]\` |
| \`transform\` | axis selector for \`gameObject\`: **0 = X, 1 = Y, 2 = Z** rotation | \`[source]\` |

**Offset asymmetry:** the negative path negates \`num\` *before* applying
multiplier and offset, so with a non-zero \`offset\` the two directions are
**not** mirror images. \`[source]\`

**The key asymmetry to internalise:** VNyan splits positive/negative *only*
when writing blendshapes directly. A \`param\` output gets the signed value. So
when you reroute through parameters, **you** own the split.

### Units change when you reroute, and the mismatch is silent

A pendulum writes blendshapes in **raw** units - roughly 0-1 for full
deflection, though it is not clamped and can exceed 1. \`BlendshapeNode\` takes
**0-100** and divides by 100. So a \`param\` output handed straight to a
\`BlendshapeNode\` arrives ~100x too small, and because that socket is cast to
\`int\`, anything under 1 truncates to **zero**: the shape simply never moves,
which looks exactly like a graph that isn't running.

Multiply on the way through, and make the factor a parameter rather than a
literal so it can be tuned live. Expect the factor to be large - on a real rig
the pendulum sums were ~0.004 and needed ~3000x to reach a useful range, not
the 100x the unit conversion alone implies. Read the actual parameter values
with \`vnyan_param action:'getFloat'\` while the rig moves rather than guessing:
at rest almost everything reads near zero, so sample during real motion.

## The fix pattern

**Step 1** - for each pendulum output, clear the direct target field
(\`gameObject\`, or \`blendshape\`/\`negative\`) and set \`param\` to a name unique to
that output. Both fields already exist on every output entry, so this is
configuration, not new machinery.

**Step 2** - a node graph sums the parameters on a fast timer loop and applies
the total with a single node.

Nodes used, all with \`values[]\` keys confirmed against real VNyan-written
graphs \`[observed]\`:

| Node | values | Role |
|---|---|---|
| \`TimerNode\` | \`{timerName}\` | event source, execIn 0 / execOut 1 |
| \`ParamOpNode\` | \`{paramName, value1, value2, operation}\` | two-input math, result to a parameter |
| \`FilterParamNode\` | \`{pname, pvalue}\` | 3-way branch on a comparison |
| \`BlendshapeNode\` | \`{bsName, bsValue, smoothTime, isToggle, const}\` | sets one blendshape |
| \`ObjectRotNode\` | \`{name, rotx, roty, rotz, seconds, toggle}\` | sets a GameObject's rotation |
| \`SetTimerNode\` | \`{timerName, seconds}\` | re-arms the timer |

Three details that silently break things:

1. **\`ParamOpNode.operation\` is a dropdown index as a string:** \`"0"\` add,
   \`"1"\` subtract, \`"2"\` multiply, \`"3"\` divide, \`"4"\` modulo. \`[source]\`
2. **\`SetTimerNode\`'s \`seconds\` is MILLISECONDS** despite the name - the help
   text reads "Milliseconds to trigger". Use \`"10"\`, not \`"0.01"\`. \`[help]\`
   \`[observed]\`
3. **\`ParamOpNode\` has no value output.** It writes to a parameter which the
   next node reads back as \`[paramName]\` in brackets. That bracket convention
   is how any node value marked "or parameter in brackets" pulls a live value.
   \`[help]\`

\`ParamOpNode\` takes exactly two inputs, so fold three or more contributors:

    _sum = [a] + [b]
    _sum = [_sum] + [c]

## Case A - transforms (GameObject outputs)

\`ObjectRotNode\` **zeroes any axis you don't specify** \`[help]\`, so all three
axes must be set in one node. Same for \`ObjectPosNode\` and \`ObjectScaleNode\` -
and on scale an omitted axis collapses the object to zero size, so it is the
least forgiving of the three.

\`\`\`json
{
  "graphName": "Pendulum Combine",
  "nodes": [
    { "id": "tick",  "type": "TimerNode",     "values": { "timerName": "PendulumCombine" } },
    { "id": "sumX",  "type": "ParamOpNode",   "values": { "paramName": "_pend_sum_x", "value1": "[_pend_a_x]", "value2": "[_pend_b_x]", "operation": "0" } },
    { "id": "sumY",  "type": "ParamOpNode",   "values": { "paramName": "_pend_sum_y", "value1": "[_pend_a_y]", "value2": "[_pend_b_y]", "operation": "0" } },
    { "id": "sumZ",  "type": "ParamOpNode",   "values": { "paramName": "_pend_sum_z", "value1": "[_pend_a_z]", "value2": "[_pend_b_z]", "operation": "0" } },
    { "id": "apply", "type": "ObjectRotNode", "values": { "name": "YourGameObject", "rotx": "[_pend_sum_x]", "roty": "[_pend_sum_y]", "rotz": "[_pend_sum_z]" } },
    { "id": "loop",  "type": "SetTimerNode",  "values": { "timerName": "PendulumCombine", "seconds": "10" } }
  ],
  "connections": [
    { "from": "tick", "to": "sumX" }, { "from": "tick", "to": "sumY" },
    { "from": "tick", "to": "sumZ" }, { "from": "tick", "to": "apply" },
    { "from": "tick", "to": "loop" }
  ]
}
\`\`\`

Every wire comes off \`tick\`'s single execOut because \`ParamOpNode\`,
\`ObjectRotNode\` and \`SetTimerNode\` are all terminal (zero execOut) - see
\`vnyan_guide topic:'node-authoring'\`.

## Case B - blendshapes

Two sub-cases needing different handling.

**B1 - absolute output**: a chain using the *same* blendshape in both
\`blendshape\` and \`negative\`. VNyan's net behaviour is \`|value|\`. Summing params
directly reproduces it, but **only if every contributor to that name is also
absolute**.

**B2 - signed pair**: \`blendshape\` differs from \`negative\`. These are two
*different* shapes, so a single \`BlendshapeNode\` cannot express the pair -
driving \`Shape_Squash\` by a negative number does **not** raise
\`Shape_Stretch\`. You must split the sign. Splitting is **not** a clash: a
clash is two writers on the same name, not one writer each on two names.

There is **no \`max\`/\`min\`/\`abs\`/\`clamp\`/\`sign\` node in VNyan** - verified
across all 304 node types - so a branch is the only mechanism.
\`FilterParamNode\`'s exec outputs are ordered **\`[0]\` greater, \`[1]\` equal,
\`[2]\` less** than \`pvalue\`. \`[source: FilterParamNode.cs]\`

\`\`\`json
{
  "graphName": "Blendshape Combine",
  "nodes": [
    { "id": "tick", "type": "TimerNode",       "values": { "timerName": "BsCombine" } },
    { "id": "sum",  "type": "ParamOpNode",     "values": { "paramName": "_bs_sum", "value1": "[_pend_a]", "value2": "[_pend_b]", "operation": "0" } },
    { "id": "neg",  "type": "ParamOpNode",     "values": { "paramName": "_bs_neg", "value1": "0", "value2": "[_bs_sum]", "operation": "1" } },
    { "id": "br",   "type": "FilterParamNode", "values": { "pname": "_bs_sum", "pvalue": "0" } },
    { "id": "posP", "type": "BlendshapeNode",  "values": { "bsName": "Shape_Squash", "bsValue": "[_bs_sum]", "smoothTime": "0", "isToggle": "0" } },
    { "id": "negZ", "type": "BlendshapeNode",  "values": { "bsName": "Shape_Stretch",  "bsValue": "0",         "smoothTime": "0", "isToggle": "0" } },
    { "id": "posZ", "type": "BlendshapeNode",  "values": { "bsName": "Shape_Squash", "bsValue": "0",         "smoothTime": "0", "isToggle": "0" } },
    { "id": "negP", "type": "BlendshapeNode",  "values": { "bsName": "Shape_Stretch",  "bsValue": "[_bs_neg]", "smoothTime": "0", "isToggle": "0" } },
    { "id": "loop", "type": "SetTimerNode",    "values": { "timerName": "BsCombine", "seconds": "10" } }
  ],
  "connections": [
    { "from": "tick", "to": "sum" },
    { "from": "tick", "to": "neg" },
    { "from": "tick", "to": "br" },
    { "from": "tick", "to": "loop" },
    { "from": "br", "fromIndex": 0, "to": "posP" },
    { "from": "br", "fromIndex": 0, "to": "negZ" },
    { "from": "br", "fromIndex": 2, "to": "posZ" },
    { "from": "br", "fromIndex": 2, "to": "negP" }
  ]
}
\`\`\`

**Why the zero-writes are mandatory:** \`BlendshapeNode\` does **not**
self-reset. Unlike \`Object*Node\` (which zeroes axes you omit), a blendshape
left undriven **latches at its last value**. So on the \`> 0\` branch you must
explicitly write the negative shape to \`0\`, and vice versa. Skip that and the
shape sticks.

The \`[1]\` (equal) branch is omitted above for brevity; wiring it to two
zero-writes is tidier if you want an exact rest state.

## Scaling this up

One \`ParamOpNode\` + \`FilterParamNode\` + two \`BlendshapeNode\`s per signed pair,
all hanging off one shared \`tick\`. Add pairs by repeating the block with new
parameter names - the timer, and the loop that re-arms it, stay single. Keep it
in its own graph tab so it can be reloaded without touching your event graphs.

## On execution order

The developer suggests an Ordered Execution node. That is a **refinement, not a
correctness requirement**: because the sums travel through parameters rather
than wires, the worst case without ordering is that the apply nodes read the
previous tick's values - a ~10 ms lag. If you want strict ordering, put an
\`OrderedNode\` between \`tick\` and the rest and wire each step to its own exec
output. Both \`OrderedNode\` and \`OrderedFlexNode\` size their exec outputs from
the Unity prefab, so \`vnyan_node_schema\` reports a floor - \`vnyan_graph_write\`
lets you wire past it and creates sockets as needed.
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
  menu** specifically so it does NOT need a restart. Direct-to-slot writing
  (the \`slot\` parameter) needs VNyan closed - **and is not merely
  inconvenient, it is unreliable.** VNyan persists its own in-memory copy of a
  tab over the file, so a verified slot write has been observed being silently
  replaced by an older graph, surviving only in the \`as<name>.json\` mirror.
  **Prefer Load Graph even when VNyan is already closed** - reopen and import.
  If you do write to a slot, re-verify it after VNyan next starts rather than
  assuming it stuck.
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
  "graph-performance": GRAPH_PERFORMANCE,
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
