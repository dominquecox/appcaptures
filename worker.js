// AppCaptures API Worker — zero dependencies. Serves /api/*; everything else falls
// through to static assets. Without a [[d1_databases]] binding (env.DB), all API
// routes answer 503 and the client keeps its localStorage fallback (see index.html).
// Mini-side setup: wrangler d1 create appcaptures_db -> paste block into wrangler.jsonc
// -> wrangler d1 execute appcaptures_db --file schema.sql -> deploy.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(data, status = 200, extraHeaders = {}) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...extraHeaders },
  });
}

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  const parts = header.split(";");
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx !== -1) {
      const key = part.slice(0, idx).trim();
      const val = part.slice(idx + 1).trim();
      try {
        cookies[key] = decodeURIComponent(val);
      } catch {
        cookies[key] = val;
      }
    }
  }
  return cookies;
}

function getSessionToken(req) {
  const cookies = parseCookies(req.headers.get("cookie") || "");
  return cookies.appcaptures_session || null;
}

function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashToken(token) {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(token));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function authenticateSession(req, env) {
  if (!env.DB) return null;
  const token = getSessionToken(req);
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.plan, u.status, s.id AS session_id, s.token_hash, s.expires_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND datetime(s.expires_at) > datetime('now') AND (u.status IS NULL OR u.status != 'deleted')`
  ).bind(tokenHash).first();
  return row || null;
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
  let bytes = 0;
  if (req.body) {
    const reader = req.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) {
          await reader.cancel();
          const e = new Error("too large"); e.status = 413; throw e;
        }
        text += decoder.decode(value, { stream: true });
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

// Staff gate: fails closed if ADMIN_TOKEN is missing or unset. When set,
// GET /api/waitlist requires the bearer token, compared via SHA-256 digest
// so raw secrets never meet ===. Launch replaces this with Cloudflare Access;
// the token path stays for scripts.
async function adminOk(req, env) {
  if (!env.ADMIN_TOKEN) return false;
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
// requires a valid Turnstile token and fails closed. In production (env.ENV === "prod"),
// missing TURNSTILE_SECRET fails closed (403). Unset secret in non-prod keeps open
// behavior for dogfood/local dev. Keys stay in the dashboard/secret store, never here.
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
      if (env.ENV === "prod" && !env.TURNSTILE_SECRET) {
        return json({ error: "forbidden" }, 403);
      }
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
      // Ordinal join position: timestamp, then SQLite rowid for same-second joins.
      // The existing rowid needs no schema migration and duplicates keep it.
      // Duplicates return their ORIGINAL position, not the current total.
      const me = await env.DB.prepare("SELECT at, rowid AS id FROM waitlist WHERE email = ?").bind(email).first();
      const pos = me
        ? await env.DB.prepare("SELECT COUNT(*) AS c FROM waitlist WHERE at < ? OR (at = ? AND rowid <= ?)").bind(me.at, me.at, me.id).first()
        : await env.DB.prepare("SELECT COUNT(*) AS c FROM waitlist").first();
      return json({ ok: true, position: pos ? pos.c : 1 });
    }
    if (url.pathname === "/api/waitlist" && req.method === "GET") {
      if (!env.DB) return json({ error: "no db" }, 503);
      if (!(await adminOk(req, env))) return json({ error: "forbidden" }, 403);
      const { results } = await env.DB.prepare(
        "SELECT email, at, source AS via FROM waitlist ORDER BY at ASC, rowid ASC LIMIT 5000"
      ).all();
      return json({ items: results || [] });
    }
    if (url.pathname === "/api/health" && req.method === "GET") {
      return json({ ok: true, version: 1, db: !!env.DB, ai: !!env.AI, queue: !!env.EXPORT_QUEUE });
    }
    if (url.pathname === "/api/auth/magic-link" && req.method === "POST") {
      if (!env.DB) return json({ ok: false, fallback: true }, 503);
      let body;
      try { body = await readJson(req); } catch (e) { return bodyError(e); }
      const email = String(body.email || "").trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return json({ error: "bad email" }, 400);

      if (env.ENV === "prod" && !env.TURNSTILE_SECRET) {
        return json({ error: "forbidden" }, 403);
      }
      if (env.TURNSTILE_SECRET) {
        const token = String(body.turnstile || "");
        if (!token || token.length > 2048) return json({ error: "forbidden" }, 403);
        let v;
        try {
          v = await verifyTurnstile(env.TURNSTILE_SECRET, token, req.headers.get("CF-Connecting-IP"));
        } catch (e) {
          return json({ error: "forbidden" }, 403);
        }
        if (!v || v.success !== true) return json({ error: "forbidden" }, 403);
      }

      const rawToken = generateToken();
      const tokenHash = await hashToken(rawToken);
      await env.DB.prepare(
        "INSERT INTO magic_links (token_hash, email, expires_at) VALUES (?, ?, datetime('now', '+15 minutes'))"
      ).bind(tokenHash, email).run();

      if (env.RESEND_API_KEY) {
        const link = `${url.origin}/api/auth/callback?token=${rawToken}`;
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "AppCaptures <appcaptures@ploonu.com>",
            to: email,
            reply_to: "support@appcaptures.com",
            subject: "Your AppCaptures sign-in link",
            text: `Your AppCaptures sign-in link:\n\n${link}\n\nThis link expires in 15 minutes.`,
            html: `<p>Your AppCaptures sign-in link:</p><p><a href="${link}">${link}</a></p><p>This link expires in 15 minutes.</p>`,
          }),
        });
        if (!res.ok) {
          return json({ error: "failed to send email" }, 502);
        }
      }

      return json({ ok: true });
    }
    if (url.pathname === "/api/auth/callback" && req.method === "GET") {
      if (!env.DB) return json({ error: "no db" }, 503);
      const rawToken = url.searchParams.get("token");
      if (!rawToken) return json({ error: "invalid or expired token" }, 401);

      const tokenHash = await hashToken(rawToken);
      const link = await env.DB.prepare(
        "SELECT email, expires_at FROM magic_links WHERE token_hash = ? AND used_at IS NULL AND datetime(expires_at) > datetime('now')"
      ).bind(tokenHash).first();

      if (!link) {
        return json({ error: "invalid or expired token" }, 401);
      }

      await env.DB.prepare(
        "UPDATE magic_links SET used_at = datetime('now') WHERE token_hash = ?"
      ).bind(tokenHash).run();

      let user = await env.DB.prepare(
        "SELECT id, email, name, plan, status FROM users WHERE email = ?"
      ).bind(link.email).first();

      if (!user) {
        const userId = crypto.randomUUID();
        await env.DB.prepare(
          "INSERT INTO users (id, email, status, plan, last_login_at) VALUES (?, ?, 'active', 'free', datetime('now'))"
        ).bind(userId, link.email).run();
        user = { id: userId, email: link.email, name: null, plan: "free", status: "active" };
      } else {
        await env.DB.prepare(
          "UPDATE users SET last_login_at = datetime('now'), status = 'active' WHERE id = ?"
        ).bind(user.id).run();
        user.status = "active";
      }

      const rawSessionToken = generateToken();
      const sessionTokenHash = await hashToken(rawSessionToken);
      const sessionId = crypto.randomUUID();
      const ip = req.headers.get("CF-Connecting-IP") || null;
      const ua = req.headers.get("User-Agent") || null;

      await env.DB.prepare(
        "INSERT INTO sessions (id, user_id, token_hash, expires_at, ip, ua) VALUES (?, ?, ?, datetime('now', '+30 days'), ?, ?)"
      ).bind(sessionId, user.id, sessionTokenHash, ip, ua).run();

      const cookie = `appcaptures_session=${rawSessionToken}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`;
      if (url.searchParams.get("redirect")) {
        return new Response(null, {
          status: 302,
          headers: {
            "Location": url.searchParams.get("redirect"),
            "Set-Cookie": cookie,
            "Cache-Control": "no-store",
          },
        });
      }
      return json(
        { ok: true, user: { id: user.id, email: user.email, name: user.name, plan: user.plan, status: user.status } },
        200,
        { "Set-Cookie": cookie }
      );
    }
    if (url.pathname === "/api/auth/logout" && req.method === "POST") {
      if (!env.DB) return json({ error: "no db" }, 503);
      const token = getSessionToken(req);
      if (token) {
        const tokenHash = await hashToken(token);
        await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
      }
      return json(
        { ok: true },
        200,
        { "Set-Cookie": "appcaptures_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax" }
      );
    }
    if (url.pathname === "/api/me" && req.method === "GET") {
      if (!env.DB) return json({ error: "no db" }, 503);
      const user = await authenticateSession(req, env);
      if (!user) return json({ error: "unauthorized" }, 401);
      return json({
        ok: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name ?? null,
          plan: user.plan ?? "free",
          status: user.status ?? "active",
        },
      });
    }
    if (url.pathname === "/api/me" && req.method === "DELETE") {
      if (!env.DB) return json({ error: "no db" }, 503);
      const user = await authenticateSession(req, env);
      if (!user) return json({ error: "unauthorized" }, 401);
      await env.DB.prepare("UPDATE users SET status = 'deleted' WHERE id = ?").bind(user.id).run();
      await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id).run();
      return json(
        { ok: true },
        200,
        { "Set-Cookie": "appcaptures_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax" }
      );
    }
    // --- Projects & Screens API (AC-007) ---
    if (url.pathname === "/api/projects" && req.method === "GET") {
      if (!env.DB) return json({ error: "no db" }, 503);
      const user = await authenticateSession(req, env);
      if (!user) return json({ error: "unauthorized" }, 401);
      const { results } = await env.DB.prepare(
        "SELECT * FROM projects WHERE user_id = ? AND archived_at IS NULL ORDER BY updated_at DESC"
      ).bind(user.id).all();
      const projects = (results || []).map((p) => {
        let platforms = [];
        try { platforms = JSON.parse(p.platforms_json || "[]"); } catch {}
        let brand = {};
        try { brand = JSON.parse(p.brand_json || "{}"); } catch {}
        const row = { ...p, platforms, brand };
        delete row.platforms_json;
        delete row.brand_json;
        return row;
      });
      return json({ ok: true, projects });
    }
    if (url.pathname === "/api/projects" && req.method === "POST") {
      if (!env.DB) return json({ error: "no db" }, 503);
      const user = await authenticateSession(req, env);
      if (!user) return json({ error: "unauthorized" }, 401);
      let body;
      try { body = await readJson(req); } catch (e) { return bodyError(e); }
      const name = (body.name && String(body.name).trim()) ? String(body.name).trim() : "Untitled App";
      const platforms = body.platforms ?? [];
      const brand = body.brand ?? {};
      const id = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO projects (id, user_id, name, platforms_json, brand_json) VALUES (?, ?, ?, ?, ?)"
      ).bind(id, user.id, name, JSON.stringify(platforms), JSON.stringify(brand)).run();

      if (Array.isArray(body.screens) && body.screens.length > 0) {
        for (let i = 0; i < body.screens.length; i++) {
          const s = body.screens[i];
          const screenId = s.id || crypto.randomUUID();
          const ord = typeof s.ord === "number" ? s.ord : i;
          const headline = String(s.headline ?? "");
          const subhead = String(s.subhead ?? "");
          const locale = String(s.locale ?? "en-US");
          const captureKey = s.capture_r2_key ? String(s.capture_r2_key) : null;
          await env.DB.prepare(
            "INSERT INTO screens (id, project_id, ord, capture_r2_key, headline, subhead, locale) VALUES (?, ?, ?, ?, ?, ?, ?)"
          ).bind(screenId, id, ord, captureKey, headline, subhead, locale).run();
        }
      }

      return json({ ok: true, project: { id, name, platforms, brand } }, 201);
    }

    const projectScreensMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/screens$/);
    if (projectScreensMatch && req.method === "POST") {
      if (!env.DB) return json({ error: "no db" }, 503);
      const user = await authenticateSession(req, env);
      if (!user) return json({ error: "unauthorized" }, 401);
      const projectId = projectScreensMatch[1];
      const project = await env.DB.prepare(
        "SELECT id FROM projects WHERE id = ? AND user_id = ? AND archived_at IS NULL"
      ).bind(projectId, user.id).first();
      if (!project) return json({ error: "project not found" }, 404);

      let body;
      try { body = await readJson(req); } catch (e) { return bodyError(e); }
      const id = crypto.randomUUID();
      let ord = typeof body.ord === "number" ? body.ord : null;
      if (ord === null) {
        const maxOrdRow = await env.DB.prepare(
          "SELECT MAX(ord) AS m FROM screens WHERE project_id = ?"
        ).bind(projectId).first();
        ord = (maxOrdRow && typeof maxOrdRow.m === "number") ? maxOrdRow.m + 1 : 0;
      }
      const headline = String(body.headline ?? "");
      const subhead = String(body.subhead ?? "");
      const locale = String(body.locale ?? "en-US");
      const captureKey = body.capture_r2_key ? String(body.capture_r2_key) : null;

      await env.DB.prepare(
        "INSERT INTO screens (id, project_id, ord, capture_r2_key, headline, subhead, locale) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).bind(id, projectId, ord, captureKey, headline, subhead, locale).run();
      await env.DB.prepare("UPDATE projects SET updated_at = datetime('now') WHERE id = ?").bind(projectId).run();

      return json({ ok: true, screen: { id, project_id: projectId, ord, headline, subhead } }, 201);
    }

    const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (projectMatch && req.method === "GET") {
      if (!env.DB) return json({ error: "no db" }, 503);
      const user = await authenticateSession(req, env);
      if (!user) return json({ error: "unauthorized" }, 401);
      const projectId = projectMatch[1];
      const projectRow = await env.DB.prepare(
        "SELECT * FROM projects WHERE id = ? AND user_id = ? AND archived_at IS NULL"
      ).bind(projectId, user.id).first();
      if (!projectRow) return json({ error: "project not found" }, 404);

      let platforms = [];
      try { platforms = JSON.parse(projectRow.platforms_json || "[]"); } catch {}
      let brand = {};
      try { brand = JSON.parse(projectRow.brand_json || "{}"); } catch {}
      const project = { ...projectRow, platforms, brand };
      delete project.platforms_json;
      delete project.brand_json;

      const { results: screens } = await env.DB.prepare(
        "SELECT * FROM screens WHERE project_id = ? ORDER BY ord ASC"
      ).bind(projectId).all();

      return json({ ok: true, project, screens: screens || [] });
    }
    if (projectMatch && req.method === "PATCH") {
      if (!env.DB) return json({ error: "no db" }, 503);
      const user = await authenticateSession(req, env);
      if (!user) return json({ error: "unauthorized" }, 401);
      const projectId = projectMatch[1];
      const projectRow = await env.DB.prepare(
        "SELECT id FROM projects WHERE id = ? AND user_id = ? AND archived_at IS NULL"
      ).bind(projectId, user.id).first();
      if (!projectRow) return json({ error: "project not found" }, 404);

      let body;
      try { body = await readJson(req); } catch (e) { return bodyError(e); }
      const updates = ["updated_at = datetime('now')"];
      const bindings = [];
      if (body.name !== undefined) {
        updates.push("name = ?");
        bindings.push(String(body.name).trim() || "Untitled App");
      }
      if (body.platforms !== undefined) {
        updates.push("platforms_json = ?");
        bindings.push(JSON.stringify(body.platforms));
      }
      if (body.brand !== undefined) {
        updates.push("brand_json = ?");
        bindings.push(JSON.stringify(body.brand));
      }
      bindings.push(projectId, user.id);
      await env.DB.prepare(
        `UPDATE projects SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`
      ).bind(...bindings).run();

      return json({ ok: true });
    }
    if (projectMatch && req.method === "DELETE") {
      if (!env.DB) return json({ error: "no db" }, 503);
      const user = await authenticateSession(req, env);
      if (!user) return json({ error: "unauthorized" }, 401);
      const projectId = projectMatch[1];
      const projectRow = await env.DB.prepare(
        "SELECT id FROM projects WHERE id = ? AND user_id = ? AND archived_at IS NULL"
      ).bind(projectId, user.id).first();
      if (!projectRow) return json({ error: "project not found" }, 404);

      await env.DB.prepare(
        "UPDATE projects SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND user_id = ?"
      ).bind(projectId, user.id).run();

      return json({ ok: true });
    }

    const screenMatch = url.pathname.match(/^\/api\/screens\/([^/]+)$/);
    if (screenMatch && req.method === "PATCH") {
      if (!env.DB) return json({ error: "no db" }, 503);
      const user = await authenticateSession(req, env);
      if (!user) return json({ error: "unauthorized" }, 401);
      const screenId = screenMatch[1];
      const screenRow = await env.DB.prepare(
        `SELECT s.id, s.project_id
         FROM screens s
         JOIN projects p ON p.id = s.project_id
         WHERE s.id = ? AND p.user_id = ? AND p.archived_at IS NULL`
      ).bind(screenId, user.id).first();
      if (!screenRow) return json({ error: "screen not found" }, 404);

      let body;
      try { body = await readJson(req); } catch (e) { return bodyError(e); }
      const updates = [];
      const bindings = [];
      if (body.headline !== undefined) {
        updates.push("headline = ?");
        bindings.push(String(body.headline));
      }
      if (body.subhead !== undefined) {
        updates.push("subhead = ?");
        bindings.push(String(body.subhead));
      }
      if (body.ord !== undefined) {
        updates.push("ord = ?");
        bindings.push(Number(body.ord));
      }
      if (body.capture_r2_key !== undefined) {
        updates.push("capture_r2_key = ?");
        bindings.push(body.capture_r2_key ? String(body.capture_r2_key) : null);
      }
      if (body.locale !== undefined) {
        updates.push("locale = ?");
        bindings.push(String(body.locale));
      }
      if (updates.length > 0) {
        bindings.push(screenId);
        await env.DB.prepare(
          `UPDATE screens SET ${updates.join(", ")} WHERE id = ?`
        ).bind(...bindings).run();
        await env.DB.prepare(
          "UPDATE projects SET updated_at = datetime('now') WHERE id = ?"
        ).bind(screenRow.project_id).run();
      }

      return json({ ok: true });
    }
    if (screenMatch && req.method === "DELETE") {
      if (!env.DB) return json({ error: "no db" }, 503);
      const user = await authenticateSession(req, env);
      if (!user) return json({ error: "unauthorized" }, 401);
      const screenId = screenMatch[1];
      const screenRow = await env.DB.prepare(
        `SELECT s.id, s.project_id
         FROM screens s
         JOIN projects p ON p.id = s.project_id
         WHERE s.id = ? AND p.user_id = ? AND p.archived_at IS NULL`
      ).bind(screenId, user.id).first();
      if (!screenRow) return json({ error: "screen not found" }, 404);

      await env.DB.prepare("DELETE FROM screens WHERE id = ?").bind(screenId).run();
      await env.DB.prepare(
        "UPDATE projects SET updated_at = datetime('now') WHERE id = ?"
      ).bind(screenRow.project_id).run();

      return json({ ok: true });
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
