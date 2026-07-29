import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { rpc } from "../bridge.js";

export class ProfileDirNotFoundError extends Error {
  constructor() {
    super(
      "Could not determine VNyan's profile directory. Set the VNYAN_PROFILE_DIR environment " +
        "variable to it, or start VNyan once with the VNyanMcp plugin installed so this server " +
        "can ask it directly - vnyan_status reports the resolved path and how it was found."
    );
    this.name = "ProfileDirNotFoundError";
  }
}

export type ProfileDirSource = "env" | "plugin" | "conventional";

let cached: { dir: string; source: ProfileDirSource } | null = null;

/**
 * Resolves VNyan's profile directory with no hardcoded machine path:
 * 1. VNYAN_PROFILE_DIR env var, if set - an explicit user override.
 * 2. Ask the running plugin (ISettingsInterface.getProfilePath() via the
 *    bridge) - authoritative on any machine, including portable installs
 *    and the `-profile` launch arg.
 * 3. The conventional os.homedir()-derived LocalLow path, only if it
 *    actually exists - needed because disk-backed tools must keep working
 *    with VNyan closed, when the bridge can't be reached.
 * Memoized per process; VNyan's profile location doesn't change mid-session.
 */
export async function getProfileDirInfo(): Promise<{ dir: string; source: ProfileDirSource }> {
  if (cached) return cached;

  const envDir = process.env.VNYAN_PROFILE_DIR;
  if (envDir) {
    cached = { dir: envDir, source: "env" };
    return cached;
  }

  try {
    const dir = await rpc<string>("app.profilePath");
    if (dir) {
      cached = { dir, source: "plugin" };
      return cached;
    }
  } catch {
    // Bridge unreachable (VNyan closed or plugin not installed) - fall through.
  }

  const conventional = path.join(os.homedir(), "AppData", "LocalLow", "Suvidriel", "VNyan");
  try {
    await fs.access(conventional);
    cached = { dir: conventional, source: "conventional" };
    return cached;
  } catch {
    throw new ProfileDirNotFoundError();
  }
}

export async function getProfileDir(): Promise<string> {
  return (await getProfileDirInfo()).dir;
}

export async function getSettingsMain(): Promise<string> {
  return path.join(await getProfileDir(), "settings.json");
}

// VNyan writes all three of these on every save - they are byte-identical
// mirrors, not independent files. A patch that only touches settings.json
// gets silently clobbered the next time VNyan saves.
export async function getSettingsVariants(): Promise<string[]> {
  const dir = await getProfileDir();
  return [
    path.join(dir, "settings.json"),
    path.join(dir, "settings.json.dat"),
    path.join(dir, "settings.json_as.json"),
  ];
}

export async function getCollidersDir(): Promise<string> {
  return path.join(await getProfileDir(), "colliders");
}

export async function getBackupDir(): Promise<string> {
  return path.join(await getProfileDir(), "backup");
}

export async function redeemsPaths(count: number): Promise<{ main: string; mirror: string }[]> {
  const dir = await getProfileDir();
  const files: { main: string; mirror: string }[] = [];
  for (let i = 0; i < count; i++) {
    const suffix = i === 0 ? "" : String(i);
    files.push({
      main: path.join(dir, `redeems${suffix}.json`),
      mirror: path.join(dir, `asredeems${suffix}.json`),
    });
  }
  return files;
}
