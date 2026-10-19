# Ploonu App Screenshots Studio — SaaS Plan

## Goal
Turn the current static `vidiloopios/tools/screenshots` (35K agnostic studio — Vidiloop #7c5cff/#0b0914, Yaps #ff6b00/#0d0b14, TypePress #0ea5e9, per-app headline size/weight/color/align, iOS 1320×2868…2064×2752 + Android 1080×1920…1440×3120, PNG RGB no-alpha) into a dogfood → SaaS you can sell vs AppMagic: iOS + Android + RN PWA screenshots **and** holiday/seasonal app icons, with Muse/Gemini/BYO AI brief enhancements on uploaded assets (not a logo maker), templates, plus normal Ploonu stack (landing, super admin, news/changelog). Branch is `feat/screenshots-saas` for viewing before 68%/84% limits hit at 14:59/20:00.

## Success Criteria
- Branch `feat/screenshots-saas` exists with this file and `tools/screenshots/SPEC.md` — you can open it in GitHub/dashboard
- Permanent deploy LIVE on your account: `https://ploonu-screenshots.ploonu.workers.dev` (Version 5cb27555-c43d-41a4-8017-a7296c5757ee, verified `200` + Headline/Yaps present) — Dashboard → Workers & Pages → `ploonu-screenshots`
- Headline styling agnostic per-app persists in `localStorage: ploonu_screenshots_v3` per `appId`
- AI App Store listing helper planned (iOS App Store Connect + Google Play Console) — generates title/subtitle/keywords/description per locale from screenshots + brand

## Approach
Reuse canvas pipeline (`drawCard` with `headlineSize/1320`, `headlineWeight`, `headlineColor`, `headlineAlign`, `rgba(primary,.32)` border) — already store-pixel exact. For SaaS, wrap with smallest Cloudflare-native stack you already use: **Workers Static Assets front-end + Workers API + D1 + R2 + KV + Stripe + Workers AI / AI Gateway (BYO fallback)**. Keep i7 100.111.148.97 Postgres via tailscale0 for local dogfood, then Hyperdrive/D1 for prod — matches `ploonus-home-mesh/README.md` `ARCHITECTURE.md`.

## Steps
1. **Branch + plan file (this commit)** — `git checkout -b feat/screenshots-saas`, write `docs/plans/2026-10-18-screenshots-saas.md` and `tools/screenshots/SPEC.md`, push to origin. No code change beyond docs. *Depends on nothing.*
2. **Permanent deploy** — `npx wrangler login` (refresh oauth_token cfoat_… expires 2026-10-18T07:48:50.359Z), `npx wrangler deploy --config tools/screenshots/wrangler.jsonc` → `ploonu-screenshots.<account>.workers.dev`. Claim or set `workers_dev=false` for dashboard-only. *Depends on 1.*
3. **Dogfood hardening (no SaaS yet)** — keep `ploonu_screenshots_v3` per-app map, add `yaps.club` assets crawl + TypePress fixtures, add `1024×1024` icon export path reusing `drawCard` → `drawIcon` (same `primary`/`bg`/`font`). Add Sentinel note with live link for viewing on Deck. *Depends on 2.*
4. **AI App Store listing helper** — Workers API `POST /api/listing/generate` (Hono): takes `appId`, `screenshots[]`, `brand`, `locale`, calls Workers AI `llama-3.3` or Gemini `generateContent` or BYO key passthrough, returns `App Store`: title 30 chars, subtitle 30, promo 170, description 4000, keywords 100, plus `Google Play`: title 50, short desc 80, full desc 4000, keywords. Uses existing screenshots + brand to ground prompts, not hallucinate. *Depends on 3.*
5. **SaaS shell (behind flag)** — Workers API `apps/api` (Hono): `D1 ploonu_screenshots` (apps, presets, exports), `R2 ploonu-screenshots-assets` (uploads), `KV sessions`, `Stripe` webhook `POST /stripe/webhook`, `AI Gateway` → Workers AI `stable-diffusion` / Gemini `generateImage` / BYO key for holiday icon + headline polish. `appStates` moves from `localStorage` to `D1` when logged in. *Depends on 4.*
6. **Ploonu stack** — landing `vidiloop.com` style (`#0b0914`) + super admin `staff` role + `news/rss.xml` `changelog/rss.xml` (already on vidiloop.com) — reuse `typepress` super admin patterns. *Depends on 5.*
7. **Templates + paywall** — seed 8 holiday/seasonal templates, gate at export: `KV` counter → `Stripe metered`. *Depends on 5.*

## Validation Plan
- Branch exists: `git branch -a | grep screenshots-saas` + file `cat docs/plans/2026-10-18-screenshots-saas.md | grep "Goal"`
- Permanent deploy: `curl -s https://ploonu-screenshots.<account>.workers.dev/ | grep -c "Headline — per app"` → `1`, `npx wrangler deploy --dry-run --config tools/screenshots/wrangler.jsonc` → `Read 8 files`
- Dogfood: open live → toggle `Yaps/Vidiloop/TypePress` → `yaps.club` orange `#ff6b00` persists per app, drag Headline Size `50→60` → `canvas.width` stays `1320`, `toDataURL('image/png')` starts `data:image/png`
- AI listing: `curl -X POST /api/listing/generate -d '{"appId":"yaps","locale":"en-US"}' | jq .title` length 30, `description` 4000
- SaaS shell: `wrangler d1 execute DB --command "select count(*) from apps"` + `Stripe CLI` `stripe trigger checkout.session.completed` → export count increments
- Sentinel note: visible at `https://100.111.148.97:8443` (tailnet) or fallback `ploonus-home-mesh/sentinel-notes.md`

## Risks / Open Questions
- **Auth EPERM** — `~/.wrangler/config/default.toml` `com.apple.provenance` + proxy `http://127.0.0.1:57917` blocked `whoami` refresh → use `npx wrangler login` interactive; keep `HOME=/tmp/fakehome --temporary` only for previews — *mitigated*.
- **Chrome headless TargetClosedError** (`Google Chrome 155.0.8059.80` `pid 3134` SIGABRT, headless_shell SEGV `pid 12174`) → skip headless in CI, use `curl` + `drawCard` unit for store-pixel check — *mitigated*.
- **Holiday icon AI** — you weren't sure Muse can generate images → **Workers AI** `stable-diffusion-xl` + Gemini fallback + BYO key covers it; BYO lets users bring their own model — no blocker.
- **Sentinel Deck tailnet only** — sandbox cannot reach `100.111.148.97:8443` (`Operation not permitted` even with `--noproxy "*"`), so note is added locally and via `ploonus-home-mesh/sentinel-notes.md` for viewing on tailnet — *mitigated with fallback file*.

## Sources
- https://vidiloop.com/ — `theme-color #131314`, `#0b0914` bg, `Hanken Grotesk / Inter`
- https://yaps.club/ — `--color-primary:#ff6b00`, `--color-background:#0e1117`, `#0d0b14` boot, `Inter`
- https://developers.cloudflare.com/workers/static-assets/ — Workers recommended for new sites
- https://developers.cloudflare.com/workers/wrangler/commands/ — `deploy --dry-run`, `whoami`, `login`, claim preview

Reply `go` to execute this plan, or tell me what to change.
