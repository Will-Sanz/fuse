import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Workspace, WorkspaceSummary } from '../shared/types';

export class Store {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path),{recursive:true});
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL)');
  }
  list(): WorkspaceSummary[] {
    const rows = this.db.prepare('SELECT data FROM workspaces ORDER BY updated_at DESC LIMIT 100').all();
    return rows.map(row=>{
      const w = JSON.parse(row.data as string) as Workspace;
      return {id:w.id,title:w.input.title,fileName:w.input.fileName,updatedAt:w.updatedAt,resolved:w.output!==null,conflicts:w.analysis.conflicts.length,decided:Object.keys(w.decisions).length};
    });
  }
  get(id:string): Workspace | undefined {
    const row = this.db.prepare('SELECT data FROM workspaces WHERE id=?').get(id);
    return row ? JSON.parse(row.data as string) : undefined;
  }
  create(workspace:Workspace) {
    this.db.prepare('INSERT INTO workspaces VALUES (?, ?, ?, ?)').run(workspace.id,workspace.revision,workspace.updatedAt,JSON.stringify(workspace));
  }
  update(workspace:Workspace,expectedRevision:number) {
    const result = this.db.prepare('UPDATE workspaces SET revision=?, updated_at=?, data=? WHERE id=? AND revision=?').run(workspace.revision,workspace.updatedAt,JSON.stringify(workspace),workspace.id,expectedRevision);
    return Number(result.changes) === 1;
  }
  close() { this.db.close(); }
}
