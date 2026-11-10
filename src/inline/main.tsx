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
  const call = useCallback(
    (method: string, params: object): Promise<unknown> =>
      new Promise((resolve, reject) => {
        const id = ++nextId.current;
        const timer = setTimeout(() => {
          requests.current.delete(id);
          reject(
            new Error('Codex did not respond. Reopen this Fuse review from the coding agent.'),
          );
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
        (notification && current.current.revision === review.revision))
    )
      return;
    const meta = result._meta?.fuse;
    if (meta?.reviewId === review.id && typeof meta.capability === 'string')
      privateSession.current = { id: review.id, capability: meta.capability };
    else if (privateSession.current?.id !== review.id) privateSession.current = undefined;
    current.current = review;
    setState((previous) => ({
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
      pending: false,
      readOnly: !privateSession.current,
      error:
        review.behavioral && !privateSession.current
          ? 'This host did not provide a private review session. Ask Codex to present this saved review again.'
          : undefined,
    }));
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
            pending: false,
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
    async (action: string, extra: object = {}) => {
      const review = current.current,
        session = privateSession.current;
      if (!review || session?.id !== review.id) return;
      setState((previous) => ({ ...previous, pending: true, error: undefined }));
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
        accept(result as Result);
      } catch (error) {
        privateSession.current = undefined;
        setState((previous) => ({
          ...previous,
          pending: false,
          readOnly: true,
          error: `${(error as Error).message} Ask Codex to present this saved review again.`,
        }));
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
  return (
    <ReviewCard
      review={state.review}
      visualPng={state.visualPng}
      visualSvg={state.visualSvg}
      error={state.error}
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
