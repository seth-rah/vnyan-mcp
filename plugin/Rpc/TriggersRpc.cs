using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using VNyanInterface;

namespace VNyanMcp.Rpc
{
    public static class TriggersRpc
    {
        private const int RingCap = 500;
        private static readonly object RingLock = new object();
        private static readonly LinkedList<JObject> Ring = new LinkedList<JObject>();

        private class Listener : ITriggerHandler
        {
            public void triggerCalled(string triggerName, int value1, int value2, int value3, string text1, string text2, string text3)
            {
                var entry = new JObject
                {
                    ["triggerName"] = triggerName,
                    ["value1"] = value1,
                    ["value2"] = value2,
                    ["value3"] = value3,
                    ["text1"] = text1,
                    ["text2"] = text2,
                    ["text3"] = text3,
                    ["atUtc"] = DateTime.UtcNow.ToString("o"),
                };
                lock (RingLock)
                {
                    Ring.AddLast(entry);
                    while (Ring.Count > RingCap) Ring.RemoveFirst();
                }
            }
        }

        private static ITriggerInterface T => VNyanInterface.VNyanInterface.VNyanTrigger;

        public static void Register()
        {
            T?.registerTriggerListener(new Listener());

            RpcRegistry.Register("trigger.call", p =>
            {
                var name = p.RequireString("name");
                T.callTrigger(name,
                    p.GetInt("value1"), p.GetInt("value2"), p.GetInt("value3"),
                    p.GetString("text1", ""), p.GetString("text2", ""), p.GetString("text3", ""));
                return new JObject { ["name"] = name };
            });

            RpcRegistry.Register("trigger.enqueue", p =>
            {
                var queue = p.RequireString("queue");
                var name = p.RequireString("name");
                T.enqueueTrigger(queue, p.GetInt("waitTimeAfterMs", 0), name,
                    p.GetInt("value1"), p.GetInt("value2"), p.GetInt("value3"),
                    p.GetString("text1", ""), p.GetString("text2", ""), p.GetString("text3", ""));
                return new JObject { ["queue"] = queue, ["name"] = name };
            });

            RpcRegistry.Register("trigger.resetQueue", p =>
            {
                var queue = p.RequireString("queue");
                T.resetQueue(queue);
                return new JObject { ["queue"] = queue };
            });

            RpcRegistry.Register("trigger.recent", p =>
            {
                var limit = p.GetInt("limit", 50);
                lock (RingLock)
                {
                    return new JArray(Ring.Reverse().Take(limit));
                }
            });
        }
    }
}
