#!/usr/bin/env python3
"""
Regenerate src/graph/schema.json - the node-type socket layout reference that
vnyan_node_schema serves and vnyan_graph_write validates against.

Usage
-----
1. Decompile VNyan's game assembly (ilspycmd is a dotnet global tool:
   `dotnet tool install -g ilspycmd`):

       ilspycmd -p -o <outdir> "<VNyan>/VNyan_Data/Managed/Assembly-CSharp.dll"

2. Run this script against that directory, ideally pointing it at some real
   VNyan-written graph files so it can ground-truth the values[] keys:

       python tools/extract-node-schema.py <outdir> \
           --unity-version 2022.3.62f3 \
           --graphs "<VNyan>/Examples/*.json" \
           --graphs "%USERPROFILE%/AppData/LocalLow/Suvidriel/VNyan/redeems*.json" \
           -o src/graph/schema.json

Where each field comes from, and how much to trust it
-----------------------------------------------------
Assembly-CSharp is name-obfuscated, but Unity must keep serialized field
names intact for prefab binding - so every node class's socket *fields* keep
their real names and types.

  * Socket counts and valueInFields/valueOutFields - read from declared
    fields. RELIABLE.
  * 'dynamicSockets' - socket kinds declared as an array or List<>, or any
    "Flex" node. Their real count lives in the Unity prefab or is built at
    runtime, so the number here is a FLOOR.
  * values[] keys - method bodies ARE obfuscated and salted with decoy
    string literals, so these cannot be read reliably from source. Preferred
    source is a real VNyan-written graph file (--graphs); anything that
    falls back to the source heuristic is marked 'valuesUncertain'.

When a node's value socket is wired, VNyan drops that key from its values[],
so where several key-sets are observed for one type the longest wins.
"""
import argparse
import glob
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

# Socket field type -> the schema key its count belongs to.
SOCKET_KINDS = {
    "SocketInput": "execIn",
    "SocketOutput": "execOut",
    "ValueSocketInput": "valueIn",
    "ValueSocketOutput": "valueOut",
}

# `public <SocketType>[?] <name>;` on its own line. The trailing `;` and the
# absence of `(` is what keeps method parameters (which also take socket
# types, e.g. `public void Foo(ValueSocketInput x, ...)`) out of the results.
FIELD_RE = re.compile(
    r"^\s*public\s+(?P<type>SocketInput|SocketOutput|ValueSocketInput|ValueSocketOutput)"
    r"(?P<array>\[\])?\s+(?P<name>\w+)\s*;\s*$"
)
# `public List<SocketOutput> foo;` - same idea, collection form.
LIST_FIELD_RE = re.compile(
    r"^\s*public\s+List<\s*(?P<type>SocketInput|SocketOutput|ValueSocketInput|ValueSocketOutput)\s*>"
    r"\s+(?P<name>\w+)"
)
CLASS_RE = re.compile(r"^\s*public\s+class\s+(?P<name>\w+)\s*:\s*Node\b")
# Obj.Method("literalKey", <rest>) - the shape of VNyan's own save/load calls.
CALL_RE = re.compile(r"[\w.]+\.(?P<method>\w+)\(\s*\"(?P<key>[^\"]*)\"\s*,")
KEYLIKE_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

# Exec-output counts for prefab-defined SocketOutput[] arrays, read off real
# VNyan-written graphs. These are floors confirmed by observation - a node may
# still have more outputs than any sample graph happened to use, which is why
# these types keep dynamicSockets set.
EXEC_OUT_OBSERVED = {
    "FilterParamNode": 3,
    "CompareTextNode": 2,
    "FilterBSNode": 2,
    "FilterGamepadNode": 2,
    "FilterVolumeNode": 2,
    "OrderedFlexNode": 2,
    "CrowdControlTimedNode": 2,
}

# values[] keys cross-checked by hand against VNyan's own shipped help files
# (VNyan_Data/StreamingAssets/HelpFiles/en/<Type>.html), which list a node's
# fields in socket order. Used for types no sample graph happens to contain,
# so they don't get flagged uncertain when we do in fact know them.
VALUES_VERIFIED_FROM_HELP = {
    # "GameObject Name / Rotation X / Rotation Y / Rotation Z / Smooth time / Is Toggle"
    "ObjectRotNode": ["rotx", "roty", "rotz", "name", "seconds", "toggle"],
}


def parse_node_file(path: Path):
    text = path.read_text(encoding="utf-8", errors="replace")
    lines = text.split("\n")

    class_name = None
    for line in lines:
        m = CLASS_RE.match(line)
        if m:
            class_name = m.group("name")
            break
    if class_name is None:
        return None

    counts = {k: 0 for k in SOCKET_KINDS.values()}
    fields = {k: [] for k in SOCKET_KINDS.values()}
    dynamic = set()

    for line in lines:
        m = FIELD_RE.match(line)
        if m:
            kind = SOCKET_KINDS[m.group("type")]
            if m.group("array"):
                # Length lives in the Unity prefab, not in source - the static
                # count is a floor, so record it as dynamic rather than 0.
                dynamic.add(kind)
            else:
                counts[kind] += 1
                fields[kind].append(m.group("name"))
            continue
        m = LIST_FIELD_RE.match(line)
        if m:
            dynamic.add(SOCKET_KINDS[m.group("type")])

    # "Flex" nodes build their whole socket layout at runtime from an `opts`
    # value, so no declared count is trustworthy for them.
    if class_name.endswith("FlexNode"):
        dynamic.update(SOCKET_KINDS.values())

    return {
        "type": class_name,
        **counts,
        "valueInFields": fields["valueIn"],
        "valueOutFields": fields["valueOut"],
        "dynamicSockets": sorted(dynamic),
        "values": extract_values_keys(lines),
    }


def extract_values_keys(lines):
    """
    Recover the `values[]` keys a node serializes.

    VNyan saves node state as repeated `store.Set("key", <field>)` calls.
    Those calls sit in a tight cluster, so we group every string-keyed call by
    method name, split each group into runs of nearby lines, and take the
    longest run whose keys look like identifiers. Obfuscation salts method
    bodies with decoy literals, so this is a heuristic - see CORRECTIONS.
    """
    by_method = defaultdict(list)
    for idx, line in enumerate(lines):
        for m in CALL_RE.finditer(line):
            key = m.group("key")
            if KEYLIKE_RE.match(key):
                by_method[m.group("method")].append((idx, key))

    best = []
    for calls in by_method.values():
        calls.sort()
        run = [calls[0]]
        runs = []
        for entry in calls[1:]:
            if entry[0] - run[-1][0] <= 3:
                run.append(entry)
            else:
                runs.append(run)
                run = [entry]
        runs.append(run)
        for r in runs:
            keys = [k for _, k in r]
            if len(keys) > len(best):
                best = keys
    return best


def scan_graphs(globs):
    """
    Ground-truth values[] keys and exec-output counts from real VNyan-written
    graph files. VNyan drops a key from values[] when that value socket is
    wired, so for each node type we keep the longest key-set seen (ties broken
    by how often it appears).
    """
    values_seen = defaultdict(Counter)
    exec_out_seen = defaultdict(int)
    files = []
    for pattern in globs:
        files.extend(glob.glob(pattern))
    for path in files:
        try:
            graph = json.loads(Path(path).read_text(encoding="utf-8-sig"))
        except Exception:
            continue
        for node in graph.get("nodes", []):
            name = node.get("path", "").split("/")[-1]
            if not name:
                continue
            values_seen[name][tuple(v["key"] for v in node.get("values", []))] += 1
            exec_out_seen[name] = max(exec_out_seen[name], len(node.get("outputSocketIds", [])))
    best_values = {}
    for name, counter in values_seen.items():
        keys, _ = max(counter.items(), key=lambda kv: (len(kv[0]), kv[1]))
        best_values[name] = list(keys)
    return best_values, dict(exec_out_seen), len(files)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("decompiled_dir", help="Directory produced by `ilspycmd -p -o <dir> Assembly-CSharp.dll`")
    ap.add_argument("-o", "--out", required=True, help="Destination schema.json")
    ap.add_argument("--unity-version", required=True,
                    help="Unity engine version of the VNyan build (see Player.log 'Initialize engine version')")
    ap.add_argument("--graphs", action="append", default=[], metavar="GLOB",
                    help="Glob of real VNyan graph .json files to ground-truth values[] keys against. "
                         "Repeatable. Strongly recommended - without it every values[] list falls back "
                         "to an unreliable source heuristic and is flagged valuesUncertain.")
    args = ap.parse_args()

    src = Path(args.decompiled_dir)
    node_files = sorted(src.glob("*Node.cs"))
    if not node_files:
        sys.exit(f"No *Node.cs files found in {src} - did the decompile succeed?")

    graph_values, graph_exec_out, graph_file_count = scan_graphs(args.graphs)
    if args.graphs and not graph_file_count:
        print(f"warning: --graphs matched no files; every values[] will be heuristic", file=sys.stderr)

    types = {}
    for path in node_files:
        parsed = parse_node_file(path)
        if not parsed:
            continue
        name = parsed.pop("type")
        dynamic = parsed["dynamicSockets"]

        # values[]: a real graph wins; otherwise fall back to the source
        # heuristic and say so.
        if name in graph_values:
            values = graph_values[name]
            uncertain = False
        elif name in VALUES_VERIFIED_FROM_HELP:
            values = VALUES_VERIFIED_FROM_HELP[name]
            uncertain = False
        else:
            values = parsed["values"]
            uncertain = True

        exec_out = parsed["execOut"]
        # For array/runtime socket kinds the declared count is 0, so take the
        # best floor we have: an observed graph, else the curated table.
        if "execOut" in dynamic:
            exec_out = max(exec_out, graph_exec_out.get(name, 0), EXEC_OUT_OBSERVED.get(name, 0))

        entry = {
            "path": f"Nodes/{name}",
            "execIn": parsed["execIn"],
            "execOut": exec_out,
            "valueIn": parsed["valueIn"],
            "valueOut": parsed["valueOut"],
            "values": values,
            "valueInFields": parsed["valueInFields"],
            "valueOutFields": parsed["valueOutFields"],
        }
        if dynamic:
            entry["dynamicSockets"] = dynamic
        if uncertain:
            entry["valuesUncertain"] = True
        types[name] = entry

    # values shorter than the valueIn socket count usually means a value
    # socket was wired in the sampled graph (VNyan drops wired keys), or the
    # heuristic missed a differently-shaped save path.
    for entry in types.values():
        entry["possiblyIncomplete"] = len(entry["values"]) < entry["valueIn"]

    confirmed = sum(1 for e in types.values() if not e.get("valuesUncertain"))
    out = {
        "_meta": {
            "unityVersion": args.unity_version,
            "generatedFrom": "Assembly-CSharp.dll (decompiled; node classes retain real socket field names despite obfuscation elsewhere)",
            "generatedBy": "tools/extract-node-schema.py",
            "typeCount": len(types),
            "valuesConfirmedFromGraphs": confirmed,
            "graphFilesScanned": graph_file_count,
            "note": (
                "Socket counts and valueInFields/valueOutFields are read from declared fields and are "
                "reliable. 'dynamicSockets' lists socket kinds whose real count comes from the Unity "
                "prefab or is created at runtime - for those the count here is a FLOOR, not a ceiling; "
                "confirm against a real graph with vnyan_graph_read. 'valuesUncertain' marks types whose "
                "values[] keys came from an unreliable source heuristic rather than an observed VNyan "
                "graph - verify those before relying on them. VNyan exposes no app version string, so "
                "the Unity engine version above identifies the build this came from."
            ),
        },
        "types": dict(sorted(types.items())),
    }

    Path(args.out).write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    dyn = sum(1 for e in types.values() if e.get("dynamicSockets"))
    print(f"wrote {args.out}: {len(types)} types, {dyn} with dynamic sockets, "
          f"{confirmed} values[] confirmed from {graph_file_count} real graph file(s), "
          f"{len(types) - confirmed} flagged valuesUncertain")


if __name__ == "__main__":
    main()
