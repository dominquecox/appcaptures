# Local checks

Run the zero-dependency suites with Node 22:

```sh
node tests/api.mjs
node tests/studio-logic.mjs
node tests/waitlist-position.mjs
node tests/waitlist-shield.mjs
node tests/inline-scripts.mjs
node tests/render-loop.mjs
```

The inline-script check extracts executable inline scripts from `public/index.html` and passes each to `node --check` via stdin.

`waitlist-d1.mjs` runs the actual Worker in workerd with disposable local SQLite-backed D1. It creates the real schema, seeds two distinct emails with an identical timestamp, checks their positions and duplicates through Worker HTTP calls, then adds another signup and confirms the original ordinal and unique rows. It disposes its runtime in `finally`; no production credentials or remote D1 are used.

Use a Miniflare runtime that supports the configured `2026-10-19` compatibility date. The verified runtime is Miniflare `5.20261019.2-beta`, bundled with Wrangler `4.152.0`. Install test tooling outside the repository if it is not already available:

```sh
npm install --prefix /tmp/appcaptures-test-runtime --no-save miniflare@5.20261019.2-beta
MINIFLARE_MODULE=/tmp/appcaptures-test-runtime/node_modules/miniflare/dist/src/index.js node tests/waitlist-d1.mjs
```

When Miniflare is a locally resolvable dependency, simply use `node tests/waitlist-d1.mjs`. The test supports Miniflare's V4 option adapter when supplied by the runtime. No tooling is shipped in the public app.

## Public asset release gate

Run after committing the candidate, since this test creates a clean detached checkout of HEAD (uncommitted changes are intentionally not copied):

```sh
WRANGLER_CLI=/path/to/wrangler/wrangler-dist/cli.js node tests/asset-manifest.mjs
```

The verified CLI is Wrangler 4.152.0. If `WRANGLER_CLI` is omitted the test uses `wrangler` from PATH. The test executes only `deploy --dry-run`, parses Wrangler's debug asset enumeration and ignore decisions, and fails closed if that output contract changes. It checks all 16 public asset paths against an explicit allowlist, verifies root-level development debris cannot alter it, and verifies unexpected public files and a regression to a repository-wide asset root are caught. Symlink assets are rejected. Every checkout/build is temporary and removed after the test; no deployment or remote resource writes occur. `ASSET_MANIFEST_REPORT=/absolute/path/report.json` optionally saves the manifest and mutation-test evidence.

Public marketing preview: `wrangler dev --local --config wrangler.jsonc` uses `public/`. Studio dogfood remains `tools/local.sh` and `/app/` from the repository root.

## Legal page maintenance and browser proof

`tools/legal-pages.mjs` defines the support address and effective date once and
refreshes the committed plain HTML. It is a maintenance helper, never a build or
runtime requirement. Set `EFFECTIVE_DATE` to the development merge date and rerun
`node tools/legal-pages.mjs` if merging on a different day. Review the HTML diff.

Install Playwright and `@axe-core/playwright` into a temporary directory outside
the repo, then run the local Worker preview with local-only D1 (override the
production config's `remote: true` in a temporary config). No remote writes are
needed. With Chrome installed, run:

```sh
LEGAL_TEST_MODULES=/path/to/test-tools/node_modules node e2e/legal-pages.mjs
```

The preview defaults to `http://localhost:8354`; override `LEGAL_TEST_URL` if needed.
The check renders each new page at 1440px and 390px, checks headings, landmarks
through axe, AA contrast, keyboard skip/focus, horizontal overflow, every legal
page link, every footer link, and the notices beside both signup forms.
Screenshots and the href/result list are written to `docs/legal-pages/`.
Mail links are clicked with the default action intercepted; no email is sent.
The script never submits a waitlist form. External policy links are navigated
and checked for successful responses.
