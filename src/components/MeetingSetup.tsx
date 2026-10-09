import { useState } from 'react';
import { Copy01, XClose } from '@untitledui/icons';
import { Button } from '../untitledui/components/base/buttons/button';
import { Modal, ModalOverlay, Dialog } from '../untitledui/components/application/modals/modal';
import { shellQuote } from '../../shared/shell';
import type { Review } from '../../shared/review';
import { isShowcase } from '../api';
export type Connection = {
  mode: string;
  node: string;
  cli: string;
  meetingScript: string;
  aiConfigured: boolean;
  model: string;
};
export function MeetingSetup({
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
  const [copied, setCopied] = useState(''),
    [error, setError] = useState('');
  const command = isShowcase
    ? 'npm run meeting'
    : connection
      ? `${shellQuote(connection.node)} ${shellQuote(connection.meetingScript)}`
      : '';
  const config =
    (connection && review) || isShowcase
      ? JSON.stringify(
          {
            mcpServers: {
              fuse: {
                command: isShowcase ? 'node' : connection!.node,
                args: [
                  isShowcase ? '/absolute/path/to/fuse/cli/run.mjs' : connection!.cli,
                  'mcp',
                  '--repo',
                  isShowcase ? '/absolute/path/to/your/project' : review!.repository,
                ],
              },
            },
          },
          null,
          2,
        )
      : '';
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
    } catch {
      setError('Select and copy the text below. Clipboard access is unavailable.');
    }
  }
  return (
    <ModalOverlay isOpen={open} onOpenChange={(value) => !value && onClose()} isDismissable>
      <Modal className="meeting-modal">
        <Dialog className="dialog-card" aria-label="Run Fuse with MCP">
          <div className="dialog-heading">
            <div>
              <h2>Show Fuse working live</h2>
              <p>A real merge conflict. A new AI visual. Your choice becomes code.</p>
            </div>
            <Button
              color="tertiary"
              iconLeading={XClose}
              aria-label="Close MCP setup"
              onClick={onClose}
            />
          </div>
          <p className={`setup-status ${connection?.aiConfigured || isShowcase ? '' : 'missing'}`}>
            {isShowcase
              ? 'The website uses prepared examples. Run the MCP locally for fresh AI visuals and real Git changes.'
              : connection?.aiConfigured
                ? `API key configured · ${connection.model}`
                : 'Add OPENAI_API_KEY to Fuse’s .env file, then restart the server.'}
          </p>
          <section className="setup-section">
            <h3>1. Run the meeting walkthrough</h3>
            {isShowcase && (
              <>
                <p>Install Fuse once with Node 24 and Git:</p>
                <pre>
                  git clone https://github.com/Will-Sanz/fuse.git{'\n'}cd fuse{'\n'}npm ci{'\n'}npm
                  run build{'\n'}cp .env.example .env
                </pre>
                <p>
                  Open <code>.env</code> in your editor and set <code>OPENAI_API_KEY</code>. The
                  default model is <code>gpt-6-luna</code>. Keep the key on your computer.
                </p>
              </>
            )}
            <p>
              Paste this into Terminal. It creates a disposable repository with a real Git conflict,
              calls fuse_explain through MCP, asks Luna to design a new image, and opens the review.
              Requires Node 24 and your OpenAI API key.
            </p>
            <pre aria-label="Meeting command">{command || 'Loading command…'}</pre>
            <Button
              size="sm"
              color="secondary"
              iconLeading={Copy01}
              isDisabled={!command}
              onClick={() => void copy(command)}
            >
              {copied === command && command ? 'Copied' : 'Copy meeting command'}
            </Button>
          </section>
          <section className="setup-section">
            <h3>From a real MCP run</h3>
            <p>
              Luna designed this image from a Git merge conflict in checkout validation. The MCP
              returned it as a PNG; the chosen resolution was applied and its checks passed.
            </p>
            <img
              className="recorded-visual"
              src="/mcp/checkout.png"
              alt="AI-generated checkout visual captured from a real fuse_explain MCP call"
              loading="lazy"
            />
            <p>
              <a
                href="https://github.com/Will-Sanz/fuse/blob/main/docs/meeting.md"
                target="_blank"
                rel="noreferrer"
              >
                Read the meeting walkthrough
              </a>
            </p>
          </section>
          <section className="setup-section">
            <h3>2. Explain, choose, create</h3>
            <p>
              Show the highlighted conflict, explain the generated visual, select the desired
              behavior, then click Create this change. Fuse writes and stages the resolution and
              runs the repository’s checks.
            </p>
            <p>
              Use <code>--scenario shipping</code> for a second conflict with a different visual.
              Each run starts a fresh repository and a fresh model request.
            </p>
          </section>
          <section className="setup-section">
            <h3>Use your own MCP client</h3>
            <p>
              Add this configuration to Codex, Claude Code, Cursor, or another stdio MCP client. Set
              the repository path to your project. The server uses the OpenAI API directly.
            </p>
            <details>
              <summary>Show MCP configuration</summary>
              <pre aria-label="MCP configuration">{config}</pre>
              <Button
                size="sm"
                color="secondary"
                iconLeading={Copy01}
                onClick={() => void copy(config)}
              >
                Copy MCP configuration
              </Button>
            </details>
            <pre>
              Use Fuse to explain my current change or merge conflict. Show the generated image and
              ask which behavior I want.
            </pre>
          </section>
          {error && <p role="alert">{error}</p>}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
