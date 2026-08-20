import { lookupNodeType } from "./schema.js";

/**
 * Static checks for an authored graph spec.
 *
 * Every check here corresponds to a mistake that VNyan does NOT report: the
 * graph loads, nothing errors, and the symptom is a shape that never moves or
 * a value that is silently one tick stale. They were all found the hard way and
 * previously only caught by hand-written throwaway scripts.
 *
 * These are warnings, not errors. A generated graph can legitimately look odd,
 * and refusing to write would be worse than saying so.
 */

export interface LintNode {
  id: string;
  type: string;
  values?: Record<string, string>;
}
export interface LintConnection {
  from: string;
  fromIndex?: number;
  to: string;
  toIndex?: number;
}
export interface LintValueConnection {
  from: string;
  fromIndex?: number;
  to: string;
  toIndex: number;
}

/** Nodes whose `paramName` value names a parameter the node WRITES. */
const PARAM_WRITER_KEY = "paramName";

/** Value keys that READ a parameter by bare name rather than in brackets. */
const BARE_PARAM_READ_KEYS = new Set(["pname"]);

const BRACKETED = /\[([^\]\s/]+)\]/g;

function readsOf(values: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [key, raw] of Object.entries(values)) {
    if (key === PARAM_WRITER_KEY) continue; // that's the write target, not a read
    if (BARE_PARAM_READ_KEYS.has(key)) {
      out.push(raw);
      continue;
    }
    for (const m of raw.matchAll(BRACKETED)) out.push(m[1]);
  }
  return out;
}

/** True when this node type diverges: only one of its exec outputs fires. */
function isBranching(type: string): boolean {
  const s = lookupNodeType(type);
  return (s?.execOut ?? 0) > 1 || (s?.dynamicSockets ?? []).includes("execOut");
}

type Ctx = ReadonlyMap<string, number>;
const compatible = (a: Ctx, b: Ctx): boolean => {
  for (const [node, idx] of a) {
    const other = b.get(node);
    if (other !== undefined && other !== idx) return false;
  }
  return true;
};

interface Visit {
  node: LintNode;
  ctx: Ctx;
  step: number;
}

/**
 * Same checks against an already-parsed VNyan graph, so an existing graph can
 * be audited with vnyan_graph_read. Connection ORDER is preserved from the
 * file, which is what makes the ordering checks meaningful here too.
 */
export function lintDescribedGraph(g: {
  nodes: { id: string; type: string; values: Record<string, string> }[];
  connections: { from: { nodeId: string; index: number } | null; to: { nodeId: string } | null }[];
  valueConnections: {
    from: { nodeId: string } | null;
    to: { nodeId: string; index: number } | null;
  }[];
}): string[] {
  const nodes: LintNode[] = g.nodes.map((n) => ({ id: n.id, type: n.type, values: n.values }));
  const conns: LintConnection[] = [];
  for (const c of g.connections) {
    if (!c.from || !c.to) continue;
    conns.push({ from: c.from.nodeId, fromIndex: c.from.index, to: c.to.nodeId });
  }
  const vconns: LintValueConnection[] = [];
  for (const c of g.valueConnections) {
    if (!c.from || !c.to) continue;
    vconns.push({ from: c.from.nodeId, to: c.to.nodeId, toIndex: c.to.index });
  }
  return lintGraphSpec(nodes, conns, vconns);
}

export function lintGraphSpec(
  nodes: LintNode[],
  connections: LintConnection[] = [],
  valueConnections: LintValueConnection[] = []
): string[] {
  const warnings: string[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // exec adjacency, preserving the order connections were declared - that IS
  // the order VNyan executes them (multicast delegate invocation order).
  const adj = new Map<string, { idx: number; to: string }[]>();
  for (const c of connections) {
    if (!byId.has(c.from) || !byId.has(c.to)) continue;
    const list = adj.get(c.from) ?? [];
    list.push({ idx: c.fromIndex ?? 0, to: c.to });
    adj.set(c.from, list);
  }

  // Roots: nodes that start execution (no execIn wired into them).
  const hasIncoming = new Set(connections.map((c) => c.to));
  const roots = nodes.filter((n) => !hasIncoming.has(n.id) && adj.has(n.id));

  const visits: Visit[] = [];
  let step = 0;
  const walk = (id: string, ctx: Ctx, seen: Set<string>) => {
    const node = byId.get(id);
    if (!node || seen.has(id)) return;
    visits.push({ node, ctx, step: step++ });
    const branching = isBranching(node.type);
    for (const edge of adj.get(id) ?? []) {
      const next = branching ? new Map([...ctx, [id, edge.idx] as [string, number]]) : ctx;
      walk(edge.to, next, new Set([...seen, id]));
    }
  };
  for (const r of roots) walk(r.id, new Map(), new Set());

  // ---- 1. the same blendshape written twice on one execution path ----
  // Two writes on DIFFERENT outputs of one branch node are correct and normal
  // (that is how a sign split works), so compare branch contexts rather than
  // simply counting occurrences graph-wide.
  const writes: { shape: string; v: Visit }[] = [];
  for (const v of visits) {
    if (v.node.type !== "BlendshapeNode") continue;
    const name = v.node.values?.bsName;
    if (!name) continue;
    for (const shape of name.split(";").map((s) => s.trim()).filter(Boolean)) {
      writes.push({ shape, v });
    }
  }
  const reported = new Set<string>();
  for (let i = 0; i < writes.length; i++) {
    for (let j = i + 1; j < writes.length; j++) {
      const a = writes[i], b = writes[j];
      if (a.shape !== b.shape) continue;
      if (!compatible(a.v.ctx, b.v.ctx)) continue; // mutually exclusive branches - fine
      const key = `${a.shape}|${a.v.node.id}|${b.v.node.id}`;
      if (reported.has(key)) continue;
      reported.add(key);
      warnings.push(
        `blendshape '${a.shape}' is written twice on the same execution path ` +
          `(nodes '${a.v.node.id}' and '${b.v.node.id}'). Both run in one tick, so the second wins. ` +
          `If one of them writes 0 to clear the shape, note bsValue 0 REMOVES the override and resets ` +
          `the smoothing origin, which suppresses the other write - give each shape exactly one write ` +
          `per tick and clear it on the branches that do not drive it.`
      );
    }
  }

  // ---- 2. a parameter read before the node that writes it ----
  const writeStep = new Map<string, Visit>();
  for (const v of visits) {
    const p = v.node.values?.[PARAM_WRITER_KEY];
    if (p && !writeStep.has(p)) writeStep.set(p, v);
  }
  const staleReported = new Set<string>();
  for (const v of visits) {
    for (const p of readsOf(v.node.values ?? {})) {
      const w = writeStep.get(p);
      if (!w || w.step <= v.step) continue;
      if (!compatible(v.ctx, w.ctx)) continue;
      const key = `${p}|${v.node.id}`;
      if (staleReported.has(key)) continue;
      staleReported.add(key);
      warnings.push(
        `node '${v.node.id}' reads '[${p}]' but the node that writes it ('${w.node.id}') is wired ` +
          `later, so it reads the PREVIOUS tick's value. Execution follows connection order - wire the ` +
          `writer first if you meant to use this tick's value.`
      );
    }
  }

  // ---- 3. a non-int source wired into BlendshapeNode's value socket ----
  // BlendshapeNode does `num = (int)obj` on that socket: a float source throws
  // InvalidCastException and the write is dropped with no error anywhere.
  for (const vc of valueConnections) {
    const target = byId.get(vc.to);
    const source = byId.get(vc.from);
    if (!target || !source) continue;
    if (target.type !== "BlendshapeNode" || vc.toIndex !== 1) continue;
    if (source.type === "DecimalToNumberNode" || source.type === "TextToNumberNode") continue;
    warnings.push(
      `'${source.type}' ("${vc.from}") is wired into BlendshapeNode "${vc.to}"'s value socket, which ` +
        `VNyan casts to int. Unless that output is already an int the write throws ` +
        `InvalidCastException and is silently dropped - route it through a 'DecimalToNumberNode'.`
    );
  }

  // ---- 4. MathExpNode on a timer: the frame-rate killer ----
  const mathExp = nodes.filter((n) => n.type === "MathExpNode").length;
  if (mathExp > 0) {
    const intervals = nodes
      .filter((n) => n.type === "SetTimerNode")
      .map((n) => Number(n.values?.seconds))
      .filter((ms) => Number.isFinite(ms) && ms > 0);
    const fastest = intervals.length ? Math.min(...intervals) : undefined;
    const rate = fastest ? ` on a ${fastest} ms timer that is ~${Math.round((mathExp * 1000) / fastest)} ` +
      `expression parses per second` : "";
    warnings.push(
      `this graph has ${mathExp} MathExpNode${mathExp > 1 ? "s" : ""}${rate}. MathExpNode re-runs a regex, ` +
        `reallocates the whole expression string per parameter, and rebuilds a closure tree on EVERY ` +
        `evaluation - it does not cache. Measured: 20 of them on a 33 ms timer took a 120 fps scene to ` +
        `30 fps. Fine for one-shot/event graphs; for anything on a timer use ParamOpNode / ParamMathNode / ` +
        `FilterParamNode instead. See vnyan_guide topic:'graph-performance'.`
    );
  }

  return warnings;
}
