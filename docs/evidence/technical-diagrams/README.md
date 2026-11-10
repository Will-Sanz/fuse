# Technical diagram evidence — November 10, 2026

`ai-shipping.png`, `ai-validation.png` and `ai-compatible.png` are real Fuse AI
outputs rendered by the version 2 renderer from authored disposable examples.
They are diagrams, not native Codex screenshots. The shipping image explicitly
shows the proposed function/input correction; compatibility is shown without an
invented defect. Provider response references and retained failures are in
`results.json`.

The first larger-font prompt failed layout validation for all three examples,
including its existing single repair attempt. Those failures are retained. A
roomy four-node layout with concise code/value annotations then passed each
example on its first response. A final shipping check with the code-correction
instruction also passed on its first response. These few examples do not measure
general generation reliability, and invalid layouts still fail visibly.

`simulated-host-card.png` shows the actual MCP PNG in an explicitly simulated
browser host. It checks that the larger image and both behavior buttons fit in
the existing 560 px host without opening details. It is not native acceptance.
Unit checks additionally rasterize long identifiers and all four arrow directions.

The running native MCP needs reloading to use the new server renderer and prompt.
No live process was patched or restarted during other chats. The earlier native
approval flow passed, but native acceptance of this new rendering remains open
in [issue #17](https://github.com/Will-Sanz/fuse/issues/17).
