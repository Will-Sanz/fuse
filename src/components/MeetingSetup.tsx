import { useState } from 'react';
import { Copy01, XClose } from '@untitledui/icons';
import { Button } from '../untitledui/components/base/buttons/button';
import { Modal, ModalOverlay, Dialog } from '../untitledui/components/application/modals/modal';
import type { Review } from '../../shared/review';
export type Connection = {
  mode: string;
  node: string;
  cli: string;
  meetingScript: string;
  aiConfigured: boolean;
  model: string;
};
const config = JSON.stringify(
  {
    mcpServers: {
      fuse: {
        command: 'npx',
        args: ['--yes', '--prefer-online', 'github:Will-Sanz/fuse#main', 'mcp'],
        env: { FUSE_SERVICE_TOKEN: '<included in your private team connection>' },
      },
    },
  },
  null,
  2,
);
const prompt =
  'Use Fuse to explain the change in this repository. Show the generated image, ask which behavior I want, and open the visual review.';
export function MeetingSetup({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
  connection?: Connection;
  review?: Review;
}) {
  const [copied, setCopied] = useState(''),
    [error, setError] = useState('');
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
              <h2>Connect Fuse</h2>
              <p>Add it once. Use it in any local repository.</p>
            </div>
            <Button
              color="tertiary"
              iconLeading={XClose}
              aria-label="Close MCP setup"
              onClick={onClose}
            />
          </div>
          <section className="setup-section">
            <h3>1. Add your team connection</h3>
            <p>
              Paste the private Fuse configuration from your project owner into your coding
              assistant’s MCP settings. It includes access to the shared AI service. No API key or
              environment file is needed.
            </p>
            <p>
              Node 24 and Git must be installed. Fuse downloads automatically on the first
              connection and checks GitHub for updates when the MCP restarts.
            </p>
            <details>
              <summary>Show MCP configuration</summary>
              <pre aria-label="MCP configuration">{config}</pre>
              <p>
                The team access value comes with your private connection. Keep that configuration
                within your team.
              </p>
              <a
                href="https://github.com/Will-Sanz/fuse/blob/main/docs/integration.md"
                target="_blank"
                rel="noreferrer"
              >
                Connection details and source code
              </a>
            </details>
          </section>
          <section className="setup-section">
            <h3>2. Open your project and ask Fuse</h3>
            <p>
              Use a repository with a TypeScript change or an active merge conflict. Your assistant
              passes its local path to Fuse.
            </p>
            <pre aria-label="MCP prompt">{prompt}</pre>
            <Button
              size="sm"
              color="secondary"
              iconLeading={Copy01}
              onClick={() => void copy(prompt)}
            >
              {copied === prompt ? 'Copied' : 'Copy prompt'}
            </Button>
            <p>
              Fuse reads the change and relevant code, then sends that context to the hosted AI
              service to design a custom image. Open the returned review link, choose the behavior,
              and click Create this change.
            </p>
          </section>
          <section className="setup-section">
            <h3>From a real MCP run</h3>
            <p>
              Luna designed this image from a Git merge conflict in checkout validation. The MCP
              returned the PNG; the selected resolution was applied and its checks passed.
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
                Run the meeting walkthrough
              </a>
            </p>
          </section>
          {error && <p role="alert">{error}</p>}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
