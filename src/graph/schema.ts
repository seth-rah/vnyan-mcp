import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface NodeTypeSchema {
  path: string;
  execIn: number;
  execOut: number;
  valueIn: number;
  valueOut: number;
  values: string[];
  possiblyIncomplete: boolean;
  /** Exact declared field names in socket-index order - ground truth from
   * the C# source. Prefer this over `values` when you need a specific
   * socket index; `values` can diverge in length for composite widgets
   * (e.g. a single color-picker socket exploding into color_r/g/b keys). */
  valueInFields: string[];
  valueOutFields: string[];
}

interface SchemaMeta {
  unityVersion: string;
  generatedFrom: string;
  typeCount: number;
  note: string;
}

interface SchemaFile {
  _meta: SchemaMeta;
  types: Record<string, NodeTypeSchema>;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, "schema.json");

// Derived offline by decompiling VNyan_Data\Managed\Assembly-CSharp.dll and
// extracting each node class's declared SocketInput/SocketOutput/
// ValueSocketInput/ValueSocketOutput fields plus its values[]-serialization
// call sequence - see `_meta` in schema.json for the VNyan/Unity build this
// was generated from. `possiblyIncomplete` marks entries where the
// extracted `values` list is shorter than the valueIn socket count -
// usually because a value only reaches `values[]` through a differently-
// shaped save path (e.g. encrypted file-path fields) that the extraction
// heuristic missed.
const SCHEMA_FILE: SchemaFile = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf-8"));

export function lookupNodeType(typeName: string): NodeTypeSchema | undefined {
  return SCHEMA_FILE.types[typeName];
}

export function allNodeTypes(): string[] {
  return Object.keys(SCHEMA_FILE.types).sort();
}

export function nodePath(typeName: string): string {
  return `Nodes/${typeName}`;
}

export function schemaMetadata(): SchemaMeta {
  return SCHEMA_FILE._meta;
}
