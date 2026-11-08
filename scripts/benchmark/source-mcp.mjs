import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const LIMIT = 60000;
function bounded(text) {
  return {
    text: text.slice(0, LIMIT),
    totalCharacters: text.length,
    truncated: text.length > LIMIT,
  };
}

export function createSource(repo, refs) {
  repo = realpathSync(repo);
  const git = (...args) =>
    execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_OPTIONAL_LOCKS: '0',
      },
    });
  for (const [name, sha] of Object.entries(refs)) {
    if (!['base', 'a', 'b'].includes(name) || !/^[a-f0-9]{40}$/.test(sha))
      throw new Error('Invalid pinned ref');
    if (git('rev-parse', '--verify', `${sha}^{commit}`).trim() !== sha)
      throw new Error('Missing pinned commit');
  }
  if (Object.keys(refs).length !== 3) throw new Error('Three pinned refs required');
  const ref = z.enum(['base', 'a', 'b']);
  const safePath = z
    .string()
    .max(1000)
    .refine(
      (value) =>
        value.length > 0 &&
        !value.startsWith('/') &&
        !value.includes('\\') &&
        !value.includes('\0') &&
        !value
          .split('/')
          .some((part) => ['', '.', '..', '.git', 'eval', 'node_modules'].includes(part)) &&
        !/(^|\/)(\.env(?!\.test$|\.example$)(?:\..*)?|.*\.(?:pem|key))$/i.test(value),
      'Only ordinary committed source paths or public test/example environment files are readable',
    );
  const server = new McpServer({ name: 'benchmark-source', version: '1.0.0' });
  const reply = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
  const register = (name, description, inputSchema, action) =>
    server.registerTool(
      name,
      {
        description,
        inputSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async (args) => reply(action(args)),
    );
  register(
    'source_list',
    'List committed source paths at a pinned revision. No host files, evaluator data or .git access.',
    { ref, prefix: z.string().max(1000).optional() },
    ({ ref, prefix = '' }) => {
      const paths = git('ls-tree', '-r', '--name-only', refs[ref])
        .trim()
        .split('\n')
        .filter((path) => safePath.safeParse(path).success && path.startsWith(prefix));
      return { paths: paths.slice(0, 3000), total: paths.length, truncated: paths.length > 3000 };
    },
  );
  register(
    'source_read',
    'Read line ranges of a regular committed text file at base, a or b. Public .env.test is benchmark fixture data.',
    {
      ref,
      path: safePath,
      startLine: z.number().int().min(1).optional(),
      endLine: z.number().int().min(1).optional(),
    },
    ({ ref, path, startLine = 1, endLine = startLine + 399 }) => {
      if (endLine < startLine || endLine - startLine > 1000)
        throw new Error('Read at most 1001 lines per call');
      const entry = git('ls-tree', refs[ref], '--', path).trim();
      if (!/^100(?:644|755) blob [a-f0-9]{40}\t/.test(entry))
        throw new Error('Only regular committed files are readable');
      const text = git('show', `${refs[ref]}:${path}`);
      if (text.includes('\0')) throw new Error('Binary source is not supported');
      const lines = text.split('\n');
      return {
        path,
        ref,
        startLine,
        endLine: Math.min(endLine, lines.length),
        totalLines: lines.length,
        ...bounded(
          lines
            .slice(startLine - 1, endLine)
            .map((line, i) => `${startLine + i}: ${line}`)
            .join('\n'),
        ),
      };
    },
  );
  register(
    'source_diff',
    'Read base-to-side Git diff. Large outputs explicitly truncate; use source_read for omitted files.',
    {
      side: z.enum(['a', 'b']),
      path: safePath.optional(),
      context: z.number().int().min(0).max(20).optional(),
    },
    ({ side, path, context = 5 }) => {
      const paths = path
        ? [path]
        : git('diff', '--name-only', '-z', refs.base, refs[side])
            .split('\0')
            .filter((name) => safePath.safeParse(name).success);
      if (!paths.length) return bounded('');
      return bounded(
        git(
          '--literal-pathspecs',
          '--no-pager',
          'diff',
          '--no-ext-diff',
          '--no-textconv',
          `-U${context}`,
          refs.base,
          refs[side],
          '--',
          ...paths,
        ),
      );
    },
  );
  register(
    'source_log',
    'Read commit messages for a pinned side relative to base. Messages are hints; trust the code when they disagree.',
    { side: z.enum(['a', 'b']) },
    ({ side }) => bounded(git('log', '--reverse', '--format=%B', `${refs.base}..${refs[side]}`)),
  );
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createSource(
    process.env.FUSE_BENCH_REPO,
    JSON.parse(process.env.FUSE_BENCH_REFS || '{}'),
  );
  await server.connect(new StdioServerTransport());
}
