using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using VNyanInterface;

namespace VNyanMcp.Rpc
{
    public static class NetRpc
    {
        private const int RingCap = 500;
        private static readonly object RingLock = new object();
        private static readonly LinkedList<JObject> Ring = new LinkedList<JObject>();

        private class RpcListener : IRPCHandler
        {
            public void rpcCalled(string rpcName, string playerName, string val1, string val2, string val3, float val4, float val5, float val6)
            {
                var entry = new JObject
                {
                    ["kind"] = "rpc",
                    ["rpcName"] = rpcName,
                    ["playerName"] = playerName,
                    ["val1"] = val1, ["val2"] = val2, ["val3"] = val3,
                    ["val4"] = val4, ["val5"] = val5, ["val6"] = val6,
                    ["atUtc"] = DateTime.UtcNow.ToString("o"),
                };
                Push(entry);
            }
        }

        private class ConnListener : IConnectionHandler
        {
            public void playerConnected(string playerName) =>
                Push(new JObject { ["kind"] = "connected", ["playerName"] = playerName, ["atUtc"] = DateTime.UtcNow.ToString("o") });

            public void playerDisconnected(string playerName) =>
                Push(new JObject { ["kind"] = "disconnected", ["playerName"] = playerName, ["atUtc"] = DateTime.UtcNow.ToString("o") });
        }

        private static void Push(JObject entry)
        {
            lock (RingLock)
            {
                Ring.AddLast(entry);
                while (Ring.Count > RingCap) Ring.RemoveFirst();
            }
        }

        private static IVNyanNetInterface N => VNyanInterface.VNyanInterface.VNyanNet;

        public static void Register()
        {
            N?.registerRPCListener(new RpcListener());
            N?.registerConnectionListener(new ConnListener());

            RpcRegistry.Register("net.players", _ => new JArray(N.getPlayers() ?? new List<string>()));

            RpcRegistry.Register("net.getSlot", p => N.getPlayerSlot(p.RequireString("playerName")));

            RpcRegistry.Register("net.setSlot", p =>
            {
                var name = p.RequireString("playerName");
                var slot = p.GetInt("slot");
                N.setPlayerSlot(name, slot);
                return new JObject { ["playerName"] = name, ["slot"] = slot };
            });

            RpcRegistry.Register("net.slotPosition.get", p =>
            {
                var v = N.getPlayerSlotPosition(p.GetInt("slot"));
                return new JObject { ["x"] = v.X, ["y"] = v.Y, ["z"] = v.Z };
            });

            RpcRegistry.Register("net.slotPosition.set", p =>
            {
                var slot = p.GetInt("slot");
                N.setPlayerSlotPosition(slot, new VNyanVector3 { X = p.GetFloat("x"), Y = p.GetFloat("y"), Z = p.GetFloat("z") });
                return new JObject { ["slot"] = slot };
            });

            RpcRegistry.Register("net.slotRotation.get", p =>
            {
                var v = N.getPlayerSlotRotation(p.GetInt("slot"));
                return new JObject { ["x"] = v.X, ["y"] = v.Y, ["z"] = v.Z, ["w"] = v.W };
            });

            RpcRegistry.Register("net.slotRotation.set", p =>
            {
                var slot = p.GetInt("slot");
                N.setPlayerSlotRotation(slot, new VNyanQuaternion { X = p.GetFloat("x"), Y = p.GetFloat("y"), Z = p.GetFloat("z"), W = p.GetFloat("w", 1f) });
                return new JObject { ["slot"] = slot };
            });

            RpcRegistry.Register("net.slotScale.get", p =>
            {
                var v = N.getPlayerSlotScale(p.GetInt("slot"));
                return new JObject { ["x"] = v.X, ["y"] = v.Y, ["z"] = v.Z };
            });

            RpcRegistry.Register("net.slotScale.set", p =>
            {
                var slot = p.GetInt("slot");
                N.setPlayerSlotScale(slot, new VNyanVector3 { X = p.GetFloat("x", 1f), Y = p.GetFloat("y", 1f), Z = p.GetFloat("z", 1f) });
                return new JObject { ["slot"] = slot };
            });

            RpcRegistry.Register("net.sendRPC", p =>
            {
                var name = p.RequireString("name");
                N.sendRPC(name,
                    p.GetString("val1", ""), p.GetString("val2", ""), p.GetString("val3", ""),
                    p.GetFloat("val4"), p.GetFloat("val5"), p.GetFloat("val6"),
                    p.GetBool("bounce", false));
                return new JObject { ["name"] = name };
            });

            RpcRegistry.Register("net.recent", p =>
            {
                var limit = p.GetInt("limit", 50);
                lock (RingLock) { return new JArray(Ring.Reverse().Take(limit)); }
            });
        }
    }
}
