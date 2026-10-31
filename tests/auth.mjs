// Auth and session unit tests (SPEC Section 3.3, AC-005)
// Run: node tests/auth.mjs

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
import path from "node:path";
import worker from "../worker.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const schemaSql = readFileSync(path.join(root, "schema-saas.sql"), "utf8");

// D1 wrapper backed by Node 22 in-memory SQLite (DatabaseSync)
function createD1() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schemaSql);

  return {
    rawDb: db,
    prepare(sql) {
      return {
        _bindings: [],
        bind(...args) {
          this._bindings = args;
          return this;
        },
        async run() {
          const stmt = db.prepare(sql);
          const info = stmt.run(...this._bindings);
          return { success: true, meta: { changes: info.changes }, changes: info.changes };
        },
        async first() {
          const stmt = db.prepare(sql);
          const row = stmt.get(...this._bindings);
          return row || null;
        },
        async all() {
          const stmt = db.prepare(sql);
          const results = stmt.all(...this._bindings);
          return { results };
        },
      };
    },
  };
}

// Helper to extract cookie value from Set-Cookie header
function getCookieVal(setCookieHeader, name) {
  if (!setCookieHeader) return null;
  const match = setCookieHeader.match(new RegExp(`${name}=([^;]+)`));
  return match ? match[1] : null;
}

const req = (url, init) => new Request(`https://appcaptures.com${url}`, init);
const post = (url, body, env, headers = {}) =>
  worker.fetch(
    req(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    env
  );

// --- 1. Requesting magic link ---
{
  const db = createD1();
  const env = { DB: db };

  // Missing DB returns 503
  let r = await post("/api/auth/magic-link", { email: "user@example.com" }, {});
  assert.equal(r.status, 503);

  // Invalid email returns 400
  for (const bad of ["invalid-email", "", "@nodomain.com", "user@", "plainaddress"]) {
    r = await post("/api/auth/magic-link", { email: bad }, env);
    assert.equal(r.status, 400, `Expected 400 for bad email: ${bad}`);
    const b = await r.json();
    assert.equal(b.error, "bad email");
  }

  // Production without TURNSTILE_SECRET fails closed (403)
  r = await post("/api/auth/magic-link", { email: "user@example.com" }, { ...env, ENV: "prod" });
  assert.equal(r.status, 403);
  assert.deepEqual(await r.json(), { error: "forbidden" });

  // Valid email with unset RESEND_API_KEY succeeds and does not throw
  r = await post("/api/auth/magic-link", { email: "user@example.com" }, env);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });

  // Verify magic link recorded in database
  const linkRow = db.rawDb.prepare("SELECT email, used_at FROM magic_links WHERE email = ?").get("user@example.com");
  assert.ok(linkRow, "magic_link row must exist");
  assert.equal(linkRow.email, "user@example.com");
  assert.equal(linkRow.used_at, null);
}

// --- 2. Outbound email via Resend and Turnstile verification ---
{
  const db = createD1();
  const originalFetch = globalThis.fetch;
  const sentEmails = [];
  const turnstileCalls = [];

  globalThis.fetch = async (url, opts) => {
    const urlStr = String(url);
    if (urlStr.includes("api.resend.com/emails")) {
      sentEmails.push({ url: urlStr, opts, body: JSON.parse(opts.body) });
      return new Response(JSON.stringify({ id: "email_123" }), { status: 200 });
    }
    if (urlStr.includes("turnstile/v0/siteverify")) {
      turnstileCalls.push({ url: urlStr, opts });
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    return originalFetch(url, opts);
  };

  try {
    const env = {
      DB: db,
      RESEND_API_KEY: "re_mock_key_123",
      TURNSTILE_SECRET: "mock_turnstile_secret",
    };

    // Missing turnstile token when TURNSTILE_SECRET set returns 403
    let r = await post("/api/auth/magic-link", { email: "turnstile@example.com" }, env);
    assert.equal(r.status, 403);
    assert.deepEqual(await r.json(), { error: "forbidden" });

    // Valid turnstile token sends email via Resend
    r = await post("/api/auth/magic-link", { email: "resend@example.com", turnstile: "valid_token" }, env);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });

    assert.equal(turnstileCalls.length, 1);
    assert.equal(sentEmails.length, 1);
    const email = sentEmails[0];
    assert.equal(email.body.from, "AppCaptures <appcaptures@ploonu.com>");
    assert.equal(email.body.to, "resend@example.com");
    assert.equal(email.body.reply_to, "support@appcaptures.com");
    assert.equal(email.body.subject, "Your AppCaptures sign-in link");
    assert.ok(email.body.text.includes("/api/auth/callback?token="));
    assert.ok(email.body.html.includes("/api/auth/callback?token="));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// --- 3. Magic link callback, user upsert, sessions, and cookies ---
{
  const db = createD1();
  let extractedToken = null;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, opts) => {
    if (String(url).includes("api.resend.com/emails")) {
      const payload = JSON.parse(opts.body);
      const m = payload.text.match(/token=([0-9a-fA-F]+)/);
      if (m) extractedToken = m[1];
      return new Response(JSON.stringify({ id: "email_ok" }), { status: 200 });
    }
    return originalFetch(url, opts);
  };

  try {
    const env = { DB: db, RESEND_API_KEY: "re_test" };

    // Request magic link
    let r = await post("/api/auth/magic-link", { email: "founder@ploonu.com" }, env);
    assert.equal(r.status, 200);
    assert.ok(extractedToken, "Must have extracted raw token from email payload");

    // Callback with missing token returns 401
    r = await worker.fetch(req("/api/auth/callback"), env);
    assert.equal(r.status, 401);
    assert.deepEqual(await r.json(), { error: "invalid or expired token" });

    // Callback with invalid token returns 401
    r = await worker.fetch(req("/api/auth/callback?token=badbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbad"), env);
    assert.equal(r.status, 401);
    assert.deepEqual(await r.json(), { error: "invalid or expired token" });

    // Callback with valid token consumes token, creates user, creates session, sets cookie
    r = await worker.fetch(req(`/api/auth/callback?token=${extractedToken}`), env);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.ok, true);
    assert.equal(body.user.email, "founder@ploonu.com");
    assert.equal(body.user.plan, "free");
    assert.equal(body.user.status, "active");
    assert.ok(body.user.id, "User must have a generated ID");

    // Verify Set-Cookie header
    const setCookie = r.headers.get("Set-Cookie");
    assert.ok(setCookie, "Response must include Set-Cookie header");
    assert.ok(setCookie.includes("appcaptures_session="));
    assert.ok(setCookie.includes("Path=/"));
    assert.ok(setCookie.includes("Max-Age=2592000"));
    assert.ok(setCookie.includes("HttpOnly"));
    assert.ok(setCookie.includes("Secure"));
    assert.ok(setCookie.includes("SameSite=Lax"));

    const sessionToken = getCookieVal(setCookie, "appcaptures_session");
    assert.ok(sessionToken, "Must extract session token from cookie");

    // Verify magic link marked as used in DB
    const linkRow = db.rawDb.prepare("SELECT used_at FROM magic_links WHERE email = ?").get("founder@ploonu.com");
    assert.ok(linkRow.used_at !== null, "used_at must be populated after callback");

    // Verify session row exists in DB
    const sessionCount = db.rawDb.prepare("SELECT COUNT(*) AS c FROM sessions WHERE user_id = ?").get(body.user.id);
    assert.equal(sessionCount.c, 1, "There must be 1 active session");

    // Test reusing consumed magic link fails (401)
    r = await worker.fetch(req(`/api/auth/callback?token=${extractedToken}`), env);
    assert.equal(r.status, 401);
    assert.deepEqual(await r.json(), { error: "invalid or expired token" });

    // Test second magic link for the SAME existing user updates last_login_at without error
    extractedToken = null;
    await post("/api/auth/magic-link", { email: "founder@ploonu.com" }, env);
    assert.ok(extractedToken);
    r = await worker.fetch(req(`/api/auth/callback?token=${extractedToken}`), env);
    assert.equal(r.status, 200);
    const body2 = await r.json();
    assert.equal(body2.user.id, body.user.id, "Must retain original user id");
    const userCount = db.rawDb.prepare("SELECT COUNT(*) AS c FROM users WHERE email = ?").get("founder@ploonu.com");
    assert.equal(userCount.c, 1, "Must not create duplicate user row on re-login");

    // Test safe redirect paths (single leading slash, no "//" prefix, no backslashes)
    extractedToken = null;
    await post("/api/auth/magic-link", { email: "founder@ploonu.com" }, env);
    assert.ok(extractedToken);
    r = await worker.fetch(req(`/api/auth/callback?token=${extractedToken}&redirect=/app`), env);
    assert.equal(r.status, 302);
    assert.equal(r.headers.get("Location"), "/app");

    extractedToken = null;
    await post("/api/auth/magic-link", { email: "founder@ploonu.com" }, env);
    assert.ok(extractedToken);
    r = await worker.fetch(req(`/api/auth/callback?token=${extractedToken}&redirect=/app/settings`), env);
    assert.equal(r.status, 302);
    assert.equal(r.headers.get("Location"), "/app/settings");

    // Open redirect attempt with "//evil.com" must NOT redirect to //evil.com (returns 200 json)
    extractedToken = null;
    await post("/api/auth/magic-link", { email: "founder@ploonu.com" }, env);
    assert.ok(extractedToken);
    r = await worker.fetch(req(`/api/auth/callback?token=${extractedToken}&redirect=//evil.com`), env);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("Location"), null);

    // Open redirect attempt with "https://evil.com" must NOT redirect to external host
    extractedToken = null;
    await post("/api/auth/magic-link", { email: "founder@ploonu.com" }, env);
    assert.ok(extractedToken);
    r = await worker.fetch(req(`/api/auth/callback?token=${extractedToken}&redirect=https://evil.com`), env);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("Location"), null);

    extractedToken = null;
    await post("/api/auth/magic-link", { email: "founder@ploonu.com" }, env);
    assert.ok(extractedToken);
    r = await worker.fetch(req(`/api/auth/callback?token=${extractedToken}&redirect=/\\evil.com`), env);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("Location"), null);

    extractedToken = null;
    await post("/api/auth/magic-link", { email: "founder@ploonu.com" }, env);
    assert.ok(extractedToken);
    r = await worker.fetch(req(`/api/auth/callback?token=${extractedToken}&redirect=${encodeURIComponent("/\\evil.com")}`), env);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("Location"), null);

    extractedToken = null;
    await post("/api/auth/magic-link", { email: "founder@ploonu.com" }, env);
    assert.ok(extractedToken);
    r = await worker.fetch(req(`/api/auth/callback?token=${extractedToken}&redirect=/`), env);
    assert.equal(r.status, 302);
    assert.equal(r.headers.get("Location"), "/");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// --- 4. Expired magic link fails ---
{
  const db = createD1();
  const env = { DB: db };

  // Insert expired magic link (10 minutes ago)
  const expiredRawToken = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(expiredRawToken));
  const expiredHash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");

  db.rawDb.prepare(
    "INSERT INTO magic_links (token_hash, email, expires_at) VALUES (?, ?, datetime('now', '-10 minutes'))"
  ).run(expiredHash, "expired@example.com");

  const r = await worker.fetch(req(`/api/auth/callback?token=${expiredRawToken}`), env);
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), { error: "invalid or expired token" });
}

// --- 5. GET /api/me authentication ---
{
  const db = createD1();
  const env = { DB: db };

  // 1. Without cookie returns 401
  let r = await worker.fetch(req("/api/me"), env);
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), { error: "unauthorized" });

  // 2. With bogus cookie returns 401
  r = await worker.fetch(req("/api/me", { headers: { Cookie: "appcaptures_session=bogus_token" } }), env);
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), { error: "unauthorized" });

  // 3. Create active session in DB and verify valid access
  const rawToken = "validsessiontoken1234567890abcdef1234567890abcdef";
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(rawToken));
  const tokenHash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");

  db.rawDb.prepare("INSERT INTO users (id, email, name, plan, status) VALUES ('u_me', 'me@ploonu.com', 'Alex Developer', 'pro', 'active')").run();
  db.rawDb.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ('s_me', 'u_me', ?, datetime('now', '+30 days'))").run(tokenHash);

  r = await worker.fetch(req("/api/me", { headers: { Cookie: `appcaptures_session=${rawToken}` } }), env);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), {
    ok: true,
    user: {
      id: "u_me",
      email: "me@ploonu.com",
      name: "Alex Developer",
      plan: "pro",
      status: "active",
    },
  });

  // 4. Expired session returns 401
  db.rawDb.prepare("UPDATE sessions SET expires_at = datetime('now', '-1 day') WHERE id = 's_me'").run();
  r = await worker.fetch(req("/api/me", { headers: { Cookie: `appcaptures_session=${rawToken}` } }), env);
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), { error: "unauthorized" });
}

// --- 6. POST /api/auth/logout ---
{
  const db = createD1();
  const env = { DB: db };

  const rawToken = "logoutsessiontoken1234567890abcdef1234567890abcdef";
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(rawToken));
  const tokenHash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");

  db.rawDb.prepare("INSERT INTO users (id, email, status) VALUES ('u_out', 'logout@ploonu.com', 'active')").run();
  db.rawDb.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ('s_out', 'u_out', ?, datetime('now', '+30 days'))").run(tokenHash);

  // Logout request with valid session cookie
  let r = await worker.fetch(req("/api/auth/logout", { method: "POST", headers: { Cookie: `appcaptures_session=${rawToken}` } }), env);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });

  // Cookie must be cleared (Max-Age=0)
  const setCookie = r.headers.get("Set-Cookie");
  assert.ok(setCookie.includes("appcaptures_session=;"));
  assert.ok(setCookie.includes("Max-Age=0"));

  // Session must be removed from DB
  const row = db.rawDb.prepare("SELECT * FROM sessions WHERE id = 's_out'").get();
  assert.equal(row, undefined, "Session must be deleted from DB");

  // Subsequent GET /api/me with former cookie fails (401)
  r = await worker.fetch(req("/api/me", { headers: { Cookie: `appcaptures_session=${rawToken}` } }), env);
  assert.equal(r.status, 401);
}

// --- 7. DELETE /api/me ---
{
  const db = createD1();
  const env = { DB: db };

  // Unauthorized without cookie
  let r = await worker.fetch(req("/api/me", { method: "DELETE" }), env);
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), { error: "unauthorized" });

  // Active user and session
  const rawToken = "deletemetoken1234567890abcdef1234567890abcdef";
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(rawToken));
  const tokenHash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");

  db.rawDb.prepare("INSERT INTO users (id, email, status) VALUES ('u_del', 'del@ploonu.com', 'active')").run();
  db.rawDb.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ('s_del', 'u_del', ?, datetime('now', '+30 days'))").run(tokenHash);

  // Delete user account
  r = await worker.fetch(req("/api/me", { method: "DELETE", headers: { Cookie: `appcaptures_session=${rawToken}` } }), env);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });

  // Cookie cleared
  const setCookie = r.headers.get("Set-Cookie");
  assert.ok(setCookie.includes("appcaptures_session=;"));
  assert.ok(setCookie.includes("Max-Age=0"));

  // User marked deleted
  const userRow = db.rawDb.prepare("SELECT status FROM users WHERE id = 'u_del'").get();
  assert.equal(userRow.status, "deleted");

  // Sessions deleted
  const sessionRows = db.rawDb.prepare("SELECT COUNT(*) AS c FROM sessions WHERE user_id = 'u_del'").get();
  assert.equal(sessionRows.c, 0);

  // Subsequent GET /api/me returns 401
  r = await worker.fetch(req("/api/me", { headers: { Cookie: `appcaptures_session=${rawToken}` } }), env);
  assert.equal(r.status, 401);
}

// --- 8. Magic-link consume fails closed when D1 run() omits changes count ---
{
  const base = createD1();
  const env = {
    DB: {
      rawDb: base.rawDb,
      prepare(sql) {
        const inner = base.prepare(sql);
        return {
          _bindings: [],
          bind(...args) {
            this._bindings = args;
            inner.bind(...args);
            return this;
          },
          async run() {
            if (/UPDATE magic_links SET used_at/i.test(sql)) {
              return { success: true };
            }
            return inner.run();
          },
          async first() {
            return inner.first();
          },
          async all() {
            return inner.all();
          },
        };
      },
    },
  };

  const rawToken = "nochangesfield1234567890abcdef1234567890ab";
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(rawToken));
  const tokenHash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");

  base.rawDb.prepare(
    "INSERT INTO magic_links (token_hash, email, expires_at) VALUES (?, 'nochanges@example.com', datetime('now', '+15 minutes'))"
  ).run(tokenHash);

  const r = await worker.fetch(req(`/api/auth/callback?token=${rawToken}`), env);
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), { error: "invalid or expired token" });

  const linkRow = base.rawDb.prepare("SELECT used_at FROM magic_links WHERE token_hash = ?").get(tokenHash);
  assert.equal(linkRow.used_at, null, "Must not treat ambiguous update as consumed when changes count is missing");
}

// --- 9. Redirect on callback (if requested) ---
{
  const db = createD1();
  const env = { DB: db };

  const rawToken = "redirecttoken1234567890abcdef1234567890abcdef";
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(rawToken));
  const tokenHash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");

  db.rawDb.prepare("INSERT INTO magic_links (token_hash, email, expires_at) VALUES (?, 'redir@example.com', datetime('now', '+15 minutes'))").run(tokenHash);

  const r = await worker.fetch(req(`/api/auth/callback?token=${rawToken}&redirect=/app`), env);
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("Location"), "/app");
  assert.ok(r.headers.get("Set-Cookie").includes("appcaptures_session="));
}

console.log("auth: all assertions passed");
