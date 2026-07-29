using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace VNyanMcp
{
    /// <summary>
    /// Minimal single-endpoint HTTP/1.1 server over a raw TcpListener rather
    /// than System.Net.HttpListener - HttpListener isn't part of the
    /// netstandard2.0 reference set this plugin targets (matching VNyan's
    /// own ExamplePlugin), so a small hand-rolled parser avoids a framework
    /// compatibility gamble for what is just one JSON-in/JSON-out route.
    /// Loopback-only; never binds 0.0.0.0.
    /// </summary>
    public static class HttpBridge
    {
        private static TcpListener _listener;
        private static volatile bool _running;
        private static int _port;

        public static string StatusLine() => _running ? $"listening on 127.0.0.1:{_port}" : "not running";

        public static void Start(Dispatcher dispatcher, int preferredPort = 8071)
        {
            _port = LoadSavedPort() ?? preferredPort;
            try
            {
                _listener = new TcpListener(IPAddress.Loopback, _port);
                _listener.Start();
                _running = true;
                SavePort(_port);
                Debug.Log("[VNyanMcp] HTTP bridge listening on http://127.0.0.1:" + _port + "/");
            }
            catch (Exception e)
            {
                Debug.LogError("[VNyanMcp] failed to bind HTTP bridge on port " + _port + ": " + e.Message);
                return;
            }

            var acceptThread = new Thread(() => AcceptLoop(dispatcher)) { IsBackground = true, Name = "VNyanMcp-Accept" };
            acceptThread.Start();
        }

        private static int? LoadSavedPort()
        {
            var settings = VNyanInterface.VNyanInterface.VNyanSettings?.loadSettings("VNyanMcp.cfg");
            if (settings != null && settings.TryGetValue("Port", out var s) && int.TryParse(s, out var port))
                return port;
            return null;
        }

        private static void SavePort(int port)
        {
            VNyanInterface.VNyanInterface.VNyanSettings?.saveSettings("VNyanMcp.cfg",
                new Dictionary<string, string> { ["Port"] = port.ToString(CultureInfo.InvariantCulture) });
        }

        private static void AcceptLoop(Dispatcher dispatcher)
        {
            while (_running)
            {
                TcpClient client;
                try { client = _listener.AcceptTcpClient(); }
                catch { break; }
                ThreadPool.QueueUserWorkItem(_ => HandleClient(client, dispatcher));
            }
        }

        private static void HandleClient(TcpClient client, Dispatcher dispatcher)
        {
            try
            {
                using (client)
                using (var stream = client.GetStream())
                {
                    client.ReceiveTimeout = 10000;
                    client.SendTimeout = 10000;

                    if (!ReadRequest(stream, out var method, out _, out byte[] body))
                        return;

                    JObject responseObj;
                    if (method == "POST")
                    {
                        responseObj = HandlePost(body, dispatcher);
                    }
                    else if (method == "GET")
                    {
                        responseObj = new JObject
                        {
                            ["ok"] = true,
                            ["result"] = new JObject { ["service"] = "VNyanMcp", ["methods"] = RpcRegistry.Methods.Count }
                        };
                    }
                    else
                    {
                        WriteResponse(stream, 405, new JObject { ["ok"] = false, ["error"] = "method not allowed" });
                        return;
                    }
                    WriteResponse(stream, 200, responseObj);
                }
            }
            catch (Exception e)
            {
                Debug.LogWarning("[VNyanMcp] request handling error: " + e.Message);
            }
        }

        private static JObject HandlePost(byte[] body, Dispatcher dispatcher)
        {
            try
            {
                var text = Encoding.UTF8.GetString(body ?? Array.Empty<byte>());
                var req = string.IsNullOrWhiteSpace(text) ? new JObject() : JObject.Parse(text);
                var methodName = req.Value<string>("method");
                if (string.IsNullOrEmpty(methodName))
                    return new JObject { ["ok"] = false, ["error"] = "missing 'method'" };

                if (!RpcRegistry.Methods.TryGetValue(methodName, out var fn))
                    return new JObject { ["ok"] = false, ["error"] = "unknown method: " + methodName };

                var parameters = req["params"] as JObject ?? new JObject();

                object result = dispatcher.RunOnMainThread(() => fn(parameters));
                JToken resultToken = result == null ? JValue.CreateNull()
                    : result as JToken ?? JToken.FromObject(result);
                return new JObject { ["ok"] = true, ["result"] = resultToken };
            }
            catch (Exception e)
            {
                return new JObject { ["ok"] = false, ["error"] = e.Message };
            }
        }

        private static bool ReadRequest(NetworkStream stream, out string method, out string path, out byte[] body)
        {
            method = null; path = null; body = null;
            var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

            var raw = new List<byte>(4096);
            var buf = new byte[4096];
            int headerEnd = -1;
            // Rescans from the start on every read; header blocks are tiny
            // (a handful of lines) so the O(n^2) worst case never matters here.
            while (headerEnd < 0)
            {
                int n = stream.Read(buf, 0, buf.Length);
                if (n <= 0) return false;
                for (int i = 0; i < n; i++) raw.Add(buf[i]);
                headerEnd = FindHeaderEnd(raw);
                if (raw.Count > 1024 * 1024) throw new IOException("request headers too large");
            }

            var headerBytes = raw.GetRange(0, headerEnd).ToArray();
            var headerText = Encoding.ASCII.GetString(headerBytes);
            var lines = headerText.Split(new[] { "\r\n" }, StringSplitOptions.None);
            if (lines.Length == 0) return false;

            var requestLineParts = lines[0].Split(' ');
            if (requestLineParts.Length < 2) return false;
            method = requestLineParts[0].ToUpperInvariant();
            path = requestLineParts[1];

            for (int i = 1; i < lines.Length; i++)
            {
                var line = lines[i];
                if (string.IsNullOrEmpty(line)) continue;
                var idx = line.IndexOf(':');
                if (idx <= 0) continue;
                headers[line.Substring(0, idx).Trim()] = line.Substring(idx + 1).Trim();
            }

            int contentLength = 0;
            if (headers.TryGetValue("Content-Length", out var clStr)) int.TryParse(clStr, out contentLength);

            var bodyStart = headerEnd + 4; // skip \r\n\r\n
            var already = raw.Count - bodyStart;
            var bodyList = new List<byte>(contentLength);
            if (already > 0) bodyList.AddRange(raw.GetRange(bodyStart, already));

            while (bodyList.Count < contentLength)
            {
                int toRead = Math.Min(buf.Length, contentLength - bodyList.Count);
                int n = stream.Read(buf, 0, toRead);
                if (n <= 0) break;
                for (int i = 0; i < n; i++) bodyList.Add(buf[i]);
            }
            body = bodyList.ToArray();
            return true;
        }

        private static int FindHeaderEnd(List<byte> raw)
        {
            for (int i = 0; i + 3 < raw.Count; i++)
            {
                if (raw[i] == 13 && raw[i + 1] == 10 && raw[i + 2] == 13 && raw[i + 3] == 10)
                    return i;
            }
            return -1;
        }

        private static void WriteResponse(NetworkStream stream, int statusCode, JObject bodyObj)
        {
            var bodyText = bodyObj.ToString(Formatting.None);
            var bodyBytes = Encoding.UTF8.GetBytes(bodyText);
            var statusText = statusCode == 200 ? "OK" : statusCode == 405 ? "Method Not Allowed" : "Error";
            var header = $"HTTP/1.1 {statusCode} {statusText}\r\n" +
                         "Content-Type: application/json; charset=utf-8\r\n" +
                         $"Content-Length: {bodyBytes.Length}\r\n" +
                         "Connection: close\r\n\r\n";
            var headerBytes = Encoding.ASCII.GetBytes(header);
            stream.Write(headerBytes, 0, headerBytes.Length);
            stream.Write(bodyBytes, 0, bodyBytes.Length);
            stream.Flush();
        }
    }
}
