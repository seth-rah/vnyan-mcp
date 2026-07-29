using System;
using Newtonsoft.Json.Linq;
using UnityEngine;
using VNyanInterface;

namespace VNyanMcp.Rpc
{
    public static class AvatarRpc
    {
        private static IAvatarInterface A => VNyanInterface.VNyanInterface.VNyanAvatar;
        private static readonly McpPoseLayer PoseLayer = new McpPoseLayer();

        public static void Register()
        {
            A?.registerPoseLayer(PoseLayer);

            RpcRegistry.Register("avatar.loaded", _ => A.getAvatarObject() != null);

            RpcRegistry.Register("avatar.blendshapes", _ =>
            {
                var dict = A.getBlendshapesInstant();
                var result = new JObject();
                if (dict != null)
                    foreach (var kv in dict) result[kv.Key] = kv.Value;
                return result;
            });

            RpcRegistry.Register("avatar.blendshape", p =>
            {
                var name = p.RequireString("name");
                var mode = p.GetString("mode", "instant");
                return mode.Equals("lastFrame", StringComparison.OrdinalIgnoreCase)
                    ? A.getBlendshapeLastFrame(name)
                    : A.getBlendshapeInstant(name);
            });

            RpcRegistry.Register("avatar.setBlendshapeOverride", p =>
            {
                var name = p.RequireString("name");
                var value = p.GetFloat("value");
                A.setBlendshapeOverride(name, value);
                return new JObject { ["name"] = name, ["value"] = value };
            });

            RpcRegistry.Register("avatar.clearBlendshapeOverride", p =>
            {
                var name = p.RequireString("name");
                A.clearBlendshapeOverride(name);
                return new JObject { ["name"] = name };
            });

            RpcRegistry.Register("avatar.setMeshBlendshapeOverride", p =>
            {
                var name = p.RequireString("name");
                var value = p.GetFloat("value");
                A.setMeshBlendshapeOverride(name, value);
                return new JObject { ["name"] = name, ["value"] = value };
            });

            RpcRegistry.Register("avatar.clearMeshBlendshapeOverride", p =>
            {
                var name = p.RequireString("name");
                A.clearMeshBlendshapeOverride(name);
                return new JObject { ["name"] = name };
            });

            // Bones addressed by UnityEngine.HumanBodyBones name (e.g. "Head", "LeftUpperArm").
            // Rotation is exposed as Euler degrees for ergonomics; internally VNyan uses quaternions.
            RpcRegistry.Register("bone.get", p =>
            {
                var bone = ParseBone(p.RequireString("bone"));
                var rot = PoseLayer.GetLastFrameBoneRotation((int)bone);
                var pos = PoseLayer.GetLastFrameBonePosition((int)bone);
                var result = new JObject { ["bone"] = bone.ToString() };
                if (rot != null)
                {
                    var euler = new Quaternion(rot.X, rot.Y, rot.Z, rot.W).eulerAngles;
                    result["rotationEuler"] = new JObject { ["x"] = euler.x, ["y"] = euler.y, ["z"] = euler.z };
                }
                if (pos != null)
                    result["position"] = new JObject { ["x"] = pos.X, ["y"] = pos.Y, ["z"] = pos.Z };
                return result;
            });

            RpcRegistry.Register("bone.set", p =>
            {
                var bone = ParseBone(p.RequireString("bone"));
                var x = p.GetFloat("x");
                var y = p.GetFloat("y");
                var z = p.GetFloat("z");
                var q = Quaternion.Euler(x, y, z);
                PoseLayer.SetBoneRotation((int)bone, new VNyanQuaternion { X = q.x, Y = q.y, Z = q.z, W = q.w });
                return new JObject { ["bone"] = bone.ToString(), ["rotationEuler"] = new JObject { ["x"] = x, ["y"] = y, ["z"] = z } };
            });

            RpcRegistry.Register("bone.clear", p =>
            {
                var bone = ParseBone(p.RequireString("bone"));
                PoseLayer.ClearBoneRotation((int)bone);
                return new JObject { ["bone"] = bone.ToString() };
            });
        }

        private static HumanBodyBones ParseBone(string name)
        {
            if (!Enum.TryParse<HumanBodyBones>(name, true, out var bone))
                throw new ArgumentException("unknown bone name: " + name);
            return bone;
        }
    }
}
