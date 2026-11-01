// Unit and integration tests for Web-Only Stripe Checkout, Portal & Webhook (AC-013)
// Run: node tests/stripe.mjs

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
import path from "node:path";
import worker from "../worker.js";
import { verifyStripeSignature, STRIPE_PRODUCTS } from "../engine/stripe.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const schemaSql = readFileSync(path.join(root, "schema-saas.sql"), "utf8");

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

async function createTestUserAndSession(db, email = "stripe_user@example.com", plan = "free", stripeCustomerId = null) {
  const userId = crypto.randomUUID();
  db.rawDb.prepare(
    "INSERT INTO users (id, email, name, status, plan, stripe_customer_id, created_at, last_login_at) VALUES (?, ?, ?, 'active', ?, ?, datetime('now'), datetime('now'))"
  ).run(userId, email, "Stripe Test User", plan, stripeCustomerId);

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

const post = (url, body, env, headers = {}) => {
  const ip = headers["CF-Connecting-IP"] || `10.0.2.${ipCounter++}`;
  const isString = typeof body === "string";
  return worker.fetch(
    req(url, {
      method: "POST",
      headers: {
        ...(isString ? { "Content-Type": "application/json" } : { "Content-Type": "application/json" }),
        "CF-Connecting-IP": ip,
        ...headers,
      },
      body: isString ? body : JSON.stringify(body),
    }),
    env
  );
};

const get = (url, env, headers = {}) => {
  const ip = headers["CF-Connecting-IP"] || `10.0.2.${ipCounter++}`;
  return worker.fetch(
    req(url, {
      method: "GET",
      headers: { "CF-Connecting-IP": ip, ...headers },
    }),
    env
  );
};

async function generateStripeSignature(rawBody, secret, timestampSec = null) {
  const t = timestampSec !== null ? timestampSec : Math.floor(Date.now() / 1000);
  const payload = `${t}.${rawBody}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBytes = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  const hex = Array.from(new Uint8Array(sigBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `t=${t},v1=${hex}`;
}

const TEST_WEBHOOK_SECRET = "whsec_test_mock_secret_appcaptures_123";

// =============================================================================
// Test Suite 1: GET /api/billing/products
// =============================================================================
{
  const db = createD1();
  const env = { DB: db };

  let r = await get("/api/billing/products", env);
  assert.equal(r.status, 200);
  let b = await r.json();
  assert.equal(b.ok, true);
  assert.equal(Array.isArray(b.products), true);
  assert.equal(b.products.length, 5);

  const ids = b.products.map((p) => p.id);
  assert.ok(ids.includes("lifetime"));
  assert.ok(ids.includes("pro_monthly"));
  assert.ok(ids.includes("pro_yearly"));
  assert.ok(ids.includes("credits_100"));
  assert.ok(ids.includes("credits_500"));

  // Check pricing
  const lifetime = b.products.find((p) => p.id === "lifetime");
  assert.equal(lifetime.amount_cents, 1900);
  assert.equal(lifetime.credits_granted, 50);

  const pro = b.products.find((p) => p.id === "pro_monthly");
  assert.equal(pro.amount_cents, 900);
  assert.equal(pro.credits_granted, 250);

  // Both path aliases work
  r = await get("/api/stripe/products", env);
  assert.equal(r.status, 200);
}

// =============================================================================
// Test Suite 2: POST /api/stripe/checkout Session Creation
// =============================================================================
{
  const db = createD1();
  const user = await createTestUserAndSession(db, "checkout@example.com", "free");

  // 1. Unauthorized without session cookie returns 401
  let r = await post("/api/stripe/checkout", { product: "lifetime" }, { DB: db });
  assert.equal(r.status, 401);

  // 2. Unconfigured stripe returns 400
  r = await post("/api/stripe/checkout", { product: "lifetime" }, { DB: db }, { Cookie: user.cookie });
  assert.equal(r.status, 400);
  let b = await r.json();
  assert.match(b.error, /stripe not configured/i);

  // 3. Mock Stripe mode returns valid checkout URL
  const mockEnv = { DB: db, MOCK_STRIPE: "true" };
  r = await post("/api/stripe/checkout", { product: "lifetime" }, mockEnv, { Cookie: user.cookie });
  assert.equal(r.status, 200);
  b = await r.json();
  assert.equal(b.ok, true);
  assert.equal(b.product, "lifetime");
  assert.ok(b.url.startsWith("https://checkout.stripe.com/"));
  assert.ok(b.id.startsWith("cs_test_"));

  // 4. Pro Monthly checkout
  r = await post("/api/stripe/checkout", { product: "pro_monthly" }, mockEnv, { Cookie: user.cookie });
  assert.equal(r.status, 200);
  b = await r.json();
  assert.equal(b.product, "pro_monthly");

  // 5. Alias /api/billing/checkout also works
  r = await post("/api/billing/checkout", { product: "credits_100" }, mockEnv, { Cookie: user.cookie });
  assert.equal(r.status, 200);
  b = await r.json();
  assert.equal(b.product, "credits_100");
}

// =============================================================================
// Test Suite 3: Customer Portal Session Creation (/api/stripe/portal)
// =============================================================================
{
  const db = createD1();
  const mockEnv = { DB: db, MOCK_STRIPE: "true" };

  // 1. User without customer ID cannot open portal (returns 400)
  const userNoBilling = await createTestUserAndSession(db, "nobilling@example.com", "free", null);
  let r = await post("/api/stripe/portal", {}, mockEnv, { Cookie: userNoBilling.cookie });
  assert.equal(r.status, 400);
  let b = await r.json();
  assert.match(b.error, /no active billing account/i);

  // 2. User with customer ID gets portal session URL
  const userWithBilling = await createTestUserAndSession(db, "hasbilling@example.com", "pro", "cus_test_cust_123");
  r = await post("/api/stripe/portal", {}, mockEnv, { Cookie: userWithBilling.cookie });
  assert.equal(r.status, 200);
  b = await r.json();
  assert.equal(b.ok, true);
  assert.ok(b.url.startsWith("https://billing.stripe.com/"));

  // 3. Alias /api/billing/portal works
  r = await post("/api/billing/portal", {}, mockEnv, { Cookie: userWithBilling.cookie });
  assert.equal(r.status, 200);
}

// =============================================================================
// Test Suite 4: Webhook Signature Verification
// =============================================================================
{
  const db = createD1();
  const env = { DB: db, STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET };
  const payload = JSON.stringify({ id: "evt_sig_test", type: "ping", data: {} });

  // 1. Missing signature header returns 400
  let r = await post("/api/stripe/webhook", payload, env);
  assert.equal(r.status, 400);
  let b = await r.json();
  assert.equal(b.error, "invalid signature");

  // 2. Invalid signature returns 400
  r = await post("/api/stripe/webhook", payload, env, {
    "Stripe-Signature": `t=${Math.floor(Date.now() / 1000)},v1=bad_signature_hex_12345`,
  });
  assert.equal(r.status, 400);

  // 3. Expired timestamp (> 300s old) returns 400
  const expiredTime = Math.floor(Date.now() / 1000) - 500;
  const expiredSig = await generateStripeSignature(payload, TEST_WEBHOOK_SECRET, expiredTime);
  r = await post("/api/stripe/webhook", payload, env, {
    "Stripe-Signature": expiredSig,
  });
  assert.equal(r.status, 400);

  // 4. Valid signature returns 200
  const validSig = await generateStripeSignature(payload, TEST_WEBHOOK_SECRET);
  r = await post("/api/stripe/webhook", payload, env, {
    "Stripe-Signature": validSig,
  });
  assert.equal(r.status, 200);
  b = await r.json();
  assert.equal(b.ok, true);
}

// =============================================================================
// Test Suite 5: Webhook checkout.session.completed (Lifetime Pass)
// =============================================================================
{
  const db = createD1();
  const env = { DB: db, STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET };
  const user = await createTestUserAndSession(db, "buyer_lifetime@example.com", "free");

  // Fetch initial credits (triggers 5 welcome credits)
  let meRes = await get("/api/me", env, { Cookie: user.cookie });
  assert.equal((await meRes.json()).credits.balance, 5);

  const eventPayload = {
    id: "evt_lifetime_purchase_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_session_lifetime_999",
        customer: "cus_customer_lifetime_999",
        amount_total: 1900,
        client_reference_id: user.userId,
        metadata: {
          userId: user.userId,
          productId: "lifetime",
        },
      },
    },
  };

  const rawBody = JSON.stringify(eventPayload);
  const signature = await generateStripeSignature(rawBody, TEST_WEBHOOK_SECRET);

  let r = await post("/api/stripe/webhook", rawBody, env, { "Stripe-Signature": signature });
  assert.equal(r.status, 200);
  let b = await r.json();
  assert.equal(b.ok, true);
  assert.equal(b.processed, true);

  // Verify User updated
  const userRow = db.rawDb.prepare("SELECT plan, stripe_customer_id FROM users WHERE id = ?").get(user.userId);
  assert.equal(userRow.plan, "lifetime", "User plan must upgrade to lifetime");
  assert.equal(userRow.stripe_customer_id, "cus_customer_lifetime_999");

  // Verify Purchases table
  const purchaseRow = db.rawDb.prepare("SELECT * FROM purchases WHERE user_id = ?").get(user.userId);
  assert.ok(purchaseRow, "Purchase record must exist");
  assert.equal(purchaseRow.product, "lifetime");
  assert.equal(purchaseRow.amount_cents, 1900);
  assert.equal(purchaseRow.stripe_session_id, "cs_session_lifetime_999");

  // Verify Credits granted (+50 credits, balance becomes 55)
  meRes = await get("/api/me", env, { Cookie: user.cookie });
  const credits = (await meRes.json()).credits;
  assert.equal(credits.balance, 55, "User balance must be 5 initial + 50 granted = 55");
}

// =============================================================================
// Test Suite 6: Webhook checkout.session.completed (Pro Subscription & Renewal)
// =============================================================================
{
  const db = createD1();
  const env = { DB: db, STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET };
  const user = await createTestUserAndSession(db, "buyer_pro@example.com", "free");

  // Initial welcome credits
  await get("/api/me", env, { Cookie: user.cookie });

  const eventPayload = {
    id: "evt_pro_sub_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_session_pro_888",
        customer: "cus_customer_pro_888",
        amount_total: 900,
        metadata: {
          userId: user.userId,
          productId: "pro_monthly",
        },
      },
    },
  };

  const rawBody = JSON.stringify(eventPayload);
  const signature = await generateStripeSignature(rawBody, TEST_WEBHOOK_SECRET);

  let r = await post("/api/stripe/webhook", rawBody, env, { "Stripe-Signature": signature });
  assert.equal(r.status, 200);

  // User plan is now pro
  let userRow = db.rawDb.prepare("SELECT plan, stripe_customer_id FROM users WHERE id = ?").get(user.userId);
  assert.equal(userRow.plan, "pro");
  assert.equal(userRow.stripe_customer_id, "cus_customer_pro_888");

  // Balance: 5 initial + 250 pro grant = 255
  let meRes = await get("/api/me", env, { Cookie: user.cookie });
  assert.equal((await meRes.json()).credits.balance, 255);

  // Monthly Renewal: invoice.payment_succeeded
  const renewalPayload = {
    id: "evt_invoice_renew_1",
    type: "invoice.payment_succeeded",
    data: {
      object: {
        id: "in_renew_777",
        customer: "cus_customer_pro_888",
        billing_reason: "subscription_cycle",
      },
    },
  };

  const renewalBody = JSON.stringify(renewalPayload);
  const renewalSig = await generateStripeSignature(renewalBody, TEST_WEBHOOK_SECRET);
  r = await post("/api/stripe/webhook", renewalBody, env, { "Stripe-Signature": renewalSig });
  assert.equal(r.status, 200);

  // Balance: 255 + 250 renewal = 505
  meRes = await get("/api/me", env, { Cookie: user.cookie });
  assert.equal((await meRes.json()).credits.balance, 505);

  // Subscription Cancellation: customer.subscription.deleted
  const cancelPayload = {
    id: "evt_sub_deleted_1",
    type: "customer.subscription.deleted",
    data: {
      object: {
        customer: "cus_customer_pro_888",
      },
    },
  };

  const cancelBody = JSON.stringify(cancelPayload);
  const cancelSig = await generateStripeSignature(cancelBody, TEST_WEBHOOK_SECRET);
  r = await post("/api/stripe/webhook", cancelBody, env, { "Stripe-Signature": cancelSig });
  assert.equal(r.status, 200);

  // Plan reverts to free
  userRow = db.rawDb.prepare("SELECT plan FROM users WHERE id = ?").get(user.userId);
  assert.equal(userRow.plan, "free", "Plan must revert to free after subscription deletion");
}

// =============================================================================
// Test Suite 7: Webhook Idempotency (Replay Attack / Duplicate Event Protection)
// =============================================================================
{
  const db = createD1();
  const env = { DB: db, STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET };
  const user = await createTestUserAndSession(db, "idempotent@example.com", "free");
  await get("/api/me", env, { Cookie: user.cookie });

  const eventPayload = {
    id: "evt_duplicate_id_test_100",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_duplicate_session_100",
        customer: "cus_dup_100",
        amount_total: 499,
        metadata: {
          userId: user.userId,
          productId: "credits_100",
        },
      },
    },
  };

  const rawBody = JSON.stringify(eventPayload);
  const signature = await generateStripeSignature(rawBody, TEST_WEBHOOK_SECRET);

  // 1st delivery
  let r = await post("/api/stripe/webhook", rawBody, env, { "Stripe-Signature": signature });
  assert.equal(r.status, 200);
  let b = await r.json();
  assert.equal(b.ok, true);
  assert.equal(b.processed, true);

  // Balance: 5 + 100 = 105
  let meRes = await get("/api/me", env, { Cookie: user.cookie });
  assert.equal((await meRes.json()).credits.balance, 105);

  // Exactly 1 purchase record
  let purchaseCount = db.rawDb.prepare("SELECT COUNT(*) AS c FROM purchases WHERE user_id = ?").get(user.userId).c;
  assert.equal(purchaseCount, 1);

  // 2nd delivery (identical event ID)
  r = await post("/api/stripe/webhook", rawBody, env, { "Stripe-Signature": signature });
  assert.equal(r.status, 200);
  b = await r.json();
  assert.equal(b.ok, true);
  assert.equal(b.duplicate, true, "Duplicate event must return duplicate: true");

  // 3rd delivery
  r = await post("/api/stripe/webhook", rawBody, env, { "Stripe-Signature": signature });
  assert.equal(r.status, 200);
  b = await r.json();
  assert.equal(b.duplicate, true);

  // Balance MUST STILL BE 105 (no duplicate credit grant!)
  meRes = await get("/api/me", env, { Cookie: user.cookie });
  assert.equal((await meRes.json()).credits.balance, 105);

  // Purchases table MUST STILL HAVE EXACTLY 1 ROW
  purchaseCount = db.rawDb.prepare("SELECT COUNT(*) AS c FROM purchases WHERE user_id = ?").get(user.userId).c;
  assert.equal(purchaseCount, 1);

  // Exactly 1 row in stripe_events
  const eventRows = db.rawDb.prepare("SELECT COUNT(*) AS c FROM stripe_events WHERE id = ?").get("evt_duplicate_id_test_100").c;
  assert.equal(eventRows, 1);
}

// =============================================================================
// Test Suite 8: Billing Rate Limits
// =============================================================================
{
  const db = createD1();
  const mockEnv = { DB: db, MOCK_STRIPE: "true" };
  const user = await createTestUserAndSession(db, "ratelimit_billing@example.com", "free");

  const fixedIp = "192.168.1.99";
  let lastStatus = 200;

  // 20 requests allowed per 10 minutes (billing limit: 20)
  for (let i = 0; i < 20; i++) {
    const res = await post("/api/stripe/checkout", { product: "lifetime" }, mockEnv, {
      Cookie: user.cookie,
      "CF-Connecting-IP": fixedIp,
    });
    assert.equal(res.status, 200);
  }

  // 21st request triggers 429 Rate Limit
  const blocked = await post("/api/stripe/checkout", { product: "lifetime" }, mockEnv, {
    Cookie: user.cookie,
    "CF-Connecting-IP": fixedIp,
  });
  assert.equal(blocked.status, 429);
  const body = await blocked.json();
  assert.equal(body.error, "too many requests");
}

console.log("stripe: all assertions passed");
