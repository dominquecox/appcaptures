# AppCaptures — App Store screenshot studio + marketing waitlist

> For the shared brain: copy to `~/.brain/topics/appcaptures.md` on the Mini:
> `cp docs/brain/appcaptures.md ~/.brain/topics/appcaptures.md`
> Details live in repo `SPEC.md`; this file is the pointer.

Repo: `dominquecox/appcaptures` at `/Users/ploonu/code/appcaptures`.

## Live (all on Dominque's Cloudflare account, permanent)
- `https://appcaptures.ploonu.workers.dev` (worker `appcaptures`) + apex `https://appcaptures.com` (Custom Domain, universal SSL).
- Public: `/` mono landing + waitlist, `/news/`, `/changelog/`, `/api/waitlist` (D1 `appcaptures_db` as `env.DB`).
- Local-only (excluded from deploys via `.assetsignore`): `/app/` studio, `/admin/` console.

## Branches
- `main` = release v1. `feat/studio-qa` = studio QA + presets + headers + capture tool (needs review/merge). `feat/saas-shell` = listing/export API stubs + tests (needs R2/KV/queue/AI bindings first). `feat/studio-modules` = ES-module refactor (presets/models/render/store/ui).

## Run / test / ship (no tokens needed for local + tests)
- `./tools/local.sh` — pull, serve :8347, open `/app/`. Studio needs http (modules break on `file://`).
- `node tests/studio-logic.mjs`, `node tests/api.mjs` — must both pass before merge.
- Deploy (Mini, own auth): `npx wrangler deploy --config wrangler.jsonc`.
- D1: `npx wrangler d1 execute appcaptures_db --remote --file schema.sql`; SaaS tables in `schema-saas.sql` (unapplied).

## Open (2026-10-20)
- Wipe `example.com` test rows before real users (D1 DELETE).
- iPhone Duo exact pixels → add as first-class size (Custom… button covers it today).
- Waitlist abuse: Turnstile code-ready in worker (env-gated), keys + widget pending; add dashboard rate-limit rule.
- Real-browser check never possible from sandbox — verify UI on device.

## Hard lessons
- Never echo secrets into shell (an eval leaked `CLOUDFLARE_API_TOKEN` to logs; token rolled 2026-10-19). Secrets live in keychain/env, never in chat, commands, or the brain.
- Sandbox proxy blocks apex + localhost checks and crashes headless Chrome — verify from Mini/phone.
