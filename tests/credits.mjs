// Unit and integration tests for Credit Ledger, Usage Metering & 402 Paywall (AC-012)
// Run: node tests/credits.mjs

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
import path from "node:path";
import worker from "../worker.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const schemaSql = readFileSync(path.join(root, "schema-saas.sql"), "utf8");

// D1 wrapper backed by Node 22 DatabaseSync in-memory SQLite
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

let ipCounter = 1;
const req = (url, init) => new Request(`https://appcaptures.com${url}`, init);

async function createTestUserAndSession(db, email = "user@example.com", plan = "free", name = "Test User") {
  const userId = crypto.randomUUID();
  db.rawDb.prepare(
    "INSERT INTO users (id, email, name, status, plan, created_at, last_login_at) VALUES (?, ?, ?, 'active', ?, datetime('now'), datetime('now'))"
  ).run(userId, email, name, plan);

  const rawToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(rawToken));
  const tokenHash = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const sessionId = crypto.randomUUID();
  db.rawDb.prepare(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, datetime('now', '+30 days'))"
  ).run(sessionId, userId, tokenHash);

  const cookie = `appcaptures_session=${rawToken}`;
  return { userId, cookie, rawToken };
}

function createTestProject(db, userId, name = "Habit Tracker") {
  const projectId = crypto.randomUUID();
  db.rawDb.prepare(
    "INSERT INTO projects (id, user_id, name, platforms_json, brand_json) VALUES (?, ?, ?, '[\"ios\"]', '{\"name\":\"Habit Tracker\",\"bg\":\"#0b0f19\",\"primary\":\"#6366f1\"}')"
  ).run(projectId, userId, name);
  return projectId;
}

const post = (url, body, env, headers = {}) => {
  const ip = headers["CF-Connecting-IP"] || `10.0.1.${ipCounter++}`;
  return worker.fetch(
    req(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip, ...headers },
      body: JSON.stringify(body),
    }),
    env
  );
};

const get = (url, env, headers = {}) => {
  const ip = headers["CF-Connecting-IP"] || `10.0.1.${ipCounter++}`;
  return worker.fetch(
    req(url, {
      method: "GET",
      headers: { "CF-Connecting-IP": ip, ...headers },
    }),
    env
  );
};

const DOWNLOAD_SECRET = "export-credits-test-download-secret-v1";

// =============================================================================
// Test Suite 1: Welcome Bonus & /api/me Credit Info
// =============================================================================
{
  const db = createD1();
  const env = { DB: db };
  const user = await createTestUserAndSession(db, "welcome@example.com", "free");

  // Initial GET /api/me triggers 5 welcome credits
  let r = await get("/api/me", env, { Cookie: user.cookie });
  assert.equal(r.status, 200);
  let b = await r.json();
  assert.equal(b.ok, true);
  assert.equal(b.user.email, "welcome@example.com");
  assert.equal(b.credits.balance, 5, "New user must start with 5 welcome credits");
  assert.equal(b.credits.lifetime_granted, 5);
  assert.equal(b.credits.lifetime_spent, 0);

  // Credit ledger row created
  const ledgerRows = db.rawDb.prepare("SELECT * FROM credit_ledger WHERE user_id = ?").all(user.userId);
  assert.equal(ledgerRows.length, 1);
  assert.equal(ledgerRows[0].delta, 5);
  assert.equal(ledgerRows[0].reason, "welcome_bonus");
}

// =============================================================================
// Test Suite 2: GET /api/credits Endpoint
// =============================================================================
{
  const db = createD1();
  const env = { DB: db };

  // Unauthorized without session returns 401
  let r = await get("/api/credits", env);
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), { error: "unauthorized" });

  // Authorized user
  const user = await createTestUserAndSession(db, "credits@example.com", "free");
  r = await get("/api/credits", env, { Cookie: user.cookie });
  assert.equal(r.status, 200);
  let b = await r.json();
  assert.equal(b.ok, true);
  assert.equal(b.balance, 5);
  assert.equal(b.lifetime_granted, 5);
  assert.equal(b.lifetime_spent, 0);
  assert.equal(Array.isArray(b.history), true);
  assert.equal(b.history.length, 1);
  assert.equal(b.history[0].delta, 5);
  assert.equal(b.history[0].reason, "welcome_bonus");
}

// =============================================================================
// Test Suite 3: Metering on AI Listing Generation (/api/listing/generate)
// =============================================================================
{
  const db = createD1();
  const env = { DB: db, MOCK_AI: "true" };
  const user = await createTestUserAndSession(db, "ailisting@example.com", "free");
  const projectId = createTestProject(db, user.userId, "Fitness Pro");

  // Call /api/listing/generate
  let r = await post(
    "/api/listing/generate",
    { projectId, store: "ios", locale: "en-US", appName: "Fitness Pro" },
    env,
    { Cookie: user.cookie }
  );
  assert.equal(r.status, 200);
  let b = await r.json();
  assert.equal(b.ok, true);
  assert.equal(b.credits_remaining, 4, "Credit balance must decrement to 4");

  // Verify credit ledger updated
  r = await get("/api/credits", env, { Cookie: user.cookie });
  b = await r.json();
  assert.equal(b.balance, 4);
  assert.equal(b.lifetime_spent, 1);

  const deductions = db.rawDb.prepare(
    "SELECT * FROM credit_ledger WHERE user_id = ? AND reason = 'ai_listing'"
  ).all(user.userId);
  assert.equal(deductions.length, 1);
  assert.equal(deductions[0].delta, -1);
  assert.equal(deductions[0].ref, projectId);
}

// =============================================================================
// Test Suite 4: Metering on AI Social Post Generation (/api/post/generate)
// =============================================================================
{
  const db = createD1();
  const env = { DB: db, MOCK_AI: "true" };
  const user = await createTestUserAndSession(db, "aipost@example.com", "free");
  const projectId = createTestProject(db, user.userId, "Social App");

  // Call /api/post/generate
  let r = await post(
    "/api/post/generate",
    { projectId, platforms: ["twitter", "linkedin"], tone: "launch" },
    env,
    { Cookie: user.cookie }
  );
  assert.equal(r.status, 200);
  let b = await r.json();
  assert.equal(b.ok, true);

  // Balance was 5 -> now 4
  r = await get("/api/credits", env, { Cookie: user.cookie });
  b = await r.json();
  assert.equal(b.balance, 4);
  assert.equal(b.lifetime_spent, 1);

  const deductions = db.rawDb.prepare(
    "SELECT * FROM credit_ledger WHERE user_id = ? AND reason = 'ai_post'"
  ).all(user.userId);
  assert.equal(deductions.length, 1);
  assert.equal(deductions[0].delta, -1);
  assert.equal(deductions[0].ref, projectId);
}

// =============================================================================
// Test Suite 5: Metering on Exports for Free Tier & Pro Bypass
// =============================================================================
{
  const db = createD1();
  const env = { DB: db, DOWNLOAD_SECRET };

  // Free User
  const freeUser = await createTestUserAndSession(db, "exportfree@example.com", "free");
  const freeProjId = createTestProject(db, freeUser.userId, "Free Export App");

  let r = await post("/api/exports", { projectId: freeProjId, store: "ios" }, env, { Cookie: freeUser.cookie });
  assert.equal(r.status, 200);
  let b = await r.json();
  assert.equal(b.ok, true);

  // Free user had 1 credit deducted
  r = await get("/api/credits", env, { Cookie: freeUser.cookie });
  b = await r.json();
  assert.equal(b.balance, 4);
  assert.equal(b.lifetime_spent, 1);

  // Pro User
  const proUser = await createTestUserAndSession(db, "exportpro@example.com", "pro");
  const proProjId = createTestProject(db, proUser.userId, "Pro Export App");

  r = await post("/api/exports", { projectId: proProjId, store: "ios" }, env, { Cookie: proUser.cookie });
  assert.equal(r.status, 200);
  b = await r.json();
  assert.equal(b.ok, true);

  // Pro user had 0 credits deducted on export (unlimited exports)
  r = await get("/api/credits", env, { Cookie: proUser.cookie });
  b = await r.json();
  assert.equal(b.balance, 5, "Pro user exports must not deduct credits");
  assert.equal(b.lifetime_spent, 0);
}

// =============================================================================
// Test Suite 6: Credit Exhaustion & HTTP 402 Payment Required Paywall
// =============================================================================
{
  const db = createD1();
  const env = { DB: db, MOCK_AI: "true", DOWNLOAD_SECRET };
  const user = await createTestUserAndSession(db, "depleted@example.com", "free");
  const projectId = createTestProject(db, user.userId, "Depleted App");

  // Spend all 5 credits by running 5 operations
  for (let i = 0; i < 5; i++) {
    const res = await post(
      "/api/listing/generate",
      { projectId, store: "ios", locale: "en-US", appName: "Depleted App" },
      env,
      { Cookie: user.cookie }
    );
    assert.equal(res.status, 200);
  }

  // Balance is now exactly 0
  let r = await get("/api/credits", env, { Cookie: user.cookie });
  let b = await r.json();
  assert.equal(b.balance, 0, "Balance must be 0 after 5 deductions");
  assert.equal(b.lifetime_spent, 5);

  // 6th call to /api/listing/generate must return 402 Payment Required
  r = await post(
    "/api/listing/generate",
    { projectId, store: "ios", locale: "en-US", appName: "Depleted App" },
    env,
    { Cookie: user.cookie }
  );
  assert.equal(r.status, 402, "Zero balance must return HTTP 402");
  b = await r.json();
  assert.equal(b.error, "insufficient_credits");
  assert.equal(b.balance, 0);
  assert.equal(b.plan, "free");
  assert.equal(b.upgrade_url, "/#pricing");

  // 6th call to /api/post/generate must return 402
  r = await post(
    "/api/post/generate",
    { projectId, platforms: ["twitter"] },
    env,
    { Cookie: user.cookie }
  );
  assert.equal(r.status, 402);
  b = await r.json();
  assert.equal(b.error, "insufficient_credits");

  // 6th call to /api/exports must return 402
  r = await post(
    "/api/exports",
    { projectId, store: "ios" },
    env,
    { Cookie: user.cookie }
  );
  assert.equal(r.status, 402);
  b = await r.json();
  assert.equal(b.error, "insufficient_credits");
}

// =============================================================================
// Test Suite 7: Admin Credit Grants (/api/admin/credits)
// =============================================================================
{
  const db = createD1();
  const env = { DB: db, ADMIN_TOKEN: "adm_secret_token" };
  const user = await createTestUserAndSession(db, "adminuser@example.com", "free");
  await get("/api/me", env, { Cookie: user.cookie });

  // Unauthorized without admin header returns 403
  let r = await post("/api/admin/credits", { userId: user.userId, amount: 20 }, env);
  assert.equal(r.status, 403);
  assert.deepEqual(await r.json(), { error: "forbidden" });

  // Valid admin grant
  r = await post(
    "/api/admin/credits",
    { userId: user.userId, amount: 25, reason: "bonus_pack", ref: "support_ticket_12" },
    env,
    { "Authorization": "Bearer adm_secret_token" }
  );
  assert.equal(r.status, 200);
  let b = await r.json();
  assert.equal(b.ok, true);
  assert.equal(b.userId, user.userId);
  assert.equal(b.balance, 30, "5 initial + 25 admin grant = 30 credits");

  // Verify credit ledger
  r = await get("/api/credits", env, { Cookie: user.cookie });
  b = await r.json();
  assert.equal(b.balance, 30);
  assert.equal(b.lifetime_granted, 30);

  // Invalid payload validation
  r = await post(
    "/api/admin/credits",
    { userId: "", amount: 10 },
    env,
    { "Authorization": "Bearer adm_secret_token" }
  );
  assert.equal(r.status, 400);

  r = await post(
    "/api/admin/credits",
    { userId: user.userId, amount: 0 },
    env,
    { "Authorization": "Bearer adm_secret_token" }
  );
  assert.equal(r.status, 400);
}

// =============================================================================
// Test Suite 8: Automatic Refund on AI Generation Failure
// =============================================================================
{
  const db = createD1();
  // Provide environment where AI run throws to simulate upstream model error
  const env = {
    DB: db,
    AI: {
      run: async () => {
        throw new Error("Workers AI upstream 500 rate limit");
      },
    },
  };
  const user = await createTestUserAndSession(db, "refund@example.com", "free");
  const projectId = createTestProject(db, user.userId, "Refund App");

  // User starts with 5 credits
  let r = await get("/api/credits", env, { Cookie: user.cookie });
  let b = await r.json();
  assert.equal(b.balance, 5);

  // Call /api/listing/generate which will throw because AI throws
  let thrown = false;
  try {
    await post(
      "/api/listing/generate",
      { projectId, store: "ios", locale: "en-US", appName: "Refund App" },
      env,
      { Cookie: user.cookie }
    );
  } catch (err) {
    thrown = true;
  }
  assert.equal(thrown, true, "Upstream AI error must throw");

  // Verify that the 1 credit was refunded!
  r = await get("/api/credits", env, { Cookie: user.cookie });
  b = await r.json();
  assert.equal(b.balance, 5, "Credit must be refunded back to 5 on failure");

  const refundRows = db.rawDb.prepare(
    "SELECT * FROM credit_ledger WHERE user_id = ? AND reason = 'refund_ai_listing_failed'"
  ).all(user.userId);
  assert.equal(refundRows.length, 1);
  assert.equal(refundRows[0].delta, 1);
}

console.log("credits: all assertions passed");
