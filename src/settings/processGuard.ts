import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class VNyanRunningError extends Error {
  constructor(pid: string, file: string) {
    super(
      `Refusing to write ${file} - VNyan is currently running (PID ${pid}). Close VNyan first: ` +
        "it can rewrite this file on its own and would silently overwrite this change."
    );
    this.name = "VNyanRunningError";
  }
}

export async function findVNyanPid(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("tasklist", ["/FI", "IMAGENAME eq VNyan.exe", "/FO", "CSV", "/NH"]);
    const line = stdout.trim();
    if (!line || !line.toLowerCase().includes("vnyan.exe")) return null;
    const firstField = line.split(",")[1]?.replace(/"/g, "");
    return firstField ?? "unknown";
  } catch {
    return null;
  }
}

export async function requireVNyanClosed(fileLabel: string): Promise<void> {
  const pid = await findVNyanPid();
  if (pid) throw new VNyanRunningError(pid, fileLabel);
}
