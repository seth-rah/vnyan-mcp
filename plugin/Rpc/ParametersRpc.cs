using Newtonsoft.Json.Linq;
using VNyanInterface;

namespace VNyanMcp.Rpc
{
    public static class ParametersRpc
    {
        private static IParameterInterface P => VNyanInterface.VNyanInterface.VNyanParameter;

        public static void Register()
        {
            RpcRegistry.Register("param.getFloat", p => P.getVNyanParameterFloat(p.RequireString("name")));

            RpcRegistry.Register("param.setFloat", p =>
            {
                var name = p.RequireString("name");
                var value = p.GetFloat("value");
                P.setVNyanParameterFloat(name, value);
                return new JObject { ["name"] = name, ["value"] = value };
            });

            RpcRegistry.Register("param.getString", p => P.getVNyanParameterString(p.RequireString("name")));

            RpcRegistry.Register("param.setString", p =>
            {
                var name = p.RequireString("name");
                var value = p.GetString("value", "");
                P.setVNyanParameterString(name, value);
                return new JObject { ["name"] = name, ["value"] = value };
            });

            RpcRegistry.Register("param.fillString", p => P.fillStringWithParameters(p.RequireString("text")));

            RpcRegistry.Register("param.internal", p =>
            {
                var which = p.GetString("which", "heartbeat");
                var type = which.Equals("heartpercent", System.StringComparison.OrdinalIgnoreCase)
                    ? InternalParameterType.Hearpercent
                    : InternalParameterType.Heartbeat;
                return P.getInternalParameter(type);
            });

            RpcRegistry.Register("dict.get", p => P.getVNyanDictionaryValue(p.RequireString("dict"), p.RequireString("key")));

            RpcRegistry.Register("dict.set", p =>
            {
                var dict = p.RequireString("dict");
                var key = p.RequireString("key");
                var value = p.GetString("value", "");
                P.setVNyanDictionaryValue(dict, key, value);
                return new JObject { ["dict"] = dict, ["key"] = key, ["value"] = value };
            });

            RpcRegistry.Register("dict.clear", p =>
            {
                var dict = p.RequireString("dict");
                P.clearVNyanDictionary(dict);
                return new JObject { ["dict"] = dict };
            });
        }
    }
}
