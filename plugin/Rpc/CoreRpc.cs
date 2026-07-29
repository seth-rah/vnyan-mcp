using System;
using Newtonsoft.Json.Linq;

namespace VNyanMcp.Rpc
{
    public static class CoreRpc
    {
        public static readonly DateTime StartedAt = DateTime.UtcNow;

        public static void Register()
        {
            RpcRegistry.Register("ping", _ => "pong");

            RpcRegistry.Register("rpc.methods", _ => new JArray(RpcRegistry.MethodNames));

            RpcRegistry.Register("app.profilePath", _ =>
                VNyanInterface.VNyanInterface.VNyanSettings?.getProfilePath());

            RpcRegistry.Register("app.uptime", _ =>
                (DateTime.UtcNow - StartedAt).TotalSeconds);
        }
    }
}
