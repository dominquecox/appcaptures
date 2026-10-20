# AppCaptures landing + waitlist — plan

## Goal
Public face for AppCaptures while the studio stays local-only for dogfooding: a beautiful landing page in the TypePress treatment (light ice/navy/orange, home + news + changelog + admin), with a working waitlist. Branch: `feat/landing-waitlist`.

## Scope
- `/` landing (hero with CSS phone mock, email capture ×2, features, how-it-works, news/changelog previews, waitlist band, footer). Studio untouched at `/app/`.
- `/news/`, `/changelog/` render `data/news.json`, `data/changelog.json` (static files are source of truth; admin writes localStorage overrides for dogfood).
- `/admin/` super admin console behind a labeled dogfood passcode (`ploonu`): waitlist table + CSV export + row delete, news/changelog JSON editors with validation. NOT real auth — Cloudflare Access + D1 later, stated in the UI.
- Waitlist submit tries `POST /api/waitlist` first, falls back to `localStorage:appcaptures_waitlist` with `#N in line` success state. Same code works against the future D1 backend unchanged.

## Non-goals (this branch)
No public deploy of the studio (stays dogfood-local), no D1/R2/Stripe, no AI listing endpoint, no RSS, no custom domain changes. Live `appcaptures.ploonu.workers.dev` keeps serving the studio until the landing ships.

## Validation
- `node --check` on each page's extracted script; `python3 -c json.tool` on both JSON files
- `grep -c "wlTop\|wlBand" index.html` → `2` forms wired; `grep -c "appcaptures_waitlist"` across pages → landing + admin share the key
- `npx wrangler deploy --dry-run --config wrangler.jsonc` → `Read 12+ files`
- Manual: open `/` → join waitlist → success shows position → open `/admin/` (code `ploonu`) → row appears → CSV downloads → edit news → `/news/` reflects override

## Risks
- SPA fallback serves `/index.html` for unknown routes — fine, all real routes have their own `index.html`.
- `/api/waitlist` 404s until the Worker lands — handled: the catch falls back to local, and the footer says so honestly.
