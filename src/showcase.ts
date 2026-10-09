import type { ShowcaseData } from '../shared/showcase';
import type { Decision } from '../shared/types';

// The hosted example exports engine-generated code. Git application lives in the local MCP tool.
const storageKey = 'fuse-showcase-v1';
export async function showcaseApi(path: string, body: object = {}): Promise<unknown> {
  const request = body as {
    scenario?: string;
    revision?: number;
    token?: string;
    path?: string;
    conflictId?: string;
    decision?: Decision;
  };
  if (path === '/mode') return { mode: 'showcase', model: 'gpt-6-luna', aiConfigured: false };
  if (path === '/demo') {
    const scenario = request.scenario === 'shipping' ? 'shipping' : 'checkout';
    const response = await fetch(`/showcase/${scenario}.json`);
    if (!response.ok) throw new Error('Unable to open this example. Please reload.');
    const data = (await response.json()) as ShowcaseData;
    data.review.id = crypto.randomUUID();
    sessionStorage.setItem(storageKey, JSON.stringify(data));
    return data.review;
  }
  const match = /^\/reviews\/([^/]+)(?:\/(decide|preview|apply))?$/.exec(path);
  const stored = sessionStorage.getItem(storageKey);
  if (!match || !stored) throw new Error('Open a new change to continue.');
  const data = JSON.parse(stored) as ShowcaseData;
  const r = data.review;
  if (r.id !== match[1])
    throw new Error('This change belongs to another session. Open a new change.');
  if (!match[2]) return r;
  if (request.revision !== r.revision || r.status !== 'proposed')
    throw new Error('This change was updated. Please reload.');
  const file = r.files[0];
  const conflictId = r.visual!.conflictId!;
  if (match[2] === 'decide') {
    const decision = request.decision;
    const action = decision?.order || decision?.choice;
    if (
      request.path !== file.path ||
      request.conflictId !== conflictId ||
      !action ||
      !data.outputs[action]
    )
      throw new Error('Choose one of the available behaviors.');
    file.decisions[conflictId] = decision!;
    delete r.preview;
  } else if (match[2] === 'preview') {
    const decision = file.decisions[conflictId];
    const action = decision?.order || decision?.choice;
    const output = action && data.outputs[action];
    if (!output) throw new Error('Choose a behavior first.');
    r.preview = {
      token: crypto.randomUUID(),
      outputs: { [file.path]: output },
      hashes: {},
      createdAt: new Date().toISOString(),
      checks: [],
    };
  } else {
    if (!r.preview || request.token !== r.preview.token)
      throw new Error('Preview your choice first.');
    r.status = 'applied';
  }
  r.revision++;
  sessionStorage.setItem(storageKey, JSON.stringify(data));
  return r;
}
