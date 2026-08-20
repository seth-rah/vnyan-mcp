/**
 * Self-check for src/graph/lint.ts. Run with: npm run selftest
 *
 * The branch-context logic is the part worth guarding: writing one blendshape
 * from two different exec outputs of the same FilterParamNode is correct and
 * common (that is how a sign split works), while two writes off the SAME output
 * is a real bug. A naive occurrence count gets that backwards, so both
 * directions are asserted here.
 */
import { lintGraphSpec, lintDescribedGraph } from "../dist/graph/lint.js";

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
};
const has = (ws, s) => ws.some((w) => w.includes(s));

// --- same shape twice off ONE exec output: a real bug ---
const dbl = lintGraphSpec(
  [
    { id: "tick", type: "TimerNode", values: { timerName: "t" } },
    { id: "clear", type: "BlendshapeNode", values: { bsName: "Shape_A", bsValue: "0" } },
    { id: "write", type: "BlendshapeNode", values: { bsName: "Shape_A", bsValue: "50" } },
  ],
  [{ from: "tick", to: "clear" }, { from: "tick", to: "write" }]
);
check("double write on one path is flagged", has(dbl, "written twice"), JSON.stringify(dbl));

// --- same shape on mutually exclusive branches: correct, must stay quiet ---
const branch = lintGraphSpec(
  [
    { id: "tick", type: "TimerNode", values: { timerName: "t" } },
    { id: "sign", type: "FilterParamNode", values: { pname: "total", pvalue: "0" } },
    { id: "hi", type: "BlendshapeNode", values: { bsName: "Shape_A", bsValue: "100" } },
    { id: "lo", type: "BlendshapeNode", values: { bsName: "Shape_A", bsValue: "[total]" } },
  ],
  [
    { from: "tick", to: "sign" },
    { from: "sign", to: "hi", fromIndex: 0 },
    { from: "sign", to: "lo", fromIndex: 2 },
  ]
);
check("exclusive branches are not flagged", !has(branch, "written twice"), JSON.stringify(branch));

// --- semicolon name lists are expanded before comparing ---
const semi = lintGraphSpec(
  [
    { id: "tick", type: "TimerNode", values: { timerName: "t" } },
    { id: "a", type: "BlendshapeNode", values: { bsName: "Shape_L;Shape_R", bsValue: "10" } },
    { id: "b", type: "BlendshapeNode", values: { bsName: "Shape_R", bsValue: "20" } },
  ],
  [{ from: "tick", to: "a" }, { from: "tick", to: "b" }]
);
check("';' lists are expanded for the clash check", has(semi, "'Shape_R' is written twice"), JSON.stringify(semi));

// --- read wired before its writer reads last tick's value ---
const nodes = [
  { id: "tick", type: "TimerNode", values: { timerName: "t" } },
  { id: "reader", type: "ParamOpNode", values: { paramName: "out", value1: "[sum]", value2: "1", operation: "0" } },
  { id: "writer", type: "ParamOpNode", values: { paramName: "sum", value1: "2", value2: "3", operation: "0" } },
];
const stale = lintGraphSpec(nodes, [{ from: "tick", to: "reader" }, { from: "tick", to: "writer" }]);
check("read-before-write is flagged", has(stale, "PREVIOUS tick"), JSON.stringify(stale));
const ordered = lintGraphSpec(nodes, [{ from: "tick", to: "writer" }, { from: "tick", to: "reader" }]);
check("write-then-read order is clean", !has(ordered, "PREVIOUS tick"), JSON.stringify(ordered));

// --- BlendshapeNode's value socket is an int ---
const castNodes = [
  { id: "tick", type: "TimerNode", values: { timerName: "t" } },
  { id: "exp", type: "MathExpNode", values: { exp: "1+1" } },
  { id: "bs", type: "BlendshapeNode", values: { bsName: "Shape_A" } },
];
const cast = lintGraphSpec(castNodes, [{ from: "tick", to: "bs" }], [{ from: "exp", to: "bs", toIndex: 1 }]);
check("float into the int value socket is flagged", has(cast, "casts to int"), JSON.stringify(cast));
check("MathExpNode cost is flagged", has(cast, "MathExpNode"), JSON.stringify(cast));

const viaConverter = lintGraphSpec(
  [...castNodes, { id: "cvt", type: "DecimalToNumberNode", values: {} }],
  [{ from: "tick", to: "bs" }],
  [{ from: "exp", to: "cvt", toIndex: 0 }, { from: "cvt", to: "bs", toIndex: 1 }]
);
check("DecimalToNumberNode satisfies the cast check", !has(viaConverter, "casts to int"), JSON.stringify(viaConverter));

// --- a clean cheap-node graph produces nothing at all ---
const clean = lintGraphSpec(
  [
    { id: "tick", type: "TimerNode", values: { timerName: "t" } },
    { id: "sum", type: "ParamOpNode", values: { paramName: "total", value1: "[a]", value2: "[b]", operation: "0" } },
    { id: "sign", type: "FilterParamNode", values: { pname: "total", pvalue: "0" } },
    { id: "pos", type: "BlendshapeNode", values: { bsName: "Shape_P", bsValue: "[total]" } },
    { id: "neg", type: "BlendshapeNode", values: { bsName: "Shape_N", bsValue: "0" } },
  ],
  [
    { from: "tick", to: "sum" },
    { from: "tick", to: "sign" },
    { from: "sign", to: "pos", fromIndex: 0 },
    { from: "sign", to: "neg", fromIndex: 2 },
  ]
);
check("a well-formed cheap-node graph is silent", clean.length === 0, JSON.stringify(clean));

// --- the read-side adapter reaches the same conclusions ---
const described = lintDescribedGraph({
  nodes: [
    { id: "n1", type: "TimerNode", values: { timerName: "t" } },
    { id: "n2", type: "BlendshapeNode", values: { bsName: "Shape_A", bsValue: "0" } },
    { id: "n3", type: "BlendshapeNode", values: { bsName: "Shape_A", bsValue: "5" } },
  ],
  connections: [
    { from: { nodeId: "n1", index: 0 }, to: { nodeId: "n2" } },
    { from: { nodeId: "n1", index: 0 }, to: { nodeId: "n3" } },
  ],
  valueConnections: [],
});
check("lintDescribedGraph flags the same clash", has(described, "written twice"), JSON.stringify(described));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
