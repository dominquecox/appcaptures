# Agent Monetization Plan — Cloudflare Monetization Gateway (dormant until approved)

Status: PLAN ONLY. No code changes. Activates after Cloudflare approves the
Monetization Gateway beta for this account. Human billing stays on Stripe.

## 1. What it is
Cloudflare's Monetization Gateway (closed beta, eligible US sellers) lets any
resource behind Cloudflare charge AI agents per request via HTTP `402` + the
x402 protocol, settled in USDC on Base. Sellers price access; agents pay from
funded wallets; Cloudflare enforces at the edge before the worker runs.

Sources: [announcement](https://blog.cloudflare.com/monetization-gateway/),
[beta details](https://www.searchenginejournal.com/cloudflare-moves-monetization-gateway-pay-per-use-into-beta/591719/).

## 2. Why dormant
Today there is nothing billable. `POST /api/listing/generate` and
`POST /api/exports` return `501` without AI/queue bindings (`worker.js`).
Pricing stubs would burn trust. Ship the waitlist first, implement real
generation + metering, then enable Gateway pricing.

## 3. Priced resources (proposed)
| Agent tool | Route | Price shape (assumption, reversible) |
|---|---|---|
| `generate_app_capture` | `POST /api/listing/generate` | per request |
| `render_device_mockup` | `POST /api/exports` | per render |
| `resize_for_app_store` | `POST /api/exports` (size param) | per size |
| `audit_screenshot_requirements` | `GET /api/specs/check` (new) | per audit |
| dataset: templates | `GET /api/templates/*` (new) | per fetch |
| MCP tools | `/mcp/*` (new, stdio→HTTP bridge) | per tool call |

Public marketing pages (`/`, `/news/`, `/changelog/`) stay FREE. Never gate
them — they are discovery, not product.

## 4. Activation checklist (owner runs after approval)
1. Dashboard → Monetization Gateway → enable for `appcaptures.com`.
2. Uncomment SaaS bindings in `wrangler.jsonc` (R2, KV, queue, AI) once created.
3. Implement real `listing/generate` + `exports` (see `docs/SAAS_SPEC.md` §4–5).
4. Add metered `402` path: free quota check → Gateway price quote → settle →
   fulfill. Keep Stripe webhook as the human path (`402` only when quota spent
   is the existing convention — extend it to agents, don't replace it).
5. Add `/mcp/*` bridge exposing the 4 tools above with per-call pricing.
6. Test with an agent wallet (Cloudflare Wallets buyer-side) before publishing prices.
7. Publish prices on landing + changelog. One-line per tool, no surprises.

## 5. Guards
- Secrets (Gateway keys, AI keys, Stripe) in dashboard secret store only.
- Fails closed: unverified payment = `402`, never free fulfillment.
- Rate-limit `POST /api/*` per IP even for paid calls (abuse shield).
- Keep `.assetsignore` as-is: `/app/` + `/admin/` never serve publicly, so
  agent pricing applies to API/MCP routes only.
- Log price + settlement id per request for disputes; no emails in logs.

## 6. Open questions
- Beta eligibility + payout timing for this account (check dashboard).
- x402 facilitator fees vs Stripe fees at low volume.
- Whether agent volume justifies per-request pricing before v1 launch.
