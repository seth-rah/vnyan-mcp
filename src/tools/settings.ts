import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readSettings, projectArea } from "../settings/read.js";
import { patchSettings } from "../settings/write.js";
import { SETTINGS_AREAS } from "../settings/schema.js";
import { jsonResult, safeHandler } from "../toolHelpers.js";

export function register(server: McpServer) {
  server.registerTool(
    "vnyan_settings_get",
    {
      title: "Read VNyan settings.json",
      description:
        "Reads settings.json (tracking/output/graphics/audio/connections/misc). Source: disk, always " +
        "readable regardless of whether VNyan is running. Secrets (OBS/Chaturbate/VNyanNet passwords) are " +
        "redacted. Props/colliders/pendulums/stretch bones/gestures/expressions have their own dedicated " +
        "tools and are not included here.",
      inputSchema: {
        area: z.enum(SETTINGS_AREAS).describe("Which settings area to read"),
      },
    },
    safeHandler(async ({ area }) => {
      const blob = await readSettings();
      return jsonResult(projectArea(blob, area));
    })
  );

  server.registerTool(
    "vnyan_settings_set",
    {
      title: "Write VNyan settings.json",
      description:
        "Patches specific keys in settings.json. Source: disk. REQUIRES VNyan to be closed - it triple-" +
        "writes settings.json/.dat/_as.json on every save and would silently overwrite a live edit. " +
        "Backs up settings.json to the backup\\ folder before writing. Refuses unknown keys and keys " +
        "that have a dedicated tool (props/colliders/pendulum/stretchbone/gesture/expression). " +
        "settings.json is a single FLAT namespace of ~279 keys (no nesting) - call vnyan_settings_get " +
        "first to see current values and exact key names for an area, or vnyan_guide " +
        "topic:'settings-keys' for the full key-prefix index.",
      inputSchema: {
        patch: z.record(z.string(), z.unknown()).describe(
          "Map of EXISTING settings.json key -> new value. Keys must already exist in settings.json " +
          "(unknown keys are rejected) and must not be one of the dedicated-tool keys (Props, Chains, " +
          "StretchBones, Gestures, Expressions, or the collider size/offset keys)."
        ),
      },
    },
    safeHandler(async ({ patch }) => {
      const result = await patchSettings(patch as Record<string, unknown>);
      return jsonResult(result);
    })
  );
}
