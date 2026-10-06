import { z } from 'zod';
import type { Input } from '../shared/types';
import { InputError } from './engine';
export const githubSchema = z
  .object({
    repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'Use owner/repository'),
    refA: z.string().trim().min(1).max(200),
    refB: z.string().trim().min(1).max(200),
    fileName: z
      .string()
      .trim()
      .min(1)
      .max(240)
      .refine(
        (v) => v.endsWith('.ts') && !v.split('/').some((p) => p === '..' || p === '.'),
        'Use a relative .ts file path',
      ),
  })
  .strict();
export async function importGitHub(
  args: z.infer<typeof githubSchema>,
  token?: string,
  request: typeof fetch = fetch,
): Promise<Input> {
  const root = `https://api.github.com/repos/${args.repository.split('/').map(encodeURIComponent).join('/')}`;
  async function get(path: string, missingAllowed = false) {
    const response = await request(root + path, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    if (response.status === 404 && missingAllowed) return null;
    if (!response.ok)
      throw new InputError(
        response.status === 401 || response.status === 403
          ? 'GitHub denied access or its rate limit was reached. Check the server’s GITHUB_TOKEN and repository permissions.'
          : response.status === 404
            ? 'GitHub could not find that repository or branch. Private repositories need a server-side GITHUB_TOKEN with Contents read access.'
            : `GitHub returned HTTP ${response.status}. Try again later.`,
      );
    return response.json();
  }
  const [a, b] = await Promise.all([
    get(`/commits/${encodeURIComponent(args.refA)}`),
    get(`/commits/${encodeURIComponent(args.refB)}`),
  ]);
  const sha = z.string().regex(/^[a-f0-9]{40}$/i);
  const shaA = sha.parse(a.sha),
    shaB = sha.parse(b.sha);
  const comparison = await get(`/compare/${shaA}...${shaB}`);
  const shaBase = sha.parse(comparison.merge_base_commit?.sha);
  async function file(ref: string) {
    const value = await get(
      `/contents/${args.fileName.split('/').map(encodeURIComponent).join('/')}?ref=${ref}`,
      true,
    );
    if (!value) return '';
    if (
      value.type !== 'file' ||
      value.encoding !== 'base64' ||
      typeof value.content !== 'string' ||
      value.size > 100000
    )
      throw new InputError('Choose a regular TypeScript file smaller than 100 KB.');
    const content = Buffer.from(value.content, 'base64').toString('utf8');
    if (Buffer.byteLength(content) > 100000)
      throw new InputError('The selected file is larger than 100 KB.');
    return content;
  }
  const [base, agentA, agentB] = await Promise.all([file(shaBase), file(shaA), file(shaB)]);
  if (!base && !agentA && !agentB)
    throw new InputError('That file does not exist at any of the selected commits.');
  return {
    title: `${args.repository}: ${args.fileName}`,
    fileName: args.fileName,
    base,
    agentA,
    agentB,
    nameA: args.refA,
    nameB: args.refB,
    origin: `GitHub ${args.repository}\nBase: ${shaBase}\nA: ${shaA}\nB: ${shaB}`,
  };
}
