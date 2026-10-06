export type Choice = 'a' | 'b' | 'both' | 'reviewed';
export interface Input {
  title: string;
  fileName: string;
  base: string;
  agentA: string;
  agentB: string;
  nameA: string;
  nameB: string;
  origin?: string;
}
export interface Decision {
  choice: Choice;
  order?: 'a-first' | 'b-first';
  note: string;
}
export interface Diagnostic {
  line: number;
  message: string;
  code: number;
  category: 'error' | 'warning';
}
export interface GraphNode {
  id: string;
  label: string;
  line: number;
  changedBy: ('a' | 'b')[];
  calls: string[];
}
export interface Conflict {
  id: string;
  kind: 'overlap' | 'dependency' | 'file';
  functions: string[];
  title: string;
  explanation: string;
  canCombine: boolean;
  combineReason: string;
  base: string;
  a: string;
  b: string;
  observationsA?: string[];
  observationsB?: string[];
}
export interface Analysis {
  nodes: GraphNode[];
  conflicts: Conflict[];
  changedA: string[];
  changedB: string[];
  warnings: string[];
  hashes: { base: string; a: string; b: string };
}
export interface RecordEntry {
  id: string;
  at: string;
  action: string;
  detail: string;
}
export interface Workspace {
  id: string;
  input: Input;
  analysis: Analysis;
  decisions: Record<string, Decision>;
  revision: number;
  createdAt: string;
  updatedAt: string;
  events: RecordEntry[];
  output: string | null;
  outputHash: string | null;
  diagnostics: Diagnostic[];
}
export interface WorkspaceSummary {
  id: string;
  title: string;
  fileName: string;
  updatedAt: string;
  resolved: boolean;
  conflicts: number;
  decided: number;
}
