import fs from "node:fs/promises";
import path from "node:path";
import { getSettingsMain, getCollidersDir } from "./paths.js";
import { areaOf, isSecret, isDedicated, type SettingsArea } from "./schema.js";

export type SettingsBlob = Record<string, unknown>;

export async function readSettings(): Promise<SettingsBlob> {
  const text = await fs.readFile(await getSettingsMain(), "utf-8");
  return JSON.parse(text);
}

export function redact(blob: SettingsBlob): SettingsBlob {
  const out: SettingsBlob = {};
  for (const [k, v] of Object.entries(blob)) {
    out[k] = isSecret(k) ? "<redacted>" : v;
  }
  return out;
}

export function projectArea(blob: SettingsBlob, area: SettingsArea): SettingsBlob {
  const out: SettingsBlob = {};
  for (const [k, v] of Object.entries(blob)) {
    if (isDedicated(k)) continue;
    if (areaOf(k) !== area) continue;
    out[k] = isSecret(k) ? "<redacted>" : v;
  }
  return out;
}

export function pickKeys(blob: SettingsBlob, keys: string[]): SettingsBlob {
  const out: SettingsBlob = {};
  for (const k of keys) {
    if (k in blob) out[k] = isSecret(k) ? "<redacted>" : blob[k];
  }
  return out;
}

/** Convenience for the dedicated-list keys (Props, Chains, StretchBones, Gestures, Expressions). */
export async function readDedicatedList(key: string): Promise<unknown[]> {
  const blob = await readSettings();
  const value = blob[key];
  return Array.isArray(value) ? value : [];
}

/** Per-avatar collider override, e.g. colliders\<AvatarName>.vsfavatar_cs.json. */
export async function readColliderOverride(avatarFileName: string): Promise<SettingsBlob | null> {
  const file = path.join(await getCollidersDir(), `${avatarFileName}_cs.json`);
  try {
    return JSON.parse(await fs.readFile(file, "utf-8"));
  } catch {
    return null;
  }
}

export async function listColliderOverrides(): Promise<{ avatarFileName: string; data: SettingsBlob }[]> {
  const collidersDir = await getCollidersDir();
  let entries: string[];
  try {
    entries = await fs.readdir(collidersDir);
  } catch {
    return [];
  }
  const results: { avatarFileName: string; data: SettingsBlob }[] = [];
  for (const entry of entries) {
    if (!entry.endsWith("_cs.json")) continue;
    const avatarFileName = entry.slice(0, -"_cs.json".length);
    try {
      const data = JSON.parse(await fs.readFile(path.join(collidersDir, entry), "utf-8"));
      results.push({ avatarFileName, data });
    } catch {
      // skip unreadable file
    }
  }
  return results;
}
