#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import * as core from "./tools/core.js";
import * as parameters from "./tools/parameters.js";
import * as triggers from "./tools/triggers.js";
import * as avatar from "./tools/avatar.js";
import * as pendulum from "./tools/pendulum.js";
import * as props from "./tools/props.js";
import * as colliders from "./tools/colliders.js";
import * as spout from "./tools/spout.js";
import * as stretchbones from "./tools/stretchbones.js";
import * as net from "./tools/net.js";
import * as ui from "./tools/ui.js";
import * as nativeTools from "./tools/nativeTools.js";
import * as settings from "./tools/settings.js";
import * as expression from "./tools/expression.js";
import * as gesture from "./tools/gesture.js";
import * as graph from "./tools/graph.js";
import * as bridgeGraph from "./tools/bridgeGraph.js";
import * as guide from "./tools/guide.js";
import { GUIDE_TOPICS, TOPIC_SUMMARIES, getGuideTopic } from "./docs.js";

const server = new McpServer({ name: "vnyan-mcp", version: "0.1.0" });

for (const mod of [
  core, parameters, triggers, avatar, pendulum, props, colliders, spout, stretchbones,
  net, ui, nativeTools, settings, expression, gesture, graph, bridgeGraph, guide,
]) {
  mod.register(server);
}

for (const topic of GUIDE_TOPICS) {
  const uri = `vnyan://guide/${topic}`;
  server.registerResource(
    `guide-${topic}`,
    uri,
    { title: `VNyan guide: ${topic}`, description: TOPIC_SUMMARIES[topic], mimeType: "text/markdown" },
    async () => ({
      contents: [{ uri, mimeType: "text/markdown", text: await getGuideTopic(topic) }],
    })
  );
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
server.registerResource(
  "node-schema",
  "vnyan://schema/nodes",
  { title: "VNyan node type schema (304 types)", description: "Full socket layout for every known node type - the same data vnyan_node_schema serves.", mimeType: "application/json" },
  async () => ({
    contents: [{
      uri: "vnyan://schema/nodes",
      mimeType: "application/json",
      text: await fs.readFile(path.join(__dirname, "graph", "schema.json"), "utf-8"),
    }],
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
