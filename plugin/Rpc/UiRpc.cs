using System.Linq;
using Newtonsoft.Json.Linq;
using VNyanInterface;

namespace VNyanMcp.Rpc
{
    public static class UiRpc
    {
        private static IUIInterface Ui => VNyanInterface.VNyanInterface.VNyanUI;

        public static void Register()
        {
            RpcRegistry.Register("ui.theme", _ =>
            {
                var result = new JObject();
                foreach (ThemeComponent c in System.Enum.GetValues(typeof(ThemeComponent)))
                    result[c.ToString()] = Ui.getCurrentThemeColor(c);
                return result;
            });

            // File dialogs run on the caller's main-thread dispatch and block
            // the HTTP request until the user closes the dialog - callers
            // should apply a generous timeout.
            RpcRegistry.Register("ui.openLoadFileDialog", p =>
            {
                var header = p.GetString("header", "Select file");
                var extensions = (p["extensions"] as JArray)?.Select(t => t.Value<string>()).ToArray() ?? new[] { "*" };
                return Ui.openLoadFileDialog(header, extensions);
            });

            RpcRegistry.Register("ui.openSaveFileDialog", p =>
            {
                var header = p.GetString("header", "Save file");
                var extensions = (p["extensions"] as JArray)?.Select(t => t.Value<string>()).ToArray() ?? new[] { "*" };
                return Ui.openSaveFileDialog(header, extensions);
            });
        }
    }
}
