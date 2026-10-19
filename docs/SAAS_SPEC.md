# AppCaptures SaaS — A-Z Spec (v0.1 dogfood → v1 launch)

Status: studio dogfoods locally (`/app/`), landing + waitlist on `feat/landing-waitlist`,
live `appcaptures.ploonu.workers.dev` serves the studio from `main`. Nothing public changes until §11.

## 1. Product
AI studio generating App Store + Play screenshots, app icons, and store listings for any
iOS / Android / RN app. Dogfood free for Ploonu apps. Launch pricing (assumption, reversible):
free 5 exports/mo, $9/mo unlimited, or $0.29 pay-per-export.

## 2. Routes (Workers Static Assets + API Worker)
| Route | Now (dogfood) | At launch |
|---|---|---|
| `/` landing + waitlist | static, localStorage fallback | same + `POST /api/waitlist` → D1 |
| `/app/` studio | static, local-only | same, login optional, exports metered |
| `/news/`, `/changelog/` | static JSON + localStorage overrides | same files, admin publishes via API |
| `/admin/` console | dogfood passcode `ploonu` (NOT auth) | Cloudflare Access + `staff` role |
| `/api/*` | 404 → client falls back local | Hono Worker + D1/R2/KV/Stripe/AI |

## 3. Data model (D1 `appcaptures_db`)
- `apps(id, slug, name, primary, bg, font, created_at)`
- `presets(app_id, headline_size, headline_weight, headline_color, headline_align, frame)`
- `exports(id, app_id, user_id, size, count, created_at)` — metering source
- `waitlist(id, email UNIQUE, platform, at, source)`
- `news_posts(slug PK, title, date, summary, body)` / `changelog_entries(version PK, date, notes)`
- `templates(id, name, season, config_json)` — sizes, headlines, frames, example assets
- R2 `appcaptures-assets` (uploads, key `u/{user}/{ts}.png`), KV `sessions`, KV `export_counters`

## 4. API contracts
- `POST /api/waitlist` `{email, platform?, source}` → `{position}` | `409` dup. Rate-limit 5/hr/IP (KV).
- `GET /api/waitlist` (staff) → `{items:[{email,at,via}]}` + `?format=csv`.
- `POST /api/listing/generate` `{app_id, screenshots[], brand, locale}` →
  iOS `{title≤30, subtitle≤30, promo≤170, description≤4000, keywords≤100}` +
  Play `{title≤50, short≤80, full≤4000}`. Prompts grounded in uploaded assets; never invent features.
- `POST /api/icons/holiday` `{app_id, icon_png, season}` → `{png_1024, png_512}` via §5 chain.
- `POST /api/exports` (metered) → increments `export_counters`, `402` when free quota spent.
- `POST /stripe/webhook` → activates sub in `subscriptions(user_id, plan, status)`.

## 5. AI (Workers AI → Gemini → BYO, via AI Gateway)
- Copy/listings: Workers AI `llama-3.3-70b` → fallback Gemini `generateContent` → fallback BYO key.
- Icons/holiday: Workers AI `stable-diffusion-xl` img2img on uploaded icon → Gemini image → BYO.
- BYO keys in Secrets Store, per-user; never in source or logs. All calls through AI Gateway (analytics + cache).

## 6. Templates format
`templates/{season}.json`: `{sizes[], frames, headline_slots[{max_chars, tone}], bg, example_asset}`.
Seed 8: launch, holiday, summer-sale, back-to-school, halloween, new-year, spring, anniversary.

## 7. Holiday / seasonal icons
`drawIcon(canvas, src, brand, season)` reuses studio palette: 1024 + 512 PNG, RGB no-alpha,
seasonal badge + border. Same canvas pipeline as `drawCard` — one code path for screenshots and icons.

## 8. Auth
Now: dogfood passcode, local only, labeled as such in UI. Launch: Cloudflare Access (staff) for
`/admin/`; public + waitlist need no login; metered users get magic-link session in KV.

## 9. Billing
Stripe metered per `exports` row + $9/mo sub (assumption). `export_counters` in KV checked on
`POST /api/exports`; free tier 5/mo; `402` + upgrade nudge. Webhook is the only writer of `subscriptions`.

## 10. Admin / news / changelog (built, dogfood)
`/admin/` (this branch): waitlist table + CSV + delete, JSON editors → localStorage overrides,
`/news/` + `/changelog/` read overrides first. Migration: editors `PUT /api/news|changelog` → D1,
pages `GET` from API with static-file fallback. No UI rewrite needed.

## 11. Rollout (custom domain answers the worker-attach question)
1. Dogfood now: studio local, landing on branch. Do NOT attach `appcaptures.com` yet — it would
   point visitors at the raw studio with no landing/waitlist.
2. Launch: merge landing, deploy, THEN attach `appcaptures.com` (+`www`) in Dashboard →
   Workers & Pages → `appcaptures` → Domains & Routes. DNS is automatic (Registrar).
3. SaaS: add Worker API + D1/R2/KV/Stripe behind flags, dogfood on staging subdomain first.

## 12. Validation per phase
- Static: `node --check` page scripts, `json.tool` data files, `wrangler deploy --dry-run`.
- Dogfood: join waitlist → `#N in line` → admin row → CSV; toggle Yaps/Vidiloop/TypePress, drag size 50→60, export 1320×2868 PNG opens pixel-exact.
- SaaS: `POST /api/listing/generate` returns within char limits; `stripe trigger` flips sub; quota `402` at 6th export.

## 13. Open questions
Pricing final ($9 vs $12, per-export $0.29 vs $0.49); model choice (Workers AI quality gate on holiday icons);
PWA icon set (192/512 + maskable — include at launch?); magic-link vs Google OAuth for metered users.
All reversible — defaults above let build start now.
