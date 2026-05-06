export type RoleRelationshipGraphEdgeSource = 'reference' | 'marked' | 'relationship';

export interface RoleRelationshipGraphNode {
  id: string;
  label: string;
  name: string;
  uuid?: string;
  type?: string;
  affiliation?: string;
  packagePath?: string;
  sourcePath?: string;
  color?: string;
  roleData?: Record<string, unknown>;
  size: number;
  degree: number;
}

export interface RoleRelationshipGraphEdgeDetail {
  source: RoleRelationshipGraphEdgeSource;
  label: string;
  type: string;
  field?: string;
  sourceFile?: string;
  strength?: number;
  directed?: boolean;
  raw?: unknown;
}

export interface RoleRelationshipGraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  type: string;
  sources: RoleRelationshipGraphEdgeSource[];
  weight: number;
  directed: boolean;
  details: RoleRelationshipGraphEdgeDetail[];
}

export interface RoleRelationshipGraphData {
  nodes: RoleRelationshipGraphNode[];
  edges: RoleRelationshipGraphEdge[];
  stats: {
    roleCount: number;
    edgeCount: number;
    referenceEdgeCount: number;
    markedEdgeCount: number;
    relationshipEdgeCount: number;
  };
}
