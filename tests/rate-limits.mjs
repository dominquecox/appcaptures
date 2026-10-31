// Rate limiting unit tests (SPEC Section 3.3, AC-006)
// Run: node tests/rate-limits.mjs

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
import path from "node:path";
import worker from "../worker.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const schemaSql = readFileSync(path.join(root, "schema.sql"), "utf8");
const schemaSaasSql = readFileSync(path.join(root, "schema-saas.sql"), "utf8");

function createD1() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schemaSql);
  db.exec(schemaSaasSql);

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
          stmt.run(...this._bindings);
          return { success: true };
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

const req = (url, init = {}) => new Request(`https://appcaptures.com${url}`, init);

const post = (url, body, env, ip = "127.0.0.1", headers = {}) =>
  worker.fetch(
    req(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": ip,
        ...headers,
      },
      body: JSON.stringify(body),
    }),
    env
  );

// --- 1. POST /api/auth/magic-link: 5 allowed, 6th returns 429 ---
{
  worker.resetRateLimits();
  const db = createD1();
  const env = { DB: db };
  const clientIp = "192.168.10.1";

  for (let i = 1; i <= 5; i++) {
    const r = await post("/api/auth/magic-link", { email: `user${i}@example.com` }, env, clientIp);
    assert.equal(r.status, 200, `Request ${i} must succeed with 200`);
    const b = await r.json();
    assert.deepEqual(b, { ok: true });
  }

  // 6th request exceeds limit (5 per 10m)
  const r6 = await post("/api/auth/magic-link", { email: "user6@example.com" }, env, clientIp);
  assert.equal(r6.status, 429, "6th request must return 429");
  const b6 = await r6.json();
  assert.equal(b6.error, "too many requests");
  assert.ok(typeof b6.retryAfter === "number" && b6.retryAfter > 0, "retryAfter must be positive number");
  assert.equal(r6.headers.get("Retry-After"), String(b6.retryAfter), "Retry-After header must match body");
  assert.equal(r6.headers.get("Cache-Control"), "no-store", "429 must include no-store header");
}

// --- 2. POST /api/waitlist: 10 allowed, 11th returns 429 ---
{
  worker.resetRateLimits();
  const db = createD1();
  const env = { DB: db };
  const clientIp = "192.168.10.2";

  for (let i = 1; i <= 10; i++) {
    const r = await post("/api/waitlist", { email: `waitlist${i}@example.com` }, env, clientIp);
    assert.equal(r.status, 200, `Request ${i} must succeed with 200`);
    const b = await r.json();
    assert.equal(b.ok, true);
  }

  // 11th request exceeds limit (10 per 10m)
  const r11 = await post("/api/waitlist", { email: "waitlist11@example.com" }, env, clientIp);
  assert.equal(r11.status, 429, "11th request must return 429");
  const b11 = await r11.json();
  assert.equal(b11.error, "too many requests");
  assert.ok(typeof b11.retryAfter === "number" && b11.retryAfter > 0);
  assert.equal(r11.headers.get("Retry-After"), String(b11.retryAfter));
}

// --- 3. POST /api/listing/generate (tier ai: 20 per 3600s) ---
{
  worker.resetRateLimits();
  const env = {};
  const clientIp = "192.168.10.3";

  for (let i = 1; i <= 20; i++) {
    const r = await post(
      "/api/listing/generate",
      { appId: "vidiloop", screenshots: ["shot1.png"], locale: "en-US" },
      env,
      clientIp
    );
    assert.equal(r.status, 501, `Request ${i} passes rate limit (returns 501 because AI binding not configured)`);
  }

  // 21st request exceeds limit (20 per hour)
  const r21 = await post(
    "/api/listing/generate",
    { appId: "vidiloop", screenshots: ["shot1.png"], locale: "en-US" },
    env,
    clientIp
  );
  assert.equal(r21.status, 429, "21st request must return 429");
  const b21 = await r21.json();
  assert.equal(b21.error, "too many requests");
  assert.ok(typeof b21.retryAfter === "number" && b21.retryAfter > 0);
  assert.equal(r21.headers.get("Retry-After"), String(b21.retryAfter));
}

// --- 4. POST /api/exports (tier render_export: 30 per 60s) ---
{
  worker.resetRateLimits();
  const queueItems = [];
  const env = { EXPORT_QUEUE: { send: async (m) => queueItems.push(m) } };
  const clientIp = "192.168.10.4";

  for (let i = 1; i <= 30; i++) {
    const r = await post(
      "/api/exports",
      { appId: "vidiloop", size: "1320x2868", screens: [{}] },
      env,
      clientIp
    );
    assert.equal(r.status, 200, `Request ${i} must succeed with 200`);
    const b = await r.json();
    assert.equal(b.ok, true);
    assert.equal(b.status, "queued");
  }
  assert.equal(queueItems.length, 30);

  // 31st request exceeds limit (30 per minute)
  const r31 = await post(
    "/api/exports",
    { appId: "vidiloop", size: "1320x2868", screens: [{}] },
    env,
    clientIp
  );
  assert.equal(r31.status, 429, "31st request must return 429");
  const b31 = await r31.json();
  assert.equal(b31.error, "too many requests");
  assert.ok(typeof b31.retryAfter === "number" && b31.retryAfter > 0);
  assert.equal(r31.headers.get("Retry-After"), String(b31.retryAfter));
}

// --- 5. Different IPs have independent rate limit buckets ---
{
  worker.resetRateLimits();
  const db = createD1();
  const env = { DB: db };
  const ipA = "10.0.0.1";
  const ipB = "10.0.0.2";

  // Exhaust IP A
  for (let i = 1; i <= 5; i++) {
    const r = await post("/api/auth/magic-link", { email: "shared@example.com" }, env, ipA);
    assert.equal(r.status, 200);
  }
  const rA6 = await post("/api/auth/magic-link", { email: "shared@example.com" }, env, ipA);
  assert.equal(rA6.status, 429, "IP A must be rate limited on 6th request");

  // IP B has fresh bucket and is unaffected
  for (let i = 1; i <= 5; i++) {
    const r = await post("/api/auth/magic-link", { email: "shared@example.com" }, env, ipB);
    assert.equal(r.status, 200, `IP B request ${i} must succeed independently`);
  }
  const rB6 = await post("/api/auth/magic-link", { email: "shared@example.com" }, env, ipB);
  assert.equal(rB6.status, 429, "IP B must be rate limited on its own 6th request");
}

// --- 6. Sliding window expiration: advancing mock time resets count ---
{
  worker.resetRateLimits();
  const db = createD1();
  let fakeTime = 1700000000000;
  const env = { DB: db, __now: () => fakeTime };
  const clientIp = "192.168.20.1";

  // Exhaust 5 requests at fakeTime
  for (let i = 1; i <= 5; i++) {
    const r = await post("/api/auth/magic-link", { email: "time@example.com" }, env, clientIp);
    assert.equal(r.status, 200);
  }
  let r = await post("/api/auth/magic-link", { email: "time@example.com" }, env, clientIp);
  assert.equal(r.status, 429);

  // Advance time past period (600s + 1s = 601s)
  fakeTime += 601 * 1000;

  // Sliding window should expire all previous timestamps and allow new requests
  r = await post("/api/auth/magic-link", { email: "time@example.com" }, env, clientIp);
  assert.equal(r.status, 200, "Request must succeed after sliding window period expires");
}

// --- 7. Cloudflare Rate Limiter binding integration (env.RATE_LIMITER) ---
{
  worker.resetRateLimits();
  const db = createD1();
  let shouldAllow = true;
  let recordedKey = null;

  const mockLimiter = {
    async limit({ key }) {
      recordedKey = key;
      return { success: shouldAllow, retryAfter: 42 };
    },
  };

  const env = { DB: db, RATE_LIMITER: mockLimiter };

  // When binding returns success: true
  let r = await post("/api/auth/magic-link", { email: "limiter@example.com" }, env, "192.168.30.1");
  assert.equal(r.status, 200);
  assert.equal(recordedKey, "auth:192.168.30.1");

  // When binding returns success: false
  shouldAllow = false;
  r = await post("/api/auth/magic-link", { email: "limiter@example.com" }, env, "192.168.30.1");
  assert.equal(r.status, 429);
  const b = await r.json();
  assert.equal(b.retryAfter, 42);
  assert.equal(r.headers.get("Retry-After"), "42");
}

// --- 8. Authenticated session user ID rate limiting ---
{
  worker.resetRateLimits();
  const db = createD1();
  const queueItems = [];
  const env = {
    DB: db,
    EXPORT_QUEUE: { send: async (m) => queueItems.push(m) },
  };

  // Create user & session in DB
  const userId = "usr_test_1234";
  const rawToken = "session_token_xyz_98765432101234567890";
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(rawToken));
  const tokenHash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");

  db.rawDb.prepare("INSERT INTO users (id, email, status, plan) VALUES (?, ?, 'active', 'free')").run(userId, "auth_user@example.com");
  db.rawDb.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, datetime('now', '+30 days'))").run("sess_1", userId, tokenHash);

  const cookieHeader = `appcaptures_session=${rawToken}`;

  // Make 30 exports from roaming IPs under the same user session
  for (let i = 1; i <= 30; i++) {
    const roamingIp = `10.200.${Math.floor(i / 10)}.${i % 10}`;
    const r = await post(
      "/api/exports",
      { appId: "vidiloop", size: "1320x2868", screens: [{}] },
      env,
      roamingIp,
      { cookie: cookieHeader }
    );
    assert.equal(r.status, 200, `User export ${i} should succeed`);
  }

  // 31st export from yet another IP fails because user quota (render_export: 30) is exhausted
  const r31 = await post(
    "/api/exports",
    { appId: "vidiloop", size: "1320x2868", screens: [{}] },
    env,
    "172.16.0.99",
    { cookie: cookieHeader }
  );
  assert.equal(r31.status, 429, "31st export for the same user ID must return 429 across different IPs");
}

console.log("rate-limits: all assertions passed");
