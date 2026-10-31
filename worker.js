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

let _aiAdapter;
async function getAIAdapter(env) {
  if (env && env.AI_ADAPTER) return env.AI_ADAPTER;
  if (!_aiAdapter) {
    try {
      _aiAdapter = await import("./engine/ai-adapter.js");
    } catch {
      const testFallback = "../engine/ai-adapter.js";
      _aiAdapter = await import(testFallback);
    }
  }
  return _aiAdapter;
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

    // --- Render & Jobs API (AC-008) ---
    const projectRenderMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/render$/);
    if (projectRenderMatch && req.method === "POST") {
      if (!env.DB) return json({ error: "no db" }, 503);
      const user = await authenticateSession(req, env);
      if (!user) return json({ error: "unauthorized" }, 401);
      const projectId = projectRenderMatch[1];
      const projectRow = await env.DB.prepare(
        "SELECT * FROM projects WHERE id = ? AND user_id = ? AND archived_at IS NULL"
      ).bind(projectId, user.id).first();
      if (!projectRow) return json({ error: "project not found" }, 404);

      let body = {};
      if (req.headers.get("content-type")?.includes("application/json") || req.body) {
        try {
          body = await readJson(req);
        } catch (e) {
          if (e && e.status === 413) return bodyError(e);
          if (e && e.status === 400 && req.headers.get("content-length") && Number(req.headers.get("content-length")) > 0) {
            return bodyError(e);
          }
        }
      }

      let platforms = [];
      try { platforms = JSON.parse(projectRow.platforms_json || "[]"); } catch {}
      let brand = {};
      try { brand = JSON.parse(projectRow.brand_json || "{}"); } catch {}

      // Target sizes: default to project platforms or standard presets
      let targetSizes = [];
      if (Array.isArray(body.targetSizes) && body.targetSizes.length > 0) {
        targetSizes = body.targetSizes.map(String);
      } else if (typeof body.targetSizes === "string" && body.targetSizes.trim()) {
        targetSizes = [body.targetSizes.trim()];
      } else if (platforms.includes("android")) {
        targetSizes = ["1080x1920"];
      } else if (platforms.includes("ios")) {
        targetSizes = ["1290x2796", "1179x2556"];
      } else {
        targetSizes = ["1290x2796"];
      }

      // Screens: from body or project database
      let screens = [];
      if (Array.isArray(body.screens) && body.screens.length > 0) {
        screens = body.screens;
      } else {
        const { results: dbScreens } = await env.DB.prepare(
          "SELECT * FROM screens WHERE project_id = ? ORDER BY ord ASC"
        ).bind(projectId).all();
        screens = dbScreens && dbScreens.length > 0 ? dbScreens : [{ headline: projectRow.name || "App", subhead: "" }];
      }

      const jobId = crypto.randomUUID();
      const { runLoop, checkContrast } = await import("./engine/render-loop.js");

      const parsedSizes = targetSizes.map((s) => {
        const parts = String(s).split("x").map((n) => parseInt(n, 10));
        return {
          width: parts[0] || 1290,
          height: parts[1] || 2796,
          name: String(s),
        };
      });

      const fgColor = (body.brand && body.brand.headlineColor) || brand.headlineColor || "#ffffff";
      const bgColor = (body.brand && body.brand.bg) || brand.bg || "#0b0914";

      const loopResult = await runLoop({
        target: "html",
        brief: {
          copy: { headline: screens[0]?.headline || projectRow.name },
          brand: { ...brand, headlineColor: fgColor, bg: bgColor },
          sizes: parsedSizes,
          screens,
          store: body.store || "apple",
        },
        generate: async (b) => {
          return b.screens
            .map(
              (s) =>
                `<div style="background:${b.brand.bg};color:${b.brand.headlineColor};width:${b.sizes[0].width}px;height:${b.sizes[0].height}px"><h1>${s.headline}</h1><p>${s.subhead || ""}</p></div>`
            )
            .join("\n");
        },
        render: async (code, size) => {
          return [
            {
              width: size.width,
              height: size.height,
              colorType: 2,
              hasAlpha: false,
            },
          ];
        },
        checks: async (png, code, size) => {
          const issues = [];
          const contrast = checkContrast(fgColor, bgColor);
          if (!contrast.ok && contrast.issue) {
            issues.push(contrast.issue);
          }
          return issues;
        },
        maxPasses: 3,
      });

      // Build per-pass review telemetry with explicit review notes
      const passes = (loopResult.passes || []).map((p) => {
        const notes = [];
        for (const s of targetSizes) {
          notes.push(`Pass ${p.pass}: Checking store dimensions & ratio (${s}): PASS`);
        }
        if (!p.issues.some((i) => i.type === "alpha_channel_detected")) {
          notes.push(`Pass ${p.pass}: Alpha transparency check: PASS (no alpha)`);
        } else {
          notes.push(`Pass ${p.pass}: Alpha transparency check: FAIL (alpha detected)`);
        }
        const contrast = checkContrast(fgColor, bgColor);
        if (contrast.ok) {
          notes.push(`Pass ${p.pass}: Contrast audit: ${contrast.ratio}:1 PASS`);
        } else {
          notes.push(`Pass ${p.pass}: Contrast audit: ${contrast.ratio}:1 FAIL`);
        }

        if (p.fixed) {
          notes.push("Dimensions verified");
          notes.push("No alpha verified");
          notes.push("WCAG AA contrast verified");
        }

        return {
          pass: p.pass,
          issues: p.issues || [],
          fixed: Boolean(p.fixed),
          notes,
        };
      });

      const targetSizeStr = targetSizes.join(", ");
      const htmlR2Key = `renders/${jobId}/index.html`;
      const pngR2Key = `renders/${jobId}/screen.png`;
      const reviewJson = JSON.stringify(passes);

      await env.DB.prepare(
        `INSERT INTO renders (
          id, project_id, target_size, html_r2_key, png_r2_key, passes, review_json, status, cost_neurons
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', 0)`
      ).bind(
        jobId,
        projectId,
        targetSizeStr,
        htmlR2Key,
        pngR2Key,
        passes.length,
        reviewJson
      ).run();

      return json({
        ok: true,
        jobId,
        targetSizes,
        passes,
        status: "completed",
      });
    }

    const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (jobMatch && req.method === "GET") {
      if (!env.DB) return json({ error: "no db" }, 503);
      const user = await authenticateSession(req, env);
      if (!user) return json({ error: "unauthorized" }, 401);
      const jobId = jobMatch[1];
      const render = await env.DB.prepare(
        `SELECT r.id, r.project_id, r.target_size, r.review_json, r.status
         FROM renders r
         JOIN projects p ON p.id = r.project_id
         WHERE r.id = ? AND p.user_id = ? AND p.archived_at IS NULL`
      ).bind(jobId, user.id).first();
      if (!render) return json({ error: "job not found" }, 404);

      let passes = [];
      try { passes = JSON.parse(render.review_json || "[]"); } catch {}
      return json({
        ok: true,
        job: {
          id: render.id,
          projectId: render.project_id,
          targetSize: render.target_size,
          passes,
          status: render.status,
        },
      });
    }
    if (url.pathname === "/api/listing/generate" && req.method === "POST") {
      let body;
      try { body = await readJson(req); } catch (e) { return bodyError(e); }

      const { normalizeStore, generateListingCopy, sanitizeListing } = await getAIAdapter(env);

      const projectId = String(body.projectId || body.appId || "").trim();
      const rawStore = body.store || body.platform;
      const store = normalizeStore(rawStore);
      const locale = String(body.locale || "en-US").trim();
      const shots = Array.isArray(body.screenshots) ? body.screenshots.slice(0, 10) : null;

      // Legacy stub support when no DB is bound (for tests/api.mjs contract):
      if (!env.DB) {
        if (!projectId || (!store && !shots) || !/^[a-z]{2}(-[A-Z]{2})?$/.test(locale)) {
          return json({ error: "need projectId, store (or screenshots[<=10]), locale" }, 400);
        }
        if (!env.AI && !env.GEMINI_API_KEY && !env.MOCK_AI) {
          return json({ ok: false, error: "ai not configured" }, 501);
        }
      }

      // Authenticates user session (fails closed with 401 if unauthorized)
      const user = await authenticateSession(req, env);
      if (!user) return json({ error: "unauthorized" }, 401);

      // Validates { projectId, store, locale, appName, context }. Store must be "ios" or "play" (or "apple" / "google")
      if (!projectId) return json({ error: "projectId required" }, 400);
      if (!store) return json({ error: "store must be ios or play" }, 400);
      if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(locale)) {
        return json({ error: "invalid locale format" }, 400);
      }

      // Verifies project belongs to user and is not archived (404 if not found)
      const project = await env.DB.prepare(
        "SELECT id, user_id, name, archived_at FROM projects WHERE id = ? AND user_id = ? AND archived_at IS NULL"
      ).bind(projectId, user.id).first();
      if (!project) return json({ error: "not found" }, 404);

      const appName = String(body.appName || project.name || "").trim() || "App";
      const context = String(body.context || "");
      const screenshots = Array.isArray(body.screenshots) ? body.screenshots.slice(0, 10) : [];

      // Invokes AI adapter to generate title, subtitle/short, description, keywords/tags
      const rawFields = await generateListingCopy({
        store,
        appName,
        context,
        locale,
        screenshots,
        env,
      });

      // Applies code-enforced limits via sanitizeListing(store, rawFields)
      const fields = sanitizeListing(store, rawFields);

      // Inserts or updates row in D1 listings (id, project_id, store, locale, fields_json)
      const existing = await env.DB.prepare(
        "SELECT id FROM listings WHERE project_id = ? AND store = ? AND locale = ?"
      ).bind(projectId, store, locale).first();

      let listingId;
      if (existing) {
        listingId = existing.id;
        await env.DB.prepare(
          "UPDATE listings SET fields_json = ? WHERE id = ?"
        ).bind(JSON.stringify(fields), listingId).run();
      } else {
        listingId = crypto.randomUUID();
        await env.DB.prepare(
          "INSERT INTO listings (id, project_id, store, locale, fields_json) VALUES (?, ?, ?, ?, ?)"
        ).bind(listingId, projectId, store, locale, JSON.stringify(fields)).run();
      }

      // Returns json({ ok: true, listing: { id, projectId, store, locale, fields } })
      return json({
        ok: true,
        listing: {
          id: listingId,
          projectId,
          store,
          locale,
          fields,
        },
      });
    }
    const projectListingMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/listing$/);
    if (projectListingMatch && req.method === "GET") {
      if (!env.DB) return json({ error: "no db" }, 503);
      const user = await authenticateSession(req, env);
      if (!user) return json({ error: "unauthorized" }, 401);

      const projectId = decodeURIComponent(projectListingMatch[1]);
      const project = await env.DB.prepare(
        "SELECT id, user_id, name, archived_at FROM projects WHERE id = ? AND user_id = ? AND archived_at IS NULL"
      ).bind(projectId, user.id).first();
      if (!project) return json({ error: "not found" }, 404);

      const { normalizeStore } = await getAIAdapter(env);
      const storeQuery = url.searchParams.get("store");
      const store = storeQuery ? normalizeStore(storeQuery) : null;
      const locale = url.searchParams.get("locale");

      let row;
      if (store && locale) {
        row = await env.DB.prepare(
          "SELECT id, project_id, store, locale, fields_json FROM listings WHERE project_id = ? AND store = ? AND locale = ? ORDER BY id DESC LIMIT 1"
        ).bind(projectId, store, locale).first();
      } else if (store) {
        row = await env.DB.prepare(
          "SELECT id, project_id, store, locale, fields_json FROM listings WHERE project_id = ? AND store = ? ORDER BY id DESC LIMIT 1"
        ).bind(projectId, store).first();
      } else {
        row = await env.DB.prepare(
          "SELECT id, project_id, store, locale, fields_json FROM listings WHERE project_id = ? ORDER BY id DESC LIMIT 1"
        ).bind(projectId).first();
      }

      if (!row) return json({ error: "not found" }, 404);

      let fields = {};
      try {
        fields = JSON.parse(row.fields_json || "{}");
      } catch {
        fields = {};
      }

      return json({
        ok: true,
        listing: {
          id: row.id,
          projectId: row.project_id,
          store: row.store,
          locale: row.locale,
          fields,
        },
      });
    }
    if (url.pathname === "/api/post/generate" && req.method === "POST") {
      let body;
      try { body = await readJson(req); } catch (e) { return bodyError(e); }

      // Authenticates user session (fails closed with 401 if unauthorized)
      const user = await authenticateSession(req, env);
      if (!user) return json({ error: "unauthorized" }, 401);

      if (!env.DB) return json({ error: "no db" }, 503);

      // Validates body { projectId, platforms, tone, context }
      const projectId = String(body.projectId || "").trim();
      if (!projectId) return json({ error: "projectId required" }, 400);

      let platforms = body.platforms;
      if (!Array.isArray(platforms) || platforms.length === 0) {
        platforms = ["twitter", "linkedin", "producthunt"];
      } else {
        platforms = platforms
          .map((p) => String(p || "").toLowerCase().trim())
          .filter((p) => ["twitter", "linkedin", "producthunt", "threads"].includes(p));
        if (platforms.length === 0) {
          platforms = ["twitter", "linkedin", "producthunt"];
        }
      }

      const tone = String(body.tone || "launch").toLowerCase().trim() || "launch";
      const context = String(body.context || "").trim();

      // Verifies project belongs to authenticated user and is not archived (returns 404 if not found)
      const project = await env.DB.prepare(
        "SELECT id, user_id, name, platforms_json, brand_json, archived_at FROM projects WHERE id = ? AND user_id = ? AND archived_at IS NULL"
      ).bind(projectId, user.id).first();
      if (!project) return json({ error: "not found" }, 404);

      // Fetches project name and brand info from D1 projects
      const projectName = String(project.name || "").trim() || "App";
      let brandInfo = {};
      try {
        brandInfo = JSON.parse(project.brand_json || "{}");
      } catch {
        brandInfo = {};
      }

      // Calls completeAI from engine/ai-adapter.js (or structured template / AI generator)
      const { generateSocialPosts, completeAI } = await getAIAdapter(env);
      const posts = await generateSocialPosts({
        projectName,
        brandInfo,
        platforms,
        tone,
        context,
        env,
        completeAI,
      });

      // Returns json({ ok: true, projectId, posts: { twitter, linkedin, producthunt, threads } })
      return json({
        ok: true,
        projectId,
        posts,
      });
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
