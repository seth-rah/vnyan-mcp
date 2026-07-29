using System;
using UnityEngine;
using VNyanInterface;

namespace VNyanMcp
{
    public class McpManifest : IVNyanPluginManifest, IButtonClickedHandler
    {
        public string PluginName => "VNyanMcp";
        public string Version => "0.1.0";
        public string Title => "VNyan MCP Bridge";
        public string Author => "seth-rah";
        public string Website => "https://github.com/seth-rah/vnyan-mcp";

        public void InitializePlugin()
        {
            try
            {
                Debug.Log("[VNyanMcp] initializing...");
                var dispatcher = Dispatcher.EnsureCreated();
                RpcRegistry.RegisterAll();
                HttpBridge.Start(dispatcher);
                VNyanInterface.VNyanInterface.VNyanUI?.registerPluginButton("MCP Bridge", this);
                Debug.Log("[VNyanMcp] initialized");
            }
            catch (Exception e)
            {
                Debug.LogError("[VNyanMcp] init failed: " + e);
            }
        }

        public void pluginButtonClicked()
        {
            Debug.Log("[VNyanMcp] " + HttpBridge.StatusLine() + ", " + RpcRegistry.Methods.Count + " methods registered");
        }
    }
}
