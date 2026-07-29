import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { rpc } from "../bridge.js";
import { jsonResult, safeHandler } from "../toolHelpers.js";

export function register(server: McpServer) {
  server.registerTool(
    "vnyan_vnyannet",
    {
      title: "VNyanNet (multiplayer)",
      description:
        "Read connected players and their slot transform, send an RPC to the lobby, and read recently " +
        "observed RPCs/connection events. Source: plugin (live, read+write). Returns empty results, not " +
        "an error, when VNyanNet isn't configured (VNyanNetServerUrl unset).",
      inputSchema: {
        action: z.enum([
          "players", "getSlot", "setSlot",
          "slotPositionGet", "slotPositionSet",
          "slotRotationGet", "slotRotationSet",
          "slotScaleGet", "slotScaleSet",
          "sendRPC", "recent",
        ]).describe("Which VNyanNet operation to perform"),
        playerName: z.string().optional().describe("VNyanNet player name, for getSlot/setSlot"),
        slot: z.number().optional().describe("VNyanNet player slot index - required for every slotXxxGet/Set action"),
        x: z.number().optional().describe("Position/rotation/scale X component, for the slotXxxSet actions"),
        y: z.number().optional().describe("Position/rotation/scale Y component, for the slotXxxSet actions"),
        z: z.number().optional().describe("Position/rotation/scale Z component, for the slotXxxSet actions"),
        w: z.number().optional().describe("Rotation quaternion W component - only used by slotRotationSet, default 1 (identity)"),
        name: z.string().optional().describe("RPC name, for sendRPC"),
        val1: z.string().optional().describe("sendRPC string param 1"),
        val2: z.string().optional().describe("sendRPC string param 2"),
        val3: z.string().optional().describe("sendRPC string param 3"),
        val4: z.number().optional().describe("sendRPC float param 1"),
        val5: z.number().optional().describe("sendRPC float param 2"),
        val6: z.number().optional().describe("sendRPC float param 3"),
        bounce: z.boolean().optional().describe("sendRPC: echo the RPC back to the sender too. Default false"),
        limit: z.number().optional().describe("Max entries for 'recent' (default 50)"),
      },
    },
    safeHandler(async (a) => {
      switch (a.action) {
        case "players": return jsonResult(await rpc("net.players"));
        case "getSlot":
          if (!a.playerName) throw new Error("'playerName' is required");
          return jsonResult(await rpc("net.getSlot", { playerName: a.playerName }));
        case "setSlot":
          if (!a.playerName || a.slot === undefined) throw new Error("'playerName' and 'slot' are required");
          return jsonResult(await rpc("net.setSlot", { playerName: a.playerName, slot: a.slot }));
        case "slotPositionGet":
          if (a.slot === undefined) throw new Error("'slot' is required");
          return jsonResult(await rpc("net.slotPosition.get", { slot: a.slot }));
        case "slotPositionSet":
          if (a.slot === undefined) throw new Error("'slot' is required");
          return jsonResult(await rpc("net.slotPosition.set", a));
        case "slotRotationGet":
          if (a.slot === undefined) throw new Error("'slot' is required");
          return jsonResult(await rpc("net.slotRotation.get", { slot: a.slot }));
        case "slotRotationSet":
          if (a.slot === undefined) throw new Error("'slot' is required");
          return jsonResult(await rpc("net.slotRotation.set", a));
        case "slotScaleGet":
          if (a.slot === undefined) throw new Error("'slot' is required");
          return jsonResult(await rpc("net.slotScale.get", { slot: a.slot }));
        case "slotScaleSet":
          if (a.slot === undefined) throw new Error("'slot' is required");
          return jsonResult(await rpc("net.slotScale.set", a));
        case "sendRPC":
          if (!a.name) throw new Error("'name' is required");
          return jsonResult(await rpc("net.sendRPC", a));
        case "recent":
          return jsonResult(await rpc("net.recent", { limit: a.limit ?? 50 }));
      }
    })
  );
}
