// AppCaptures API Worker — zero dependencies. Serves /api/*; everything else falls
// through to static assets. Without a [[d1_databases]] binding (env.DB), all API
// routes answer 503 and the client keeps its localStorage fallback (see index.html).
// Mini-side setup: wrangler d1 create appcaptures_db -> paste block into wrangler.jsonc
// -> wrangler d1 execute appcaptures_db --file schema.sql -> deploy.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
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
      let body = {};
      try { body = await req.json(); } catch (e) { return json({ error: "bad json" }, 400); }
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
      try {
        await env.DB.prepare(
          "INSERT INTO waitlist (email, platform, source) VALUES (?,?,?)"
        ).bind(email, String(body.platform || "").slice(0, 20) || null, String(body.source || "").slice(0, 20) || null).run();
      } catch (e) { /* duplicate email: keep existing row, still return position */ }
      const row = await env.DB.prepare("SELECT COUNT(*) AS c FROM waitlist").first();
      return json({ ok: true, position: row ? row.c : null });
    }
    if (url.pathname === "/api/waitlist" && req.method === "GET") {
      if (!env.DB) return json({ error: "no db" }, 503);
      const { results } = await env.DB.prepare(
        "SELECT email, at, source AS via FROM waitlist ORDER BY at ASC LIMIT 5000"
      ).all();
      return json({ items: results || [] });
    }
    if (url.pathname === "/api/health" && req.method === "GET") {
      return json({ ok: true, version: 1, db: !!env.DB, ai: !!env.AI, queue: !!env.EXPORT_QUEUE });
    }
    if (url.pathname === "/api/listing/generate" && req.method === "POST") {
      let body = {};
      try { body = await req.json(); } catch (e) { return json({ error: "bad json" }, 400); }
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
      let body = {};
      try { body = await req.json(); } catch (e) { return json({ error: "bad json" }, 400); }
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
