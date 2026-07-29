using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace VNyanMcp
{
    /// <summary>
    /// Tier-2 capability surface: direct calls into VNyan's own (obfuscated)
    /// Assembly-CSharp, confined to the handful of members verified by
    /// decompiling this exact build to still carry their real names -
    /// PropSystem, AvatarColliderSystem (fields only - Update() re-applies
    /// them every frame, no method call needed), Spout2CameraSystem and
    /// StretchBoneSystem. Every entry point is wrapped so a VNyan update
    /// that removes/renames one of these degrades to a per-call error
    /// instead of taking the whole plugin down; rpc.health probes each
    /// system with a cheap call so that degradation is visible up front.
    /// </summary>
    public static class Reflect
    {
        private static readonly Dictionary<string, Func<bool>> HealthProbes = new Dictionary<string, Func<bool>>();

        public static void RegisterAll()
        {
            RegisterProps();
            RegisterColliders();
            RegisterSpout();
            RegisterStretchBones();
            RegisterPluginInventory();

            HealthProbes["props"] = () => PropSystem.getInstance() != null;
            HealthProbes["colliders"] = () => AvatarColliderSystem.getInstance() != null;
            HealthProbes["spout2"] = () => Spout2CameraSystem.getInstance() != null;
            HealthProbes["stretchbones"] = () => StretchBoneSystem.getInstance() != null;

            RpcRegistry.Register("rpc.health", _ =>
            {
                var result = new JObject();
                foreach (var kv in HealthProbes)
                {
                    bool ok;
                    try { ok = kv.Value(); }
                    catch { ok = false; }
                    result[kv.Key] = ok;
                }
                return result;
            });

            RpcRegistry.Register("rpc.docs", _ => new JObject
            {
                ["bridgePort"] = 8071,
                ["pluginVersion"] = "0.1.0",
                ["reflectionTierSystems"] = new JArray(HealthProbes.Keys),
            });
        }

        // ---- Props ----------------------------------------------------

        private static void RegisterProps()
        {
            RpcRegistry.Register("prop.set", p =>
            {
                var name = p.RequireString("name");
                var active = p.GetBool("active", true);
                PropSystem.getInstance().SetProp(name, active);
                return new JObject { ["name"] = name, ["active"] = active };
            });

            RpcRegistry.Register("prop.toggle", p =>
            {
                var name = p.RequireString("name");
                PropSystem.getInstance().ToggleProp(name);
                return new JObject { ["name"] = name };
            });
        }

        // ---- Colliders --------------------------------------------------
        // Public fields only: AvatarColliderSystem.Update() re-reads these
        // every frame and re-applies collider transform scale/offset, so a
        // plain field write is self-applying - no follow-up call needed.

        private static void RegisterColliders()
        {
            RpcRegistry.Register("collider.get", _ =>
            {
                var c = AvatarColliderSystem.getInstance();
                if (c == null) throw new InvalidOperationException("AvatarColliderSystem not available (no avatar loaded?)");
                return new JObject
                {
                    ["headSize"] = c.HeadColliderSize,
                    ["headOffset"] = c.HeadColliderOffset,
                    ["torsoSize"] = c.TorsoColliderSize,
                    ["torsoOffset"] = c.TorsoColliderOffset,
                    ["handSize"] = c.HandColliderSize,
                };
            });

            RpcRegistry.Register("collider.set", p =>
            {
                var c = AvatarColliderSystem.getInstance();
                if (c == null) throw new InvalidOperationException("AvatarColliderSystem not available (no avatar loaded?)");
                if (p["headSize"] != null) c.HeadColliderSize = p.GetFloat("headSize");
                if (p["headOffset"] != null) c.HeadColliderOffset = p.GetFloat("headOffset");
                if (p["torsoSize"] != null) c.TorsoColliderSize = p.GetFloat("torsoSize");
                if (p["torsoOffset"] != null) c.TorsoColliderOffset = p.GetFloat("torsoOffset");
                if (p["handSize"] != null) c.HandColliderSize = p.GetFloat("handSize");
                return new JObject
                {
                    ["headSize"] = c.HeadColliderSize,
                    ["headOffset"] = c.HeadColliderOffset,
                    ["torsoSize"] = c.TorsoColliderSize,
                    ["torsoOffset"] = c.TorsoColliderOffset,
                    ["handSize"] = c.HandColliderSize,
                };
            });
        }

        // ---- Spout2 cameras ---------------------------------------------
        // Only AddCamera + the spout2Cameras list are confirmed real names.
        // No safely-identifiable remove/delete method exists in this build
        // (candidates share an identical signature with several decoys) -
        // removal stays a VNyan-UI-only action.

        private static void RegisterSpout()
        {
            RpcRegistry.Register("spout.listCameras", _ =>
            {
                var sys = Spout2CameraSystem.getInstance();
                var list = sys?.spout2Cameras ?? new List<Spout2Camera>();
                return new JArray(list.Where(c => c != null).Select(c => new JObject
                {
                    ["name"] = c.SpoutOutputName,
                    ["resolution"] = $"{c.Resolution.x}x{c.Resolution.y}",
                    ["linkedToMainCamera"] = c.LinkToMainCamera,
                }));
            });

            RpcRegistry.Register("spout.addCamera", p =>
            {
                var sys = Spout2CameraSystem.getInstance();
                if (sys == null) throw new InvalidOperationException("Spout2CameraSystem not available");
                var width = p.GetInt("width", 1920);
                var height = p.GetInt("height", 1080);
                var name = p.RequireString("name");
                var linkToMainCamera = p.GetBool("linkToMainCamera", true);
                var position = new Vector3(p.GetFloat("posX", 0), p.GetFloat("posY", 0), p.GetFloat("posZ", 0));
                var rotation = Quaternion.Euler(p.GetFloat("rotX", 0), p.GetFloat("rotY", 0), p.GetFloat("rotZ", 0));
                var focalLength = p.GetFloat("focalLength", 35f);
                // The trailing 4 bools in Spout2CameraSystem.AddCamera have no
                // recoverable names (obfuscated signature) - exposed positionally,
                // meaning documented as "unidentified" rather than guessed.
                var flag1 = p.GetBool("flag1", false);
                var flag2 = p.GetBool("flag2", false);
                var flag3 = p.GetBool("flag3", false);
                var flag4 = p.GetBool("flag4", false);
                var cam = sys.AddCamera(width, height, name, linkToMainCamera,
                    position, rotation, focalLength, flag1, flag2, flag3, flag4);
                return new JObject { ["name"] = cam?.SpoutOutputName ?? name };
            });
        }

        // ---- Stretch bones ------------------------------------------------

        private static void RegisterStretchBones()
        {
            RpcRegistry.Register("stretchbone.add", p =>
            {
                var sys = StretchBoneSystem.getInstance();
                if (sys == null) throw new InvalidOperationException("StretchBoneSystem not available");
                // Defaults below are VNyanStretchBone's own field initializers,
                // not invented - read from the decompiled class.
                var b = new VNyanStretchBone
                {
                    name = p.RequireString("name"),
                    targetName = p.GetString("targetName", ""),
                    anchorName = p.GetString("anchorName", ""),
                    stretchBoneName = p.GetString("stretchBoneName", ""),
                    targetOffset = new Vector3(
                        p.GetFloat("targetOffsetX", 0), p.GetFloat("targetOffsetY", 0), p.GetFloat("targetOffsetZ", 0)),
                    minClampX = p.GetFloat("minClampX", 0.5f),
                    minClampY = p.GetFloat("minClampY", 0.97f),
                    minClampZ = p.GetFloat("minClampZ", 0.5f),
                    maxClampX = p.GetFloat("maxClampX", 1f),
                    maxClampY = p.GetFloat("maxClampY", 2f),
                    maxClampZ = p.GetFloat("maxClampZ", 1f),
                    scaleAmountX = p.GetFloat("scaleAmountX", 0.5f),
                    scaleAmountY = p.GetFloat("scaleAmountY", 1f),
                    scaleAmountZ = p.GetFloat("scaleAmountZ", 1f),
                    moveAmountX = p.GetFloat("moveAmountX", 0.19f),
                    moveAmountY = p.GetFloat("moveAmountY", 0.03f),
                    moveAmountZ = p.GetFloat("moveAmountZ", 0.16f),
                    offsetRotation = new Vector3(
                        p.GetFloat("offsetRotationX", 0), p.GetFloat("offsetRotationY", 0), p.GetFloat("offsetRotationZ", 0)),
                    moveOffsetX = p.GetFloat("moveOffsetX", -1f),
                    moveOffsetY = p.GetFloat("moveOffsetY", -1f),
                    moveOffsetZ = p.GetFloat("moveOffsetZ", -1f),
                    blendshapeName = p.GetString("blendshapeName", ""),
                    blendshapeAxis = p.GetInt("blendshapeAxis", 0),
                    blendshapeInvert = p.GetBool("blendshapeInvert", false),
                    blendshapeMultiplier = p.GetFloat("blendshapeMultiplier", 1f),
                };
                sys.AddStretchBone(b);
                return new JObject { ["name"] = b.name };
            });
        }

        // ---- Plugin inventory --------------------------------------------
        // Plain filesystem + reflection over dropped plugin DLLs - not
        // reaching into VNyan's own obfuscated internals at all.

        private static void RegisterPluginInventory()
        {
            RpcRegistry.Register("plugin.list", _ =>
            {
                var assembliesDir = FindAssembliesDir();
                var result = new JArray();
                if (assembliesDir != null && Directory.Exists(assembliesDir))
                {
                    foreach (var dll in Directory.GetFiles(assembliesDir, "*.dll"))
                    {
                        var entry = new JObject { ["file"] = Path.GetFileName(dll) };
                        try
                        {
                            var asm = System.Reflection.Assembly.LoadFrom(dll);
                            var manifestType = asm.GetTypes().FirstOrDefault(t =>
                                typeof(VNyanInterface.IVNyanPluginManifest).IsAssignableFrom(t) && !t.IsInterface && !t.IsAbstract);
                            if (manifestType != null)
                            {
                                var inst = Activator.CreateInstance(manifestType) as VNyanInterface.IVNyanPluginManifest;
                                if (inst != null)
                                {
                                    entry["pluginName"] = inst.PluginName;
                                    entry["version"] = inst.Version;
                                    entry["title"] = inst.Title;
                                    entry["author"] = inst.Author;
                                }
                            }
                        }
                        catch (Exception e)
                        {
                            entry["error"] = e.Message;
                        }
                        result.Add(entry);
                    }
                }
                return result;
            });
        }

        private static string FindAssembliesDir()
        {
            // Application.dataPath = "...\VNyan\VNyan_Data" - a stable Unity
            // API, unlike Assembly.Location which Mono can leave empty for
            // assemblies loaded from a Unity build.
            var vnyanDataDir = Application.dataPath.Replace('/', Path.DirectorySeparatorChar);
            var vnyanRoot = Directory.GetParent(vnyanDataDir)?.FullName;
            return vnyanRoot == null ? null : Path.Combine(vnyanRoot, "Items", "Assemblies");
        }
    }
}
