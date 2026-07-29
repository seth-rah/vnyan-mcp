export interface NodeValue {
  key: string;
  value: string;
}

export interface GraphNode {
  id: string;
  values: NodeValue[];
  posX: number;
  posY: number;
  path: string; // "Nodes/<Type>Node"
  ownerBlockId: string;
  inputSocketIds: string[];
  outputSocketIds: string[];
  headerColor: number;
  inputValueSocketIds: string[];
  outputValueSocketIds: string[];
}

export interface GraphBlock {
  id: string;
  posX: number;
  posY: number;
  sizeX: number;
  sizeY: number;
  title: string;
  headerColor: number;
  isLocked: boolean;
}

export interface GraphConnection {
  id: string;
  outputSocketId: string;
  inputSocketId: string;
}

export interface VNyanGraph {
  graphName?: string;
  graphIsActive?: boolean;
  nodes: GraphNode[];
  blocks?: GraphBlock[];
  connections: GraphConnection[];
  valueConnections?: GraphConnection[];
}
