/**
 * The three ports VNyan exposes without any plugin: REST (fire a node
 * graph's API Message node), WebSocket (fire a WebSocket Command node),
 * and OSC (set a param directly). All three are write-only / fire-and-forget
 * - kept here for parity with setups that don't have the bridge plugin
 * installed.
 */
import dgram from "node:dgram";

const REST_URL = process.env.VNYAN_REST_URL ?? "http://127.0.0.1:8069/";
const WS_URL = process.env.VNYAN_WS_URL ?? "ws://127.0.0.1:8000/vnyan";
const OSC_HOST = process.env.VNYAN_OSC_HOST ?? "127.0.0.1";
const OSC_PORT = Number(process.env.VNYAN_OSC_PORT ?? 28569);

export async function apiFire(action: string, payload: Record<string, string> = {}): Promise<void> {
  // VNyan's API Message node binds payload to Dictionary<string,string> -
  // non-string values are silently dropped, so callers must pre-stringify.
  let res: Response;
  try {
    res = await fetch(REST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, payload }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    throw new Error(`Could not reach VNyan's REST API at ${REST_URL} — is VNyan running?`);
  }
  if (!res.ok) throw new Error(`VNyan REST API returned HTTP ${res.status}`);
}

export async function wsSend(command: string, message = ""): Promise<void> {
  // Plain-text protocol: "<commandText> <rest>", not JSON. The path is
  // case-sensitive - "/vnyan" - confirmed against the live server; "/" 501s.
  const text = message ? `${command} ${message}` : command;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(WS_URL);
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      ws.close();
      reject(new Error(`Timed out connecting to VNyan's WebSocket at ${WS_URL}`));
    }, 5000);

    ws.addEventListener("open", () => {
      ws.send(text);
      settled = true;
      clearTimeout(timeout);
      resolve();
      setTimeout(() => ws.close(), 200);
    });
    ws.addEventListener("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`Could not reach VNyan's WebSocket at ${WS_URL} — is VNyan running?`));
    });
  });
}

function padTo4(buf: Buffer): Buffer {
  const pad = (4 - (buf.length % 4)) % 4;
  return pad === 0 ? buf : Buffer.concat([buf, Buffer.alloc(pad)]);
}

function oscString(s: string): Buffer {
  return padTo4(Buffer.concat([Buffer.from(s, "ascii"), Buffer.from([0])]));
}

function oscFloat(v: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeFloatBE(v, 0);
  return b;
}

export async function oscParam(name: string, value: number | string): Promise<void> {
  // Documented form: "/VNyan/Param/Float (name) (float value)" - name and
  // value both ride as OSC arguments, not as address-path segments.
  const isFloat = typeof value === "number";
  const address = isFloat ? "/VNyan/Param/Float" : "/VNyan/Param/String";
  const typeTag = isFloat ? ",sf" : ",ss";
  const valueBuf = isFloat ? oscFloat(value as number) : oscString(value as string);
  const packet = Buffer.concat([oscString(address), oscString(typeTag), oscString(name), valueBuf]);

  await new Promise<void>((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    socket.send(packet, OSC_PORT, OSC_HOST, (err) => {
      socket.close();
      if (err) reject(err);
      else resolve();
    });
  });
}
