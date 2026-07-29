# vnyan-mcp

An MCP server for full-coverage control of [VNyan](https://suvidriel.itch.io/vnyan)
(VTuber avatar software) from Claude or any other MCP client — parameters,
triggers, blendshapes, bones, pendulums, props, colliders, node graphs, and
more.

VNyan's own automation ports (REST/WebSocket/OSC) are fire-and-forget only —
they can trigger things but never read state back. This project ships a
small VNyan plugin that opens a real two-way bridge, plus an MCP server that
talks to it, so an LLM can both *drive* your avatar and *observe* it.

## What it covers

- **Parameters, dictionaries, triggers** — get/set VNyan's runtime variables,
  call named triggers, watch recent trigger activity
- **Avatar** — live blendshape values and overrides, humanoid bone
  read/write
- **Pendulum chains, stretch bones, colliders, props, Spout2 cameras** —
  read the persisted config and drive them live
- **Node graphs** — read, author, and export/import VNyan's visual node
  graphs; a generated "bridge graph" makes post-processing effects and
  lights controllable
- **Settings** — read the full `settings.json` config (tracking, output,
  graphics, audio, connections, misc) and write it with guardrails
- **VNyanNet, plugin inventory, native REST/WebSocket/OSC passthroughs**

Full capability list and verified behavior: [`docs/VERIFIED.md`](docs/VERIFIED.md).

## Requirements

- VNyan, with **Allow Mods** enabled (Settings → Misc)
- Node.js ≥ 22
- Windows (VNyan itself is Windows-only)

## Install

### Step 1 — the plugin

1. Download `VNyanMcp.dll` from the [latest release](../../releases/latest).
2. Close VNyan if it's running.
3. Drop the DLL into `<your VNyan folder>\Items\Assemblies\`.
4. In VNyan, enable **Allow Mods** (Settings → Misc) if you haven't already.
5. Start VNyan.
6. Confirm it loaded: open `Player.log` in VNyan's profile directory
   (Settings → Misc → Open Log Folder, or
   `%USERPROFILE%\AppData\LocalLow\Suvidriel\VNyan\Player.log` by default)
   and look for `[VNyanMcp] initialized`.

### Step 2 — the MCP server

With [Claude Code](https://claude.com/claude-code):

```bash
claude mcp add vnyan -- npx -y github:seth-rah/vnyan-mcp
```

For Claude Desktop or another MCP client, add this to your MCP config:

```json
{
  "mcpServers": {
    "vnyan": {
      "command": "npx",
      "args": ["-y", "github:seth-rah/vnyan-mcp"]
    }
  }
}
```

No manual build step needed — `npx` installs and builds it on first run.

### Verify

Ask your MCP client to call `vnyan_status`. All four reflection systems
(`props`, `colliders`, `spout2`, `stretchbones`) should report `true`, and
it will show which VNyan profile directory it resolved and how (see
Configuration below — nothing is hardcoded).

## Configuration

Every path this server needs is resolved at runtime, not hardcoded. Env
vars, all optional:

| Variable | Purpose | Default |
|---|---|---|
| `VNYAN_PROFILE_DIR` | VNyan's profile directory (settings, colliders, node graphs) | Asked from the running plugin; falls back to the conventional `%USERPROFILE%\AppData\LocalLow\Suvidriel\VNyan` path if the plugin isn't reachable |
| `VNYAN_MCP_GRAPH_EXPORT_DIR` | Where authored/exported node graphs are written | `<resolved profile dir>\Exports` |
| `VNYAN_MCP_BRIDGE_URL` | The plugin's HTTP bridge | `http://127.0.0.1:8071/rpc` |
| `VNYAN_REST_URL` | VNyan's built-in REST API (native port passthrough) | `http://127.0.0.1:8069/` |
| `VNYAN_WS_URL` | VNyan's built-in WebSocket (native port passthrough) | `ws://127.0.0.1:8000/vnyan` |
| `VNYAN_OSC_HOST` / `VNYAN_OSC_PORT` | VNyan's OSC receiver (native port passthrough) | `127.0.0.1` / `28569` |

## Security note

The plugin's bridge listens on `127.0.0.1:8071` — **loopback-only, but
unauthenticated**. Any process running as you on your own machine can
reach it and drive your avatar while VNyan is running. This is a
deliberate tradeoff (matching VNyan's own REST/WS/OSC ports, which have
the same property) rather than an oversight, but you should know about it
before installing.

## What needs VNyan closed

Only `settings.json` writes (`vnyan_settings_set`, and the
Props/Chains/StretchBones/Gestures/Expressions writes that live inside it)
require closing VNyan — it rewrites that file on every save and would
silently clobber an external edit. Everything else, including node graph
authoring (which exports a file for live import via VNyan's own "Load
Graph" menu), works with VNyan running. Details:
`vnyan_guide topic:'restart-policy'`.

## Known limits

See [`docs/VERIFIED.md`](docs/VERIFIED.md) for the full list. Highlights:
post-processing effects and lights are write-only at every tier (no
readback exists in VNyan); `SunLightNode` has an unexplained VNyan-side bug
that limits its bridge action to fixed defaults; reflection-backed
capabilities (props, colliders, Spout2, stretch bones) depend on internal
names that could change in a future VNyan update — `vnyan_status` is the
canary if something breaks.

## Building the plugin yourself

```bash
cd plugin
dotnet build -c Release -p:VNyanPath="<your VNyan install folder>"
```

The build fails with a clear error if `VNyanPath` is missing or doesn't
point at a real VNyan install. The bundled node-type schema
(`src/graph/schema.json`) and the reflection-backed capabilities were
generated against Unity `2022.3.62f3` — if a VNyan update changes node
types or breaks a reflected capability, `vnyan_status` will show it.

## License

MIT — see [`LICENSE`](LICENSE).
