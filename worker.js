// AppCaptures API Worker — zero dependencies. Serves /api/*; everything else falls
// through to static assets. Without a [[d1_databases]] binding (env.DB), all API
// routes answer 503 and the client keeps its localStorage fallback (see index.html).
// Mini-side setup: wrangler d1 create appcaptures_db -> paste block into wrangler.jsonc
// -> wrangler d1 execute appcaptures_db --file schema.sql -> deploy.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

// Bounded JSON body: Content-Length fast-path, then a capped stream read so a
// lying header can't buffer unbounded data into Worker memory. Rejects
// non-object JSON (null, arrays, primitives) so downstream property access
// can't throw an unhandled 500. 64KB covers real payloads (~100B waitlist,
// small export/listing forms); raise per-route if screenshots go inline.
const MAX_BODY_BYTES = 64 * 1024;

async function readJson(req, maxBytes = MAX_BODY_BYTES) {
  const len = Number(req.headers.get("content-length"));
  if (Number.isFinite(len) && len > maxBytes) {
    const e = new Error("too large"); e.status = 413; throw e;
  }
  const decoder = new TextDecoder();
  let text = "";
  if (req.body) {
    const reader = req.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        if (text.length > maxBytes) {
          await reader.cancel();
          const e = new Error("too large"); e.status = 413; throw e;
        }
      }
    } finally { reader.releaseLock(); }
  }
  text += decoder.decode();
  const parsed = JSON.parse(text); // throws SyntaxError on empty/malformed JSON
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    const e = new Error("bad json"); e.status = 400; throw e;
  }
  return parsed;
}

function bodyError(e) {
  const status = (e && e.status) || 400;
  return json({ error: status === 413 ? "body too large" : "bad json" }, status);
}

// Staff gate: open while ADMIN_TOKEN is unset (dogfood, same convention as
// Turnstile). When set, GET /api/waitlist requires the bearer token, compared
// via SHA-256 digest so raw secrets never meet ===. Launch replaces this with
// Cloudflare Access; the token path stays for scripts.
async function adminOk(req, env) {
  if (!env.ADMIN_TOKEN) return true;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(String(req.headers.get("authorization") || ""))),
    crypto.subtle.digest("SHA-256", enc.encode(`Bearer ${env.ADMIN_TOKEN}`)),
  ]);
  const xa = new Uint8Array(a), xb = new Uint8Array(b);
  if (xa.length !== xb.length) return false;
  let d = 0;
  for (let i = 0; i < xa.length; i++) d |= xa[i] ^ xb[i];
  return d === 0;
}

// Optional bot shield: when env.TURNSTILE_SECRET is set, POST /api/waitlist
// requires a valid Turnstile token and fails closed. Unset = current open
// behavior (dogfood). Keys stay in the dashboard/secret store, never here.
// Widget + action/hostname pinning land with the frontend sitekey.
async function verifyTurnstile(secret, token, ip){
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret, response: token, remoteip: ip || "" }),
  });
  if(!r.ok) throw new Error("siteverify " + r.status);
  return r.json();
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/api/waitlist" && req.method === "POST") {
      if (!env.DB) return json({ ok: false, fallback: true }, 503);
      let body;
      try { body = await readJson(req); } catch (e) { return bodyError(e); }
      const email = String(body.email || "").trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return json({ error: "bad email" }, 400);
      if (env.TURNSTILE_SECRET) {
        const token = String(body.turnstile || "");
        if (!token || token.length > 2048) return json({ error: "forbidden" }, 403);
        let v;
        try { v = await verifyTurnstile(env.TURNSTILE_SECRET, token, req.headers.get("CF-Connecting-IP")); }
        catch (e) { return json({ error: "forbidden" }, 403); }
        if (!v || v.success !== true) return json({ error: "forbidden" }, 403);
      }
      await env.DB.prepare(
        "INSERT OR IGNORE INTO waitlist (email, platform, source) VALUES (?,?,?)"
      ).bind(email, String(body.platform || "").slice(0, 20) || null, String(body.source || "").slice(0, 20) || null).run();
      // ordinal join position: rows at-or-before this signup's timestamp.
      // Duplicates return their ORIGINAL position, not the current total.
      const me = await env.DB.prepare("SELECT at FROM waitlist WHERE email = ?").bind(email).first();
      const pos = me
        ? await env.DB.prepare("SELECT COUNT(*) AS c FROM waitlist WHERE at <= ?").bind(me.at).first()
        : await env.DB.prepare("SELECT COUNT(*) AS c FROM waitlist").first();
      return json({ ok: true, position: pos ? pos.c : 1 });
    }
    if (url.pathname === "/api/waitlist" && req.method === "GET") {
      if (!env.DB) return json({ error: "no db" }, 503);
      if (!(await adminOk(req, env))) return json({ error: "forbidden" }, 403);
      const { results } = await env.DB.prepare(
        "SELECT email, at, source AS via FROM waitlist ORDER BY at ASC LIMIT 5000"
      ).all();
      return json({ items: results || [] });
    }
    if (url.pathname === "/api/health" && req.method === "GET") {
      return json({ ok: true, version: 1, db: !!env.DB, ai: !!env.AI, queue: !!env.EXPORT_QUEUE });
    }
    if (url.pathname === "/api/listing/generate" && req.method === "POST") {
      let body;
      try { body = await readJson(req); } catch (e) { return bodyError(e); }
      const appId = String(body.appId || "").trim().slice(0, 40);
      const shots = Array.isArray(body.screenshots) ? body.screenshots.slice(0, 10) : null;
      const locale = String(body.locale || "en-US");
      if (!appId || !shots || !/^[a-z]{2}(-[A-Z]{2})?$/.test(locale)) {
        return json({ error: "need appId, screenshots[<=10], locale" }, 400);
      }
      // Model wiring lands with the AI binding (Workers AI -> Gemini -> BYO via AI Gateway).
      if (!env.AI) return json({ ok: false, error: "ai not configured" }, 501);
      return json({ ok: false, error: "not implemented" }, 501);
    }
    if (url.pathname === "/api/exports" && req.method === "POST") {
      let body;
      try { body = await readJson(req); } catch (e) { return bodyError(e); }
      const appId = String(body.appId || "").trim().slice(0, 40);
      const size = String(body.size || "");
      const n = Array.isArray(body.screens) ? body.screens.length : 0;
      if (!appId || !/^\d+x\d+$/.test(size) || n < 1 || n > 10) {
        return json({ error: "need appId, size WxH, screens[1..10]" }, 400);
      }
      if (!env.EXPORT_QUEUE) return json({ ok: false, error: "export queue not configured" }, 501);
      const id = crypto.randomUUID();
      await env.EXPORT_QUEUE.send({ id, appId, size, screens: n, at: Date.now() });
      return json({ ok: true, id, status: "queued" });
    }
    return json({ error: "not found" }, 404);
  },
};
