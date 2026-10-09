import { useState } from 'react';
import { Copy01, XClose } from '@untitledui/icons';
import { Button } from '../untitledui/components/base/buttons/button';
import { Modal, ModalOverlay, Dialog } from '../untitledui/components/application/modals/modal';
import { shellQuote } from '../../shared/shell';
import type { Review } from '../../shared/review';

export type Connection = { mode: string; node: string; cli: string; codexTest: string };

export function CodexConnection({
  open,
  onClose,
  connection,
  review,
}: {
  open: boolean;
  onClose: () => void;
  connection?: Connection;
  review?: Review;
}) {
  const [copied, setCopied] = useState('');
  const [error, setError] = useState('');
  const sessions = !!(review?.sources.a.ref.sessionId && review?.sources.b.ref.sessionId);
  const test =
    connection?.node && connection.codexTest
      ? [
          shellQuote(connection.node),
          shellQuote(connection.codexTest),
          ...(review ? ['--repo', shellQuote(review.repository)] : []),
          ...(sessions ? ['--sessions'] : []),
        ].join(' ')
      : '';
  const connect =
    connection?.node && connection.cli && review
      ? `codex mcp add fuse -- ${shellQuote(connection.node)} ${shellQuote(connection.cli)} mcp --repo ${shellQuote(review.repository)}`
      : '';
  const prompt = `Use Fuse to inspect ${sessions ? 'both registered sessions' : 'my working changes'}, then read the saved review. Explain the changed code and ask me about any ambiguous behavior. Do not apply changes.`;
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      setError('');
    } catch {
      setError('Select and copy the command below. Clipboard access is unavailable.');
    }
  }
  return (
    <ModalOverlay isOpen={open} onOpenChange={(value) => !value && onClose()} isDismissable>
      <Modal className="codex-modal">
        <Dialog aria-label="Use Fuse with Codex" className="dialog-card codex-dialog">
          <div className="dialog-heading">
            <div>
              <h2>Use Fuse with Codex</h2>
              <p>Inspect the same code from your coding session.</p>
            </div>
            <Button
              color="tertiary"
              aria-label="Close Codex setup"
              iconLeading={XClose}
              onClick={onClose}
            />
          </div>
          <video
            className="codex-recording"
            controls
            poster="/codex/poster.png"
            preload="metadata"
            aria-label="Recorded Codex MCP session"
          >
            <source src="/codex/session.webm" type="video/webm" />
            <track kind="captions" src="/codex/session.vtt" srcLang="en" label="English" default />
            <a href="/codex/session.webm">Download the recording</a>
          </video>
          <p className="recording-caption">
            Recorded from actual Codex MCP calls. Terminal output is reformatted; pauses are
            shortened.{' '}
            <a href="/codex/session.json" target="_blank" rel="noreferrer">
              View the captured events
            </a>
            .
          </p>
          <section className="connection-step">
            <h3>1. Run the connection test</h3>
            <p>
              Run this in Terminal with Node 24 and a signed-in Codex CLI. It inspects{' '}
              {review ? 'this repository' : 'a separate checkout repository'}, saves a review, and
              prints a command to open it. Code stays unchanged.
            </p>
            <div className="copy-command">
              <pre aria-label="Codex connection test command">{test || 'Loading command…'}</pre>
              <Button
                size="sm"
                color="secondary"
                iconLeading={Copy01}
                isDisabled={!test}
                onClick={() => void copy(test)}
              >
                {test && copied === test ? 'Copied' : 'Copy test command'}
              </Button>
            </div>
            <p className="connection-note">
              Uses your existing Codex account and usage allowance. Approval is limited to Fuse’s
              inspect and review tools for this run.
            </p>
          </section>
          {connect && (
            <section className="connection-step">
              <h3>2. Connect your coding session</h3>
              <p>Add this repository to Codex, then start a new Codex session.</p>
              <div className="copy-command">
                <pre aria-label="Codex MCP setup command">{connect}</pre>
                <Button
                  size="sm"
                  color="secondary"
                  iconLeading={Copy01}
                  onClick={() => void copy(connect)}
                >
                  {copied === connect ? 'Copied' : 'Copy setup command'}
                </Button>
              </div>
              <div className="copy-command">
                <p className="codex-prompt">{prompt}</p>
                <Button
                  size="sm"
                  color="secondary"
                  iconLeading={Copy01}
                  onClick={() => void copy(prompt)}
                >
                  {copied === prompt ? 'Copied' : 'Copy prompt'}
                </Button>
              </div>
            </section>
          )}
          {error && <p role="alert">{error}</p>}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
