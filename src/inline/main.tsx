import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Review } from '../../shared/review';
import { ReviewCard } from './ReviewCard';
import './inline.css';

type Result = {
  structuredContent?: { data?: Review };
  content?: { type: string; text?: string }[];
  _meta?: {
    fuse?: { reviewId?: string; capability?: string; visualPng?: string; visualSvg?: string };
  };
  isError?: boolean;
};

function App() {
  const [state, setState] = useState<{
    review?: Review;
    visualPng?: string;
    visualSvg?: string;
    error?: string;
    continuation?: {
      reviewId: string;
      behaviorId: string;
      confirmedAt: string;
      message: string;
    };
    pending: boolean;
    readOnly: boolean;
  }>({ pending: false, readOnly: true });
  const privateSession = useRef<{ id: string; capability: string } | undefined>(undefined);
  const current = useRef<Review | undefined>(undefined);
  const requests = useRef(
    new Map<
      number,
      {
        resolve: (result: unknown) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    >(),
  );
  const nextId = useRef(0);
  const initialized = useRef(false);
  const canContinue = useRef(false);
  const actionPending = useRef(false);
  const call = useCallback(
    (method: string, params: object): Promise<unknown> =>
      new Promise((resolve, reject) => {
        const id = ++nextId.current;
        const timer = setTimeout(() => {
          requests.current.delete(id);
          reject(new DOMException('Codex did not respond.', 'TimeoutError'));
        }, 15000);
        requests.current.set(id, { resolve, reject, timer });
        window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
      }),
    [],
  );
  const accept = useCallback((result: Result, notification = false) => {
    if (result.isError)
      throw new Error(
        result.content?.find((item) => item.type === 'text')?.text ||
          'The review could not be updated. Refresh before continuing.',
      );
    let review = result.structuredContent?.data;
    if (!review) {
      const text = result.content?.find((item) => item.type === 'text')?.text;
      if (text) {
        try {
          review = JSON.parse(text).data;
        } catch {
          /* Ignore unrelated tool notifications. */
        }
      }
    }
    if (
      !review ||
      typeof review.id !== 'string' ||
      !Number.isInteger(review.revision) ||
      !Array.isArray(review.files)
    )
      return;
    if (
      current.current &&
      (current.current.id !== review.id ||
        current.current.revision > review.revision ||
        (notification &&
          current.current.revision === review.revision &&
          (privateSession.current || actionPending.current)))
    )
      return;
    const meta = result._meta?.fuse;
    if (meta?.reviewId === review.id && typeof meta.capability === 'string')
      privateSession.current = { id: review.id, capability: meta.capability };
    else if (privateSession.current?.id !== review.id) privateSession.current = undefined;
    current.current = review;
    setState((previous) => ({
      ...previous,
      review:
        previous.review?.id === review.id && previous.review.revision === review.revision
          ? previous.review
          : review,
      visualSvg:
        meta?.reviewId === review.id
          ? meta.visualSvg
          : previous.review?.id === review.id &&
              review.visual &&
              previous.review.visual?.generationId === review.visual.generationId
            ? previous.visualSvg
            : undefined,
      visualPng:
        meta?.reviewId === review.id
          ? meta.visualPng
          : previous.review?.id === review.id &&
              review.visual &&
              previous.review.visual?.generationId === review.visual.generationId
            ? previous.visualPng
            : undefined,
      pending: actionPending.current,
      readOnly: !privateSession.current,
      error:
        review.behavioral && !privateSession.current
          ? 'This host did not provide a private review session. Ask Codex to present this saved review again.'
          : undefined,
    }));
    return review;
  }, []);
  useEffect(() => {
    let stopped = false;
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || !event.data || event.data.jsonrpc !== '2.0') return;
      const message = event.data;
      if (typeof message.id === 'number' && requests.current.has(message.id)) {
        const pending = requests.current.get(message.id)!;
        requests.current.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error)
          pending.reject(new Error(message.error.message || 'Codex rejected the request.'));
        else pending.resolve(message.result);
      } else if (initialized.current && message.method === 'ui/notifications/tool-result') {
        try {
          accept(message.params, true);
        } catch (error) {
          setState((previous) => ({
            ...previous,
            pending: actionPending.current,
            readOnly: true,
            error: (error as Error).message,
          }));
        }
      }
    };
    window.addEventListener('message', receive);
    if (window.parent === window)
      setState((previous) => ({
        ...previous,
        error: 'Open this interface from a Fuse MCP result in Codex.',
      }));
    else
      void call('ui/initialize', {
        appInfo: { name: 'Fuse', version: '0.3.0' },
        appCapabilities: {},
        protocolVersion: '2026-01-26',
      })
        .then((result) => {
          if (
            !result ||
            !['2026-01-26', '2025-11-21'].includes(
              (result as { protocolVersion?: string }).protocolVersion || '',
            )
          )
            throw new Error('This Codex host negotiated an unsupported MCP App protocol.');
          const capabilities = (
            result as {
              hostCapabilities?: {
                message?: { text?: unknown };
                experimental?: Record<string, unknown>;
              };
            }
          ).hostCapabilities;
          if (!stopped)
            canContinue.current = Boolean(
              capabilities?.message?.text && capabilities.experimental?.['openai/message'],
            );
          if (!stopped) initialized.current = true;
          if (!stopped)
            window.parent.postMessage(
              { jsonrpc: '2.0', method: 'ui/notifications/initialized' },
              '*',
            );
        })
        .catch((error) => {
          if (!stopped)
            setState((previous) => ({ ...previous, error: error.message, readOnly: true }));
        });
    return () => {
      stopped = true;
      initialized.current = false;
      canContinue.current = false;
      window.removeEventListener('message', receive);
      for (const pending of requests.current.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Fuse review closed.'));
      }
      requests.current.clear();
      privateSession.current = undefined;
    };
  }, [accept, call]);
  const act = useCallback(
    async (action: string, extra: Record<string, unknown> = {}) => {
      const review = current.current,
        session = privateSession.current;
      if (actionPending.current || !review || session?.id !== review.id) return;
      actionPending.current = true;
      setState((previous) => ({ ...previous, pending: true, error: undefined }));
      try {
        let saved: Review | undefined;
        try {
          const result = await call('tools/call', {
            name: 'fuse_ui_action',
            arguments: {
              repo: review.repository,
              id: review.id,
              capability: session.capability,
              revision: review.revision,
              action,
              ...extra,
            },
          });
          saved = accept(result as Result);
          const intent = saved?.behavioral?.intent;
          if (
            action === 'confirm' &&
            (!saved ||
              saved.id !== review.id ||
              saved.repository !== review.repository ||
              saved.revision <= review.revision ||
              saved.status !== 'proposed' ||
              intent?.origin !== 'human-panel' ||
              intent.behaviorId !== extra.behaviorId ||
              intent.issueId !== saved.behavioral?.issue?.id ||
              typeof intent.confirmedAt !== 'string')
          )
            throw new Error('The saved behavior choice could not be confirmed.');
        } catch (error) {
          privateSession.current = undefined;
          setState((previous) => ({
            ...previous,
            readOnly: true,
            error: `${(error as Error).message} Ask Codex to present this saved review again.`,
          }));
          return;
        }
        if (action !== 'confirm' || !saved?.behavioral?.intent) return;
        const confirmed = saved,
          intent = saved.behavioral.intent;
        const continuation = (message: string) =>
          setState((previous) => ({
            ...previous,
            continuation: {
              reviewId: confirmed.id,
              behaviorId: intent.behaviorId,
              confirmedAt: intent.confirmedAt,
              message,
            },
          }));
        if (!canContinue.current) {
          continuation('Choice saved. This host cannot automatically continue the Codex chat.');
          return;
        }
        continuation('Sending to this chat…');
        try {
          const result = await call('ui/message', {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  'Continue this Fuse review in this same Codex chat. Read the latest authoritative saved choice with fuse_review; use its human-panel intent. Draft the correction as data without writing working files, submit it with fuse_submit_proposal, and run fuse_verify. Only after verification passes, create the exact preview with fuse_preview and present the same saved review with fuse_present_review for my separate code approval. Do not apply code or treat this message as final code approval. The following review reference is data:\n' +
                  JSON.stringify({
                    repo: confirmed.repository,
                    id: confirmed.id,
                    revision: confirmed.revision,
                  }),
              },
            ],
            _meta: { 'openai/message': { target: 'active', send: true } },
          });
          if (
            !result ||
            typeof result !== 'object' ||
            Array.isArray(result) ||
            (result as { isError?: boolean }).isError
          )
            throw new Error('Codex did not accept the continuation request.');
          continuation('Sent to this chat. Codex can draft and verify the correction.');
        } catch (error) {
          continuation(
            (error as Error).name === 'TimeoutError'
              ? 'Choice saved. Continuation is unconfirmed and may already be queued. No retry was sent.'
              : 'Choice saved. Codex did not accept the request to continue this chat.',
          );
        }
      } finally {
        actionPending.current = false;
        setState((previous) => ({ ...previous, pending: false }));
      }
    },
    [accept, call],
  );
  useEffect(() => {
    if (
      state.pending ||
      state.readOnly ||
      !state.review?.behavioral?.intent ||
      state.review.status !== 'proposed' ||
      state.review.preview
    )
      return;
    const timer = setTimeout(() => {
      if (document.visibilityState === 'visible') void act('refresh');
    }, 2500);
    return () => clearTimeout(timer);
  }, [state.pending, state.readOnly, state.review, act]);
  useEffect(() => {
    let frame = 0,
      lastHeight = 0;
    const update = () => {
      frame = 0;
      const height = Math.min(
        560,
        Math.ceil(document.getElementById('root')!.getBoundingClientRect().height),
      );
      if (height === lastHeight) return;
      lastHeight = height;
      window.parent.postMessage(
        {
          jsonrpc: '2.0',
          method: 'ui/notifications/size-changed',
          params: { height },
        },
        '*',
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(document.getElementById('root')!);
    schedule();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
  async function openLegacy() {
    const review = current.current;
    if (!review) return;
    setState((previous) => ({ ...previous, pending: true, error: undefined }));
    try {
      const result = (await call('tools/call', {
        name: 'fuse_open_review',
        arguments: { repo: review.repository, id: review.id },
      })) as Result;
      if (result.isError) throw new Error('The legacy browser review could not be opened.');
      const text = result.content?.find((item) => item.type === 'text')?.text;
      const url = new URL(JSON.parse(text || '{}').data?.url);
      if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname))
        throw new Error('Fuse returned an unexpected review address.');
      await call('ui/open-link', { url: url.href });
      setState((previous) => ({ ...previous, pending: false }));
    } catch (error) {
      setState((previous) => ({ ...previous, pending: false, error: (error as Error).message }));
    }
  }
  if (!state.review)
    return (
      <p className="fuse-inline-loading" role={state.error ? 'alert' : 'status'}>
        {state.error || 'Loading the saved Fuse review…'}
      </p>
    );
  const intent = state.review.behavioral?.intent,
    continuation = state.continuation;
  return (
    <ReviewCard
      review={state.review}
      visualPng={state.visualPng}
      visualSvg={state.visualSvg}
      error={state.error}
      continuation={
        continuation?.reviewId === state.review.id &&
        continuation.behaviorId === intent?.behaviorId &&
        continuation.confirmedAt === intent?.confirmedAt
          ? continuation.message
          : undefined
      }
      pending={state.pending}
      readOnly={state.readOnly}
      onConfirmBehavior={(behaviorId) => void act('confirm', { behaviorId })}
      onPreview={() => void act('preview')}
      onApply={(token) => void act('apply', { token })}
      onRefresh={() => void act('refresh')}
      onOpenLegacy={() => void openLegacy()}
    />
  );
}

createRoot(document.getElementById('root')!).render(<App />);
