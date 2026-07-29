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

## Known limits (state these plainly, don't imply otherwise)

- **Post-FX and lights are write-only at every tier.** The MCP tracks the
  value it just sent; it cannot read back the actual applied state.
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
  on-disk `redeemsN.json` file** until VNyan's own save happens (confirmed:
  the file is unchanged immediately after a live import that demonstrably
  took effect, and updated once VNyan quits). `vnyan_graph_read`/
  `vnyan_graph_list` reflect disk state, which can lag behind what's
  actually loaded live.
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
