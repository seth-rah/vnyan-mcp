using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;

namespace VNyanMcp
{
    /// <summary>
    /// Flat method-name -> handler registry for the /rpc endpoint.
    /// Every RPC area (Parameters, Triggers, Avatar, ...) registers its
    /// methods here instead of getting its own HTTP route.
    /// </summary>
    public static class RpcRegistry
    {
        public static readonly Dictionary<string, Func<JObject, object>> Methods =
            new Dictionary<string, Func<JObject, object>>(StringComparer.OrdinalIgnoreCase);

        public static void Register(string name, Func<JObject, object> handler)
        {
            Methods[name] = handler;
        }

        public static void RegisterAll()
        {
            Rpc.CoreRpc.Register();
            Rpc.ParametersRpc.Register();
            Rpc.TriggersRpc.Register();
            Rpc.AvatarRpc.Register();
            Rpc.PendulumRpc.Register();
            Rpc.NetRpc.Register();
            Rpc.UiRpc.Register();
            Reflect.RegisterAll();
        }

        public static IEnumerable<string> MethodNames => Methods.Keys.OrderBy(k => k, StringComparer.OrdinalIgnoreCase);
    }

    public static class JObjectExtensions
    {
        public static string GetString(this JObject p, string key, string def = null)
        {
            if (p == null) return def;
            var t = p[key];
            return t == null || t.Type == JTokenType.Null ? def : t.Value<string>();
        }

        public static float GetFloat(this JObject p, string key, float def = 0f)
        {
            if (p == null) return def;
            var t = p[key];
            return t == null || t.Type == JTokenType.Null ? def : t.Value<float>();
        }

        public static int GetInt(this JObject p, string key, int def = 0)
        {
            if (p == null) return def;
            var t = p[key];
            return t == null || t.Type == JTokenType.Null ? def : t.Value<int>();
        }

        public static bool GetBool(this JObject p, string key, bool def = false)
        {
            if (p == null) return def;
            var t = p[key];
            return t == null || t.Type == JTokenType.Null ? def : t.Value<bool>();
        }

        public static string RequireString(this JObject p, string key)
        {
            var v = p.GetString(key, null);
            if (string.IsNullOrEmpty(v)) throw new ArgumentException("missing required string param: " + key);
            return v;
        }
    }
}
