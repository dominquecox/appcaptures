# Legal pages verification

Source implementation: `b8be7e9c9a45d973ae08324c58ce32456f3c1ab8`.
Later commits add verification artifacts only. No deployment or remote data writes.

## Browser proof

Real headless Google Chrome, served through local Wrangler 4.152.0 with a temporary
local-only D1 configuration. `e2e/legal-pages.mjs` produced six full-page screenshots,
zero axe WCAG A/AA violations on the new pages, no horizontal overflow, and 170
successful clicks across both widths. Keyboard skip link and visible focus checked.
`browser-results.json` lists every href, source page, width, and result. Mailto links
were clicked with navigation intercepted; no email was sent or delivery claimed.
All six screenshots were visually inspected for spacing, wrapping, and footer layout.

| Page | Desktop 1440px | Phone 390px |
| --- | --- | --- |
| Terms | [Screenshot](terms-1440.png) | [Screenshot](terms-390.png) |
| Privacy | [Screenshot](privacy-1440.png) | [Screenshot](privacy-390.png) |
| Support | [Screenshot](support-1440.png) | [Screenshot](support-390.png) |

## Baseline and spec score

| Requirement | Local implementation | Evidence |
| --- | --- | --- |
| L1 Terms | Done | Real HTML, one h1, body address, Indiana law, six footers, both waitlist notices |
| L2 Privacy | Done | Waitlist fields, local copy, Cloudflare, Google Fonts, retention, removal, rights, children, security, international transfers, contact |
| L3 Support | Done | FAQs, support email, privacy requests, linked removal steps |
| L5 Public deletion path | Done | `/support#remove-email`, no account required; Privacy, six footers, both waitlist notices link here |
| Spec §6 | Done | Three static pages, privacy covers existing waitlist, manual removal path |

Scope score: 4/4 applicable baseline items implemented and browser verified locally.
Production availability is pending review, merge, email routing, and a later release.
App Settings and App Store Connect requirements are N/A for this public waitlist.
No claim of live compliance or full manual accessibility certification is made.

## Accurate-practices review

Checked `public/index.html`, `worker.js`, `schema.sql`, `wrangler.jsonc`, and `public/sw.js`.
No analytics, ads, or tracking-cookie code is loaded. Google Fonts is present and
is disclosed. The local fallback can save an email even after a failed server
signup; the policy and support FAQ explain that distinction. There is no automatic
waitlist expiry or removal endpoint. No email delivery provider is named.

Provider references checked against official pages:

- [Cloudflare Turnstile privacy](https://www.cloudflare.com/turnstile-privacy-policy/)
- [Google Fonts privacy](https://fonts.googleblog.com/2022/11/your-privacy-and-google-fonts.html)

## Owner prerequisites and open questions

- Dom adds Cloudflare Email Routing for `support@appcaptures.com` before production.
- Effective date is October 24, 2026, the intended development merge date. If review
  lands later, update the one `EFFECTIVE_DATE` constant in `tools/legal-pages.mjs`,
  rerun the helper, and refresh screenshots before merging.
- The exact operational-log retention configuration is not specified in the repo;
  the policy does not invent a number. Dom can confirm it separately.
- Removal is manual. No inbox delivery, actual removal, or production signup was
  exercised, because this task stops at a ready PR and forbids Cloudflare changes.
