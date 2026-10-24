# Local checks

Run the zero-dependency suites with Node 22:

```sh
node tests/api.mjs
node tests/studio-logic.mjs
node tests/waitlist-position.mjs
node tests/waitlist-shield.mjs
node tests/inline-scripts.mjs
```

The inline-script check extracts executable inline scripts from `index.html` and passes each to `node --check` via stdin.

`waitlist-d1.mjs` runs the actual Worker in workerd with disposable local SQLite-backed D1. It creates the real schema, seeds two distinct emails with an identical timestamp, checks their positions and duplicates through Worker HTTP calls, then adds another signup and confirms the original ordinal and unique rows. It disposes its runtime in `finally`; no production credentials or remote D1 are used.

Use a Miniflare runtime that supports the configured `2026-10-19` compatibility date. The verified runtime is Miniflare `5.20261019.2-beta`, bundled with Wrangler `4.152.0`. Install test tooling outside the repository if it is not already available:

```sh
npm install --prefix /tmp/appcaptures-test-runtime --no-save miniflare@5.20261019.2-beta
MINIFLARE_MODULE=/tmp/appcaptures-test-runtime/node_modules/miniflare/dist/src/index.js node tests/waitlist-d1.mjs
```

When Miniflare is a locally resolvable dependency, simply use `node tests/waitlist-d1.mjs`. The test supports Miniflare's V4 option adapter when supplied by the runtime. No tooling is shipped in the public app.
