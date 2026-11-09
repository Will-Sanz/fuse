# LiquidGlass provenance

This directory uses the actual [ybouane/liquidglass](https://github.com/ybouane/liquidglass)
library requested for Fuse's embedded review card. `vendor/index.js` is the
unmodified, self-contained distribution from npm `@ybouane/liquidglass@1.0.3`.
The declarations, declaration maps, distribution source map and original package
manifest are copied from that same release. Nothing is fetched from a CDN at runtime.

- Tarball: `https://registry.npmjs.org/@ybouane/liquidglass/-/liquidglass-1.0.3.tgz`
- npm integrity: `sha512-Ro/Q3vaEduvj1yUp/TVz9AYmxY+cYhnBj76eJ/Y9VQoPlRA0DWrKPQufEzrDSYzAWXL3qxiFibi5XQVW/egTnA==`
- `index.js` SHA-256: `9630e5af0e9c27c3a88a2c4a7096a4f5e0f12e92afc6333f1552835dcc399bed`
- Bundle size before Vite processing: 103,827 bytes.
- Upstream license declaration: MIT, retained in `vendor/upstream-package.json`.
  Upstream's README also states MIT; this release does not ship a separate LICENSE
  or an author copyright notice. No author-specific copyright grant is invented here.
- The bundle incorporates html-to-image (upstream lockfile: 1.11.13). Its original
  MIT notice is retained in `vendor/HTML-TO-IMAGE-LICENSE`.

Vendoring avoids a reproducible upstream packaging failure: normal installation of
1.0.3 exits 127 because its `postinstall` invokes `patch-package`, which upstream
lists only as a development dependency. Adding a patching dependency to Fuse solely
to run that broken lifecycle hook is unnecessary; the published bundle is already
self-contained.

The wrapper uses only the iframe's own ambient background. It cannot read or
refract the parent Codex interface. Reduced-motion and unavailable WebGL use the
same accessible card with a static glass treatment. Code and check logs have solid
backgrounds. Teardown releases renderer resources; no `data-dynamic` capture loop
is used.
