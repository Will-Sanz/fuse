import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Review } from '../shared/review';
import { INLINE_REVIEW_MIME, INLINE_REVIEW_URI, type InlineReviewResult } from '../shared/inline';
import { InputError } from './engine';
import { LocalStore } from './local-store';
import { applyReview, assertFresh, preview } from './local';
import { confirmBehavior, sourceVersion } from './proposals';
import { visualPng } from './visual-renderer';

const lifetimeMs = 15 * 60 * 1000;
const sessionError = () =>
  new InputError(
    'Inline review session expired or unavailable. Ask the agent to present this review again.',
  );
const actionSchema = z
  .object({
    repo: z.string(),
    id: z.string().uuid(),
    capability: z.string().regex(/^[a-f0-9]{64}$/),
    revision: z.number().int().nonnegative(),
    action: z.enum(['refresh', 'confirm', 'preview', 'apply']),
    behaviorId: z.string().uuid().optional(),
    token: z.string().length(64).optional(),
  })
  .strict();

/** Capabilities live only in component-private result metadata, never in resource HTML. */
export function createInlineReview() {
  const sessions = new Map<
    string,
    { repo: string; id: string; sourceVersion: string; expires: number }
  >();
  function present(store: LocalStore, review: Review, allowActions = false): InlineReviewResult {
    assertFresh(review);
    let image: string | undefined;
    if (review.visual) {
      try {
        image = visualPng(review.visual).toString('base64');
      } catch {
        // A broken saved visual must not hide the review or its human controls.
      }
    }
    for (const [key, value] of sessions) if (value.expires <= Date.now()) sessions.delete(key);
    if (sessions.size >= 100) sessions.delete(sessions.keys().next().value!);
    const capability =
      allowActions && review.behavioral ? randomBytes(32).toString('hex') : undefined;
    if (capability)
      sessions.set(capability, {
        repo: store.repo,
        id: review.id,
        sourceVersion: sourceVersion(review),
        expires: Date.now() + lifetimeMs,
      });
    return {
      content: [{ type: 'text', text: JSON.stringify({ schemaVersion: 1, data: review }) }],
      structuredContent: { schemaVersion: 1, data: review },
      _meta: {
        fuse: {
          reviewId: review.id,
          ...(capability ? { capability } : {}),
          ...(image ? { visualPng: image } : {}),
        },
      },
    };
  }
  function act(store: LocalStore, input: z.infer<typeof actionSchema>) {
    const data = actionSchema.parse(input),
      session = sessions.get(data.capability);
    // A recognized capability is single-use even when an action fails a later guard.
    if (session) sessions.delete(data.capability);
    const review = store.get(data.id);
    if (
      !session ||
      session.expires <= Date.now() ||
      session.repo !== store.repo ||
      session.id !== data.id ||
      session.sourceVersion !== sourceVersion(review)
    )
      throw sessionError();
    if (!review.behavioral)
      throw new InputError('Legacy decisions require the explicit browser review.');
    if ((data.action !== 'confirm' && data.behaviorId) || (data.action !== 'apply' && data.token))
      throw new InputError('Unexpected inline action fields.');
    let result: Review;
    switch (data.action) {
      case 'refresh':
        result = review;
        break;
      case 'confirm':
        if (!data.behaviorId) throw new InputError('Choose a registered behavior.');
        result = confirmBehavior(store.repo, data.id, data.revision, data.behaviorId);
        break;
      case 'preview':
        result = preview(store.repo, data.id, data.revision);
        break;
      case 'apply':
        if (!data.token) throw new InputError('Approve the exact preview token.');
        result = applyReview(store.repo, data.id, data.revision, data.token);
        break;
    }
    return present(store, result, true);
  }
  return { present, act, close: () => sessions.clear() };
}

export function registerInlineReview(
  server: McpServer,
  storeFor: (repo?: string) => LocalStore,
  repoInput: z.ZodType<string | undefined>,
) {
  const inline = createInlineReview();
  // Privacy compatibility, not authentication: typed model calls cannot alter the handshake.
  const supportsPrivateMetadata = () => {
    const client = server.server.getClientVersion();
    return (
      client?.name === 'codex-mcp-client' &&
      ['0.166.0-alpha.5.1', '0.167.0-alpha.3.2'].includes(client.version)
    );
  };
  const previousClose = server.server.onclose;
  server.server.onclose = () => {
    inline.close();
    previousClose?.();
  };

  server.registerResource(
    'fuse-review-ui',
    INLINE_REVIEW_URI,
    {
      mimeType: INLINE_REVIEW_MIME,
      description: 'Fuse inline review component; contains no review capabilities or source.',
    },
    async () => ({
      contents: [
        {
          uri: INLINE_REVIEW_URI,
          mimeType: INLINE_REVIEW_MIME,
          text: readFileSync(
            fileURLToPath(new URL('../dist/inline/review.html', import.meta.url)),
            'utf8',
          ),
          _meta: {
            ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: false },
            'openai/ui': {
              availableDisplayModes: ['inline', 'fullscreen'],
              preferredDisplayMode: 'inline',
            },
            'openai/widgetShowCodexWidgetInline': true,
            'openai/widgetHeightHint': 340,
          },
        },
      ],
    }),
  );
  server.registerTool(
    'fuse_present_review',
    {
      description:
        'Present the SAVED review as an inline Fuse card in the current coding client. Does not inspect again, open a browser, choose behavior, or apply code. The developer uses component controls for human decisions. If no inline UI appears, report the unsupported host; open a browser only when explicitly requested.',
      inputSchema: { repo: repoInput, id: z.string().uuid() },
      outputSchema: z.object({ schemaVersion: z.literal(1), data: z.unknown() }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: {
        ui: { resourceUri: INLINE_REVIEW_URI },
        'openai/outputTemplate': INLINE_REVIEW_URI,
        'openai/ui': { preferredModelDisplayMode: 'inline' },
      },
    },
    async ({ repo, id }) => {
      const store = storeFor(repo);
      return { ...inline.present(store, store.get(id), supportsPrivateMetadata()) };
    },
  );
  server.registerTool(
    'fuse_ui_action',
    {
      description:
        'Component-only human review action. Requires the private session capability; unavailable as an agent action. Never invent, inspect, or disclose a capability.',
      inputSchema: actionSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      _meta: {
        ui: { visibility: ['app'] },
        'openai/visibility': 'private',
        'openai/widgetAccessible': true,
      },
    },
    async (input) => {
      if (!supportsPrivateMetadata()) throw sessionError();
      return { ...inline.act(storeFor(input.repo), input) };
    },
  );
}
