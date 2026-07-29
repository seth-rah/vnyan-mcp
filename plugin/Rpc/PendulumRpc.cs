using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using VNyanInterface;

namespace VNyanMcp.Rpc
{
    public static class PendulumRpc
    {
        private static IPendulumInterface Pd => VNyanInterface.VNyanInterface.VNyanPendulum;

        private static readonly object HandleLock = new object();
        private static readonly Dictionary<int, IPendulumRoot> Handles = new Dictionary<int, IPendulumRoot>();
        private static int _nextHandle = 1;

        public static void Register()
        {
            RpcRegistry.Register("pendulum.create", p =>
            {
                var root = Pd.createPendulumChain(
                    p.GetInt("boneCount", 4),
                    p.GetFloat("damping", 0.1f),
                    p.GetFloat("elasticity", 0.1f),
                    p.GetFloat("stiffness", 0.1f),
                    p.GetFloat("inert", 0f));
                int handle;
                lock (HandleLock)
                {
                    handle = _nextHandle++;
                    Handles[handle] = root;
                }
                return new JObject { ["handle"] = handle };
            });

            RpcRegistry.Register("pendulum.delete", p =>
            {
                var handle = p.GetInt("handle");
                IPendulumRoot root;
                lock (HandleLock)
                {
                    if (!Handles.TryGetValue(handle, out root))
                        throw new ArgumentException("unknown pendulum handle: " + handle);
                    Handles.Remove(handle);
                }
                Pd.deletePendulumChain(root);
                return new JObject { ["handle"] = handle };
            });

            RpcRegistry.Register("pendulum.setPosition", p =>
            {
                var root = GetHandle(p.GetInt("handle"));
                var value = p.GetFloat("value");
                root.setPositionValue(value);
                return new JObject { ["value"] = value };
            });

            RpcRegistry.Register("pendulum.setRotation", p =>
            {
                var root = GetHandle(p.GetInt("handle"));
                var value = p.GetFloat("value");
                root.setRotationValue(value);
                return new JObject { ["value"] = value };
            });

            RpcRegistry.Register("pendulum.chains", p =>
            {
                var root = GetHandle(p.GetInt("handle"));
                var chains = root.getChains() ?? new List<IPendulumChain>();
                return new JArray(chains.Select(c => (object)c.getValue()));
            });
        }

        private static IPendulumRoot GetHandle(int handle)
        {
            lock (HandleLock)
            {
                if (Handles.TryGetValue(handle, out var root)) return root;
                throw new ArgumentException("unknown pendulum handle: " + handle);
            }
        }
    }
}
