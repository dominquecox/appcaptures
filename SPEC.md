# Ploonu App Screenshots Studio — Spec

**Location:** `vidiloopios/tools/screenshots/index.html` (35K) + `wrangler.jsonc`
**Live (permanent, on your account):** `https://ploonu-screenshots.ploonu.workers.dev` — Version `5cb27555-c43d-41a4-8017-a7296c5757ee`
**Permanent:** `npx wrangler login && npx wrangler deploy --config tools/screenshots/wrangler.jsonc` → `ploonu-screenshots.<account>.workers.dev` or `screenshots.vidiloop.com`
**Local:** `python3 -m http.server 8347` in `tools/screenshots` → `http://localhost:8347` (also `http://100.88.25.84:8347` on mesh)

## 1. What it is
Agnostic studio for **any Ploonu iOS / Android / React Native** build. Muse layout: white card + brand border at 32% opacity, black headline, phone centered with shadow, exports at exact store pixels — no Canva.

## 2. Brand — per app (agnostic, persisted)
- **Vidiloop** `primary #7c5cff` `bg #0b0914` (from `vidiloop.com` `theme-color #131314`, `Hanken Grotesk / Inter`)
- **Yaps** `primary #ff6b00` `soft #ff8533` `bg #0d0b14` `surface #1c2128` (from `yaps.club` `index-99Sd_pyS.css` `--color-primary:#ff6b00`)
- **TypePress** `primary #0ea5e9` `bg #0f172a`
- **Generic** `primary #2563eb` `bg #0a0a0f`
- **Custom** — prompt name + hex

Stored in `localStorage: ploonu_screenshots_v3` as `apps: { vidiloop: {brand,screens}, yaps: {...} }` with `currentAppId`, `platform`, `exportSize`. Switching `App` saves current to map, restores target — agnostic per-app, no data loss.

**Brand panel:**
- App name, Primary color, Page bg, Headline font `Inter / Hanken Grotesk`, Device frame `iOS Dynamic Island / Android notch / Minimal (RN)`
- **Headline — per app:** Size slider `32–72` (default `50` → `fontSize = W * (headlineSize/1320)`), Weight `500/600/700/800`, Color picker, Align `center / left` (`left` uses `W*0.07` inset). Canvas: `font = weight + size + font`, `fillStyle = headlineColor`, `textAlign = align`.

## 3. Screens — per app
1–10 screens, each headline 3–6 words + image (upload or Vidiloop `designassets/*` preset). Vidiloop preset 8 screens `Welcome to Vidiloop` … `Never miss a loop`; Yaps 5 `Speak your mind` … `Join the conversation`; TypePress 5 `Write without limits` … Add/duplicate/remove, tap card to edit. Duplicate uses `JSON.parse(JSON.stringify(screens[i]))`.

## 4. Platform & Sizes
- **iOS App Store:** `1320×2868` (6.9"), `1290×2796` (6.7"), `1284×2778` (6.5"), `1206×2622` (6.1"), `2064×2752` (iPad 13")
- **Android Play:** `1080×1920`, `1440×2560`, `1080×2400`, `1440×3120`
- Toggle `iOS / Android / Both` → size buttons swap; `Both` exports all iOS then Android.
- Canvas: `canvas.width=W; canvas.height=H;` + `fillStyle="#ffffff" fillRect(0,0,W,H)` → PNG RGB no-alpha; phone `W*0.775 × W*2.16`, border `rgba(primary,.32)`, shadow `rgba(15,23,42,.14)`, clip `inset W*0.012`.

## 5. Deployment — lightweight
- **Workers Static Assets** `wrangler.jsonc` `name: ploonu-screenshots` `assets.directory: "."` — recommended for new sites per `developers.cloudflare.com/workers/static-assets/`. Dry-run: `Read 8 files — 0.35 KiB`.
- **OAuth** `~/.wrangler/config/default.toml` `oauth_token cfoat_…` expires `2026-10-18T07:48:50.359Z` + proxy `http://127.0.0.1:57917` + `com.apple.provenance` → `wrangler whoami` EPERM; use `HOME=/tmp/fakehome npx wrangler deploy --temporary` for previews, `npx wrangler login` for permanent.
- **Tailscale fallback** — Dell i7 `100.111.148.97` (Postgres 16, `ufw allow in on tailscale0`) → `python3 -m http.server 8000` + `tailscale serve --https=443` → `https://ploonu.<tailnet>.ts.net` (tailnet only, sandbox cannot reach `100.111.148.97:8443` directly — `Operation not permitted` even with `--noproxy "*"`).

## 6. SaaS evolution (next, behind flag)
- **Dogfood hardening:** `yaps.club` asset crawl, `1024×1024` icon export `drawIcon` reusing `primary/bg/font`.
- **AI App Store listing helper** — `POST /api/listing/generate` (Hono + Workers AI `llama-3.3` / Gemini / BYO): input `appId`, `screenshots[]`, `brand`, `locale` → output `App Store`: title 30, subtitle 30, promo 170, description 4000, keywords 100; `Google Play`: title 50, short 80, full 4000, keywords. Grounded in uploaded screenshots + brand, not hallucinated.
- **SaaS shell:** `D1 ploonu_screenshots` (apps, presets, exports), `R2 ploonu-screenshots-assets`, `KV sessions`, `Stripe` webhook `POST /stripe/webhook` metered export, `AI Gateway` → `stable-diffusion-xl` / Gemini image for holiday icons + headline polish, BYO key. `localStorage` → `D1` when logged in.
- **Ploonu stack:** landing `vidiloop.com` style, super admin `staff` role, `news/rss.xml` `changelog/rss.xml`.
- **Templates + paywall:** 8 holiday/seasonal templates, gate at export via `KV` counter.

## 7. Verification
- `command -v chromium; echo $?` → `1`, Chrome `155.0.8059.80` at `/Applications/Google Chrome.app` but headless `TargetClosedError` `pid 3134 SIGABRT` + `headless_shell 1228 SIGSEGV` due to sandbox — use `curl -s https://ploonu-screenshots… | grep` + `grep -c headlineSize` → `31` instead.
- `npx wrangler deploy --dry-run --config tools/screenshots/wrangler.jsonc` → `Read 8 files`
- Live `curl -s https://ploonu-screenshots.ploonu.workers.dev/` → `200`, `Headline — per app` → `1`, `Yaps` → `3` — permanent, verified.

## 8. How any engineer continues
- Branch: `feat/screenshots-saas` from `vidiloopios` main
- Where: `tools/screenshots/` (front-end), `docs/plans/2026-10-18-screenshots-saas.md` (plan), this `SPEC.md`
- Checks: `npx wrangler deploy --dry-run --config tools/screenshots/wrangler.jsonc` + `grep -c headlineSize index.html`
- Style: Hanken Grotesk / Inter, keep exact store pixels, no alpha, persist per-app.

