# VNyanMcp plugin

A VNyan plugin (netstandard2.1 DLL) that opens a small, unauthenticated
HTTP RPC bridge on `127.0.0.1:8071`, so the [vnyan-mcp](../) MCP server can
both drive and read live VNyan state — parameters, triggers, avatar
blendshapes/bones, pendulum chains, props, colliders, Spout2 cameras,
stretch bones, and VNyanNet.

See the [repo root README](../README.md) for installation and usage. This
file covers building it from source.

## Building

```bash
dotnet build -c Release -p:VNyanPath="<your VNyan install folder>"
```

`VNyanPath` must point at the folder containing `VNyan.exe` (i.e. the one
with a `VNyan_Data\Managed\` subfolder). The build fails with a clear error
if it's missing or wrong — there is no built-in default, since every VNyan
install lives somewhere different.

Output: `bin\Release\netstandard2.1\VNyanMcp.dll`.

## Deploying

VNyan locks the DLL file while running, so:

1. Close VNyan.
2. Copy `VNyanMcp.dll` to `<VNyan install>\Items\Assemblies\`.
3. Enable **Allow Mods** in VNyan's Settings → Misc, if not already on.
4. Start VNyan and check `Player.log` for `[VNyanMcp] initialized`.

## Design notes

- **Zero hardcoded paths at runtime.** Everything is resolved from VNyan's
  own APIs — `Application.dataPath` for `Items\Assemblies`,
  `ISettingsInterface.getProfilePath()` for the profile directory. Only the
  *build-time* `VNyanPath` property points anywhere specific, and that's a
  build input, never embedded in the DLL.
- **Reflection is confined to `Reflect.cs`**, and only touches
  `Assembly-CSharp` members confirmed to survive obfuscation with their
  real names in the build this was tested against (`PropSystem`,
  `AvatarColliderSystem`, `Spout2CameraSystem`, `StretchBoneSystem`). Every
  entry point degrades to a per-call error rather than crashing the plugin
  if a future VNyan update renames or removes one of these — `rpc.health`
  reports which systems resolved.
- **`<DebugType>none</DebugType>`** in Release so no local source paths get
  embedded in the shipped DLL.
