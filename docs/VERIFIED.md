# VNyan MCP — verification record

Findings from building and testing this project against a live VNyan
install (Unity 2022.3.62f3, Mono scripting backend). Plugin deployed to
`Items\Assemblies\`, bridge on `http://127.0.0.1:8071`.

## End-to-end checklist

1. **Plugin loads.** ✅ `Player.log` shows `[VNyanMcp] initialized`; "MCP
   Bridge" button present in VNyan's plugin panel.
2. **Bridge is up.** ✅ `vnyan_status` → `rpc.health` reports all four
   reflection-tier systems (`props`, `colliders`, `spout2`, `stretchbones`)
   as `true`, with 55+ RPC methods registered.
3. **Round-trip readback.** ✅ `param.setFloat` → `param.getFloat` returns
   the same value — proof of the readback the native REST/WS/OSC ports
   can't offer at all.
4. **Live state read.** ✅ `avatar.blendshapes` returns a populated
   dictionary for the loaded avatar; `bone.get` returns a plausible
   rotation/position from the incoming tracking frame.
5. **Guarded write.** ✅ With VNyan running, `vnyan_settings_set` and
   `vnyan_graph_write --slot` both refuse and name the live PID. With VNyan
   closed, both succeed, back up first, and the change survives a VNyan
   restart.
6. **Graph authoring.** ✅ A 3-node graph (`APIMessageNode` fanned out to
   `SetParamNode` + `CallTriggerNode`), written to a slot and fired via
   `vnyan_api_fire`: the param changed and the trigger was recorded.
7. **Bridge graph.** ✅ All 4 curated actions (bloom, vignette, ambientLight,
   sunLight) fire cleanly via `vnyan_effect`/`vnyan_light` with zero new
   VNyan exceptions, confirmed via `Player.log` exception-count diffing and
   `trigger.recent`.
8. **Degradation.** ✅ Disk-backed tools (`vnyan_settings_get`,
   `vnyan_graph_read`, `vnyan_expression list`) work with VNyan closed.
   Plugin-backed tools (`vnyan_param`, `vnyan_status`) return a single
   actionable "bridge not responding" message with `isError: true` and no
   stack trace when VNyan is closed.

## Documentation pass

Every tool's every parameter has a `.describe()` (enforced by an automated
check — walk `listTools()`, assert no `inputSchema` property lacks a
description — so this can't silently regress as tools are added). A
`vnyan_guide` tool plus matching MCP resources (`vnyan://guide/<topic>`)
cover content too long for an inline description: a node-authoring
cookbook, the full bone-name list, a live settings-key index, pendulum
tuning, restart policy, and known limits — all served from one source
(`src/docs.ts`) so the text exists exactly once. A `vnyan://schema/nodes`
resource exposes the full node-type schema without one tool call per type.

`vnyan_stretchbone add` exposes the full `VNyanStretchBone` field set
(clamps, scale/move amounts, offsets, target offset), with defaults read
from the decompiled class rather than invented. `vnyan_spout addCamera`
accepts real position/rotation/focal length instead of a fixed value; its
4 trailing bool parameters are exposed as `flag1`-`flag4` with their
meaning stated as unidentified (the underlying method's signature is
obfuscated with no recoverable names) rather than guessed.

## Per-area coverage (the 15 requested areas)

| Area | Tool(s) | Tier | Status |
|---|---|---|---|
| Gestures | `vnyan_gesture` | disk (read-only) | ✅ reads `settings.Gestures[]` |
| Expressions | `vnyan_expression` | disk | ✅ list/read/export/import tested |
| Colliders | `vnyan_collider` | plugin (live) + disk | ✅ `get`/`set`/`diskList` tested |
| Effects | `vnyan_effect` | bridge graph (tier 3) | ✅ bloom + vignette fire clean |
| Lights | `vnyan_light` | bridge graph (tier 3) | ✅ ambientLight fires clean; sunLight fires but fixed-defaults only (see limits) |
| Settings (tracking/output/graphics/audio/connections/misc) | `vnyan_settings_get`/`_set` | disk | ✅ get tested across all six areas; guarded set tested |
| Node Graphs | `vnyan_graph_list/read/write`, `vnyan_node_schema` | disk | ✅ all four tested, incl. a real authored graph firing |
| Monitoring | `avatar.blendshapes`, `bone.get`, `trigger.recent`, `net.recent` | plugin (live) | ✅ all tested |
| Props | `vnyan_prop` | disk (list) + plugin (set/toggle) | ✅ `list` tested; `set`/`toggle` implemented on the same verified RPC pattern as pendulum/collider |
| Pendulums | `vnyan_pendulum` | disk (list) + plugin (create/delete/drive) | ✅ both tested — runtime create→chains→delete round-tripped |
| Stretch Bones | `vnyan_stretchbone` | disk (list) + plugin (add) | ✅ both tested — `add` fires with zero new exceptions across the full field set |
| Stickers | — | unsupported | No safely-identifiable entry point exists — every candidate method shares an identical signature with several decoys, with no real name surviving obfuscation for any of them — intentionally not built |
| Plugins | `vnyan_plugin_list` | filesystem + reflection over dropped DLLs | ✅ reports installed plugin manifests |
| VNyanNet | `vnyan_vnyannet` | plugin (live) | ✅ degrades to empty results (not an error) when VNyanNet isn't configured |
| Spout2 / cameras | `vnyan_spout` | plugin (live) | ✅ both tested — `addCamera` with explicit position/rotation/focalLength, confirmed via `listCameras` |

## Pendulum data model — every field, source-verified

Evidence tags used throughout this file: `[source]` decompiled VNyan code,
`[dev-doc]` VNyan's shipped `VNyanInterface.xml`, `[help]` VNyan's shipped
help files, `[observed]` a real VNyan-written config or graph, `[repro]`
reproduced live against a running VNyan.

### Methodology: obfuscation emits contradictory duplicates

VNyan's assembly is obfuscated by emitting **multiple plausible duplicates**
of each method, salted with decoy string and float literals. Reading a
**setter** is therefore unreliable. Concretely: `AddInput`'s call sites
(`ChainSystem.cs` lines 224 / 275 / 365 / 461 / 689) pass mutually *inverted*
flags, and its constructor blocks (389 / 604 / 759) compare differently. Only
one path is live and static reading cannot tell which.

**Read the consumer instead.** `ValueChainRoot.cs` uses both input flags
identically across every duplicate and ends in two unambiguous assignments,
which settles their meaning. Rule: **when duplicates disagree, trust the
consumer over the setter — and never trust a method name over its body.**

### Naming traps — both of these assign, neither accumulates

```csharp
// BlendShapeSystem.AddOverrideBlendshape — "Add" means add a DICTIONARY ENTRY
previous = entry.Value;
entry.Value = value;          // replaces
entry.StartValue = previous;  // old value survives only as a tween origin

// PosRotSystem.SetAddChainRotation — assigns per axis, no +=
switch (transform) { case 0: value.xValue = amount; case 1: yValue; case 2: zValue; }
```

`[source]` This is why two pendulums on one target cancel out rather than
layering: the second writer overwrites the first every frame.

### Inputs `[source: ValueChainRoot.cs]`

- `isBlendshape` — `true` reads a blendshape via
  `BlendShapeSystem.GetAccumulatedValue`; `false` reads a numeric parameter
  from `ParamSystem`.
- `multiplier` — scales the driving value (stored internally as `efficiency`).
- `isRotation` — selects which property of the chain root the input drives:
  `false` accumulates into `localPosition` (X), so the root is *translated*
  and the chain **swings back and forth as the value changes, settling when
  it stops**; `true` accumulates into `localRotation`
  (`Quaternion.Euler`, Z), so the root is *tilted* and the chain **swings to
  an angle and stays there**. The two accumulators end in
  `transform.localPosition = zero;` and
  `transform.localRotation = Quaternion.Euler(zero2);`. `[dev-doc]`
  corroborates — the plugin API exposes the same two modes as
  `setPositionValue` ("swing back and forth") and `setRotationValue` ("swing
  to a certain angle and remain there").

### Outputs `[source: ValueChainBone.cs, PosRotSystem.cs]`

`num` is the bone's X displacement from the chain root. Every path computes
`num * multiplier + offset`, but they are **not** otherwise equivalent:

| Field | Written | When |
|---|---|---|
| `blendshape` | `num * multiplier + offset` | only `num > 0` |
| `negative` | `(-num) * multiplier + offset` | only `num < 0` |
| `param` | `num * multiplier + offset` | **always — raw signed, no split** |
| `gameObject` | `num * multiplier + offset` | always, via `SetAddChainRotation(name.ToLower(), transform, …)` |

- `bone` — index into the chain's bones; higher = further from root = more lag.
- `transform` — axis selector for `gameObject`: **0 = X, 1 = Y, 2 = Z**.
- `gameObject` matching is **case-insensitive** (`.ToLower()`).
- **Offset asymmetry:** the negative path negates `num` *before* applying
  multiplier and offset, so with a non-zero `offset` the directions are not
  mirror images.
- **The consequential asymmetry:** VNyan splits positive/negative *only* when
  writing blendshapes directly. A `param` output receives the signed value, so
  rerouting through parameters means you own the split.

### Clash granularity — differs per output kind

| Output kind | Keyed by | One writer per |
|---|---|---|
| `blendshape` / `negative` | blendshape name | the name |
| `gameObject` | `(name.ToLower(), transform)` | object **and axis** |
| `param` | parameter name | the name |

Two pendulums on the **same GameObject but different axes do not clash** —
separate `xValue`/`yValue`/`zValue` fields. Two outputs sharing a **`param`
name do clash**, which is why the fix pattern gives every output its own
parameter. `vnyan_pendulum action:'list'` reports all three kinds at this
granularity, including a chain that clashes with itself.

### Combining pendulums — mechanics

- **No `max`/`min`/`abs`/`clamp`/`sign` node exists in VNyan** — verified
  across all 304 node types. A sign split therefore requires a branch.
- `FilterParamNode`'s exec outputs are ordered **`[0]` greater, `[1]` equal,
  `[2]` less** than `pvalue` `[source: FilterParamNode.cs]`. Authorable only
  because its prefab-sized `SocketOutput[]` is now handled as a dynamic socket.
- **`BlendshapeNode` does not self-reset.** Unlike `Object*Node` (which zeroes
  any axis you omit `[help]`), a blendshape left undriven latches at its last
  value — so each branch must explicitly write the opposite shape to `0`.
- `ParamOpNode.operation` is a dropdown index as a string: `"0"` add, `"1"`
  subtract, `"2"` multiply, `"3"` divide, `"4"` modulo `[source]`.
- `SetTimerNode`'s `seconds` value is **milliseconds** `[help]` `[observed]`.

Full recipe with worked graphs: `vnyan_guide topic:'pendulum-composition'`.

## Blendshape write model — why summing must happen in a graph

`[source: BlendShapeSystem.cs]` There are **six independent channels**, each
with its own dictionary: `AddARKitBlendshape` (tracking),
`AddAudioBlendshape` (lipsync), `AddVMCBlendshape`, `AddMMDBlendshape`,
`AddDefaultBlendshape`, and `AddOverrideBlendshape`. `GetAccumulatedValue`
sums *across* channels — but **within** a channel one name has exactly one
slot, and `AddOverrideBlendshape` assigns rather than accumulates.

Pendulums and `BlendshapeNode` both use the **override** channel, so two
writers to one name overwrite each other. The other five are owned by
tracking, lipsync and friends, so they are not available to borrow.

**This rules out the obvious shortcuts — don't spend time rediscovering them:**

- There is **no additive multi-writer path** within a channel.
- `SetBlendshapeModeAdd` only flips `VRMBlendshapeSettings.useAddBlendshapes`,
  the global VRM *clip→mesh* render mode — not a per-writer accumulator. It
  changes how every blendshape on the model resolves.
- `BlendshapeParamLink` looks like a native param→blendshape binding, and is —
  but it is a `MonoBehaviour` with `[AddComponentMenu]`, attached to the model
  in the Unity editor. A graph cannot create one, and it writes
  `SetBlendShapeWeight` directly, bypassing the blendshape system.
- `ParamBSNode` is **blendshape → parameter**, the opposite direction.

So the only route for combining contributions onto one shape is: each
contributor publishes a parameter, a graph sums them, one node writes the
shape. That is what `pendulum-composition` documents.

**Two `BlendshapeNode` details that bite** `[source]` `[help]` `[repro]`: its
wired value socket is cast to `int` (a float source throws
`InvalidCastException` and the write vanishes — insert `DecimalToNumberNode`),
and `bsValue: "0"` **removes** the override rather than writing zero, which
resets the smoothing origin. A shape must never be zeroed and then written in
the same tick.

## Node schema quality

`src/graph/schema.json` is regenerated by `tools/extract-node-schema.py`.

- Socket counts and `valueInFields`/`valueOutFields` come from declared C#
  fields — **reliable**.
- `dynamicSockets` marks the 30 types whose socket count comes from the Unity
  prefab or is built at runtime (array/`List<>` socket fields, and every
  "Flex" node). For those the count is a **floor**; `vnyan_graph_write` grows
  sockets on demand. Without this, every branching node — `OrderedNode`, all
  `Filter*Node`, `CompareTextNode`, `RandomNode`, `CyclerNode`,
  `TextSwitchNode` — was unauthorable, because the builder sized its arrays to
  a reported 0.
- **`values[]` keys cannot be read reliably from source.** Method bodies are
  decoy-salted; re-running the extraction with a different tie-break produced
  *different wrong answers* for 6 types. So keys are taken from real
  VNyan-written graphs where possible (71 of 304), from a hand-checked help
  file for a few more, and otherwise flagged `valuesUncertain`.
- `valuesCountMismatch` is a stronger warning on 66 of those uncertain
  entries: their field count disagrees with VNyan's own help file, so the keys
  are probably wrong. The help file can flag a mismatch but **cannot supply
  the right names** — its labels don't map to keys (`SetTimerNode`'s
  "Milliseconds to trigger" is the key `seconds`). Confirm with
  `vnyan_graph_read` against a graph already using the node.

## Known limits (state these plainly, don't imply otherwise)

- **Post-FX and lights are write-only at every tier.** No getter exists in the
  plugin API or in any reflected system — this is an argument from absence, not
  a positive test. The MCP tracks the value it last sent; it cannot read back
  the actual applied state, and must not present the tracked value as observed.
- **`SunLightNode` has an unexplained runtime bug:** any wired value-socket
  throws `InvalidCastException` inside VNyan's own trigger processing, even
  through the same converter-node pattern that works cleanly for
  `EffectBloomNode`/`EffectVignetteNode`. Worked around by shipping
  `sunLight` as a fixed-defaults, fire-only trigger (turns the light on, no
  live intensity/toggle control) rather than leave it broken.
- **Value sockets are strongly typed at runtime**, unlike the always-string
  `values[]` JSON — wiring a mismatched type (e.g. a text output straight
  into a float input) throws inside VNyan and silently aborts the whole
  call, including notifying the plugin's own trigger listener. Always route
  through `TextToDecimalNode`/`TextToBoolNode` when bridging a parameter.
- **`NodeGraphCount` gates which graph slots VNyan actually executes**,
  independent of which files exist on disk — a graph in an uncounted slot
  loads with no error but never runs. `vnyan_graph_list` probes past the
  declared count for display purposes, but a slot beyond the count still
  won't execute until the count covers it.
- **VNyan's live "Load Graph" import updates the running graph but not the
  on-disk `redeemsN.json` file** until VNyan saves. `[observed]` once: the file
  was unchanged immediately after a live import that demonstrably took effect,
  and correct after VNyan quit. Quit is therefore *a* save trigger; whether
  others exist was not tested. `vnyan_graph_read`/`vnyan_graph_list` reflect
  disk state, which can lag behind what is actually loaded live.
- **Reflection-backed areas** (props, colliders, Spout2, stretch bones) use
  method/field names verified to survive obfuscation in the
  `Assembly-CSharp.dll` build this was tested against. A VNyan update can
  break them silently; `rpc.health` is the canary — check it after any
  VNyan update.
- **Settings/graph-slot writes require VNyan closed.** Not engineerable
  away: VNyan rewrites `settings.json` (triple: `.json`, `.dat`,
  `_as.json`) and can rewrite a graph slot on its own save. Node graph
  authoring defaults to exporting a file for live import via VNyan's own
  "Load Graph" menu instead, avoiding the restart for that workflow.
