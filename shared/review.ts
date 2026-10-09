import type { Analysis, Decision, GraphNode, Input } from './types';

export type ResolutionState = 'proposed' | 'applied' | 'committed' | 'merged';
export interface Session {
  id: string;
  name: string;
  worktree: string;
  registeredAt: string;
}
export interface CheckCommand {
  name: string;
  command: string;
  args: string[];
  timeoutMs: number;
}
export interface LocalConfig {
  sessions: Session[];
  checks: CheckCommand[];
}
export interface SourceRef {
  kind: 'revision' | 'worktree';
  value: string;
  label: string;
  sessionId?: string;
}
export interface FileSnapshot {
  code: string | null;
  hash: string;
  mode: string;
  unsupported?: string;
}
export interface Snapshot {
  ref: SourceRef;
  head: string;
  fingerprint: string;
  files: Record<string, FileSnapshot>;
}
export interface Evidence {
  revision: 'base' | 'a' | 'b';
  file: string;
  function: string;
  line: number;
  endLine: number;
  code: string;
  observations: string[];
}
export interface Recommendation {
  conflictId: string;
  action?: Decision;
  reason: string;
  confidence: 'static' | 'intent-guided';
  question?: string;
  actions: { label: string; decision: Decision }[];
}
export interface ReviewFile {
  path: string;
  input: Input;
  analysis: Analysis;
  evidence: Evidence[];
  graphs: { base: GraphNode[]; a: GraphNode[]; b: GraphNode[] };
  decisions: Record<string, Decision>;
  recommendations: Recommendation[];
}
export interface Intent {
  first: 'a' | 'b';
  rationale: string;
}
export interface CheckResult extends CheckCommand {
  status: 'passed' | 'failed' | 'timed-out' | 'error';
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  at: string;
}
export interface ReviewEvent {
  at: string;
  action: string;
  detail: string;
  reviewer: string;
}
export interface Preview {
  token: string;
  outputs: Record<string, string | null>;
  hashes: Record<string, string>;
  createdAt: string;
  checks: CheckCommand[];
}
export interface Review {
  schemaVersion: 1;
  id: string;
  revision: number;
  title: string;
  repository: string;
  commonDir: string;
  baseCommit: string;
  targetHead: string;
  sources: { a: Snapshot; b: Snapshot };
  files: ReviewFile[];
  unsupported: { path: string; reason: string }[];
  status: ResolutionState;
  createdAt: string;
  updatedAt: string;
  intent?: Intent;
  preview?: Preview;
  checks: CheckResult[];
  events: ReviewEvent[];
  attribution: { kind: 'local-git'; name: string; email: string; verified: false };
  commit?: string;
  mergedInto?: string;
  demo?: boolean;
}
export interface InspectOptions {
  repo: string;
  base?: string;
  a?: string;
  b?: string;
  sessions?: boolean;
}
