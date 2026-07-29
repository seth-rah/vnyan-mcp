/**
 * Client for the VNyanMcp plugin's HTTP RPC bridge (loopback-only,
 * default http://127.0.0.1:8071/rpc). This is the only path that can read
 * live VNyan state - the native REST/WS/OSC ports (native.ts) are
 * fire-and-forget with no readback.
 */

const BRIDGE_URL = process.env.VNYAN_MCP_BRIDGE_URL ?? "http://127.0.0.1:8071/rpc";

export class BridgeUnavailableError extends Error {
  constructor(cause?: unknown) {
    super(
      "VNyan MCP bridge plugin not responding — is VNyan running with the VNyanMcp plugin installed in Items\\Assemblies?"
    );
    this.name = "BridgeUnavailableError";
    if (cause) this.cause = cause;
  }
}

interface RpcEnvelope<T> {
  ok: boolean;
  result?: T;
  error?: string;
}

export async function rpc<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BRIDGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, params }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    throw new BridgeUnavailableError(err);
  }

  let json: RpcEnvelope<T>;
  try {
    json = (await res.json()) as RpcEnvelope<T>;
  } catch (err) {
    throw new Error(`VNyan bridge returned a non-JSON response for '${method}' (HTTP ${res.status})`);
  }

  if (!json.ok) {
    throw new Error(`VNyan bridge error (${method}): ${json.error ?? "unknown error"}`);
  }
  return json.result as T;
}
