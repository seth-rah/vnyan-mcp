import fs from "node:fs/promises";
import path from "node:path";
import { getSettingsMain, getSettingsVariants, getBackupDir } from "./paths.js";
import { readSettings } from "./read.js";
import { isDedicated } from "./schema.js";
import { requireVNyanClosed } from "./processGuard.js";

export { VNyanRunningError } from "./processGuard.js";

async function backupSettings(): Promise<string> {
  const dir = path.join(await getBackupDir(), `mcp-${Date.now()}`);
  await fs.mkdir(dir, { recursive: true });
  const dest = path.join(dir, "settings.json");
  await fs.copyFile(await getSettingsMain(), dest);
  return dest;
}

export async function patchSettings(
  patch: Record<string, unknown>
): Promise<{ backupPath: string; changedKeys: string[] }> {
  await requireVNyanClosed("settings.json (+ .dat/_as.json mirrors)");

  for (const key of Object.keys(patch)) {
    if (isDedicated(key)) {
      throw new Error(
        `'${key}' has a dedicated tool (vnyan_prop / vnyan_collider / vnyan_pendulum / ` +
          "vnyan_stretchbone / vnyan_gesture / vnyan_expression) - use that instead of vnyan_settings_set."
      );
    }
  }

  const blob = await readSettings();
  const backupPath = await backupSettings();

  const changedKeys: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in blob)) throw new Error(`unknown settings.json key: '${k}'`);
    blob[k] = v;
    changedKeys.push(k);
  }

  const text = JSON.stringify(blob, null, 4);
  for (const file of await getSettingsVariants()) {
    await fs.writeFile(file, text, "utf-8");
  }
  return { backupPath, changedKeys };
}

/**
 * Replaces one of the dedicated list keys (Props, Chains, StretchBones,
 * Gestures, Expressions) wholesale - used by each key's own dedicated tool
 * (vnyan_expression import, etc), not by vnyan_settings_set.
 */
export async function writeDedicatedList(key: string, list: unknown[]): Promise<{ backupPath: string }> {
  await requireVNyanClosed("settings.json (+ .dat/_as.json mirrors)");

  const blob = await readSettings();
  if (!(key in blob)) throw new Error(`unknown settings.json key: '${key}'`);
  const backupPath = await backupSettings();

  blob[key] = list;
  const text = JSON.stringify(blob, null, 4);
  for (const file of await getSettingsVariants()) {
    await fs.writeFile(file, text, "utf-8");
  }
  return { backupPath };
}
