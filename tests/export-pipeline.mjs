// Automated test suite for Card AC-011: export pipeline
// Queue, R2, per-store ZIP with exact filenames, signed URLs, export-ready email, watermark on free
// Run: node tests/export-pipeline.mjs

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
import path from "node:path";
import worker from "../worker.js";
import { readZip } from "../engine/export-bundle.js";
import { checkDimensions, checkNoAlpha } from "../engine/render-loop.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const schemaSql = readFileSync(path.join(root, "schema-saas.sql"), "utf8");

// Test-only signing secret (>= 32 chars). Never use in production.
const TEST_DOWNLOAD_SECRET = "export-pipeline-test-download-secret-v1";

function envWith(extra = {}) {
  return { DOWNLOAD_SECRET: TEST_DOWNLOAD_SECRET, ...extra };
}

async function signDownloadTokenWithSecret(exportId, expiresAt, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const iso =
    typeof expiresAt === "string" && !expiresAt.includes("T")
      ? `${expiresAt.replace(" ", "T")}Z`
      : expiresAt;
  const expTs = typeof expiresAt === "number" ? expiresAt : Date.parse(iso);
  const payload = `${exportId}:${expTs}`;
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${expTs}.${hex}`;
}

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

async function createSession(d1, userId) {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const rawToken = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawToken));
  const tokenHash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const sessionId = crypto.randomUUID();

  d1.rawDb.prepare(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, datetime('now', '+30 days'))"
  ).run(sessionId, userId, tokenHash);

  return { rawToken, cookieHeader: `appcaptures_session=${rawToken}` };
}

const req = (url, init = {}) => new Request(`https://appcaptures.com${url}`, init);

const post = (url, body, env, cookie = "") =>
  worker.fetch(
    req(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
    env
  );

const get = (url, env, cookie = "") =>
  worker.fetch(
    req(url, {
      method: "GET",
      headers: cookie ? { Cookie: cookie } : {},
    }),
    env
  );

// =============================================================================
// Test Setup: Users, Projects, Screens, Listings
// =============================================================================
const d1 = createD1();

// User 1: Free Tier
const userFree = { id: "user-free-1", email: "free@example.com", name: "Free User", plan: "free", status: "active" };
d1.rawDb.prepare("INSERT INTO users (id, email, name, plan, status) VALUES (?, ?, ?, ?, ?)").run(
  userFree.id, userFree.email, userFree.name, userFree.plan, userFree.status
);
const sessionFree = await createSession(d1, userFree.id);

// User 2: Paid Tier (Pro)
const userPro = { id: "user-pro-2", email: "pro@example.com", name: "Pro User", plan: "pro", status: "active" };
d1.rawDb.prepare("INSERT INTO users (id, email, name, plan, status) VALUES (?, ?, ?, ?, ?)").run(
  userPro.id, userPro.email, userPro.name, userPro.plan, userPro.status
);
const sessionPro = await createSession(d1, userPro.id);

// User 3: Tenant 3 (Attacker / Other user)
const userOther = { id: "user-other-3", email: "other@example.com", name: "Other User", plan: "free", status: "active" };
d1.rawDb.prepare("INSERT INTO users (id, email, name, plan, status) VALUES (?, ?, ?, ?, ?)").run(
  userOther.id, userOther.email, userOther.name, userOther.plan, userOther.status
);
const sessionOther = await createSession(d1, userOther.id);

// Project 1 (Free User): Habit Tracker
const projectFree = {
  id: "proj-free-app",
  user_id: userFree.id,
  name: "HabitHero",
};
d1.rawDb.prepare("INSERT INTO projects (id, user_id, name) VALUES (?, ?, ?)").run(
  projectFree.id, projectFree.user_id, projectFree.name
);

// Screens for Project 1 (2 screens)
d1.rawDb.prepare("INSERT INTO screens (id, project_id, ord, headline, subhead) VALUES (?, ?, ?, ?, ?)").run(
  "screen-free-1", projectFree.id, 0, "Build Daily Streaks", "Stay consistent every day"
);
d1.rawDb.prepare("INSERT INTO screens (id, project_id, ord, headline, subhead) VALUES (?, ?, ?, ?, ?)").run(
  "screen-free-2", projectFree.id, 1, "Detailed Analytics", "Track growth over time"
);

// Listing for Project 1
d1.rawDb.prepare("INSERT INTO listings (id, project_id, store, fields_json) VALUES (?, ?, ?, ?)").run(
  "list-free-1", projectFree.id, "both", JSON.stringify({
    title: "HabitHero - Daily Habit Tracker",
    subtitle: "Build better habits every day",
    description: "The easiest way to build lasting habits with friends.",
    keywords: "habits,routine,streaks,productivity",
  })
);

// Project 2 (Pro User): Crypto Portfolio
const projectPro = {
  id: "proj-pro-app",
  user_id: userPro.id,
  name: "CryptoPulse",
};
d1.rawDb.prepare("INSERT INTO projects (id, user_id, name) VALUES (?, ?, ?)").run(
  projectPro.id, projectPro.user_id, projectPro.name
);
d1.rawDb.prepare("INSERT INTO screens (id, project_id, ord, headline, subhead) VALUES (?, ?, ?, ?, ?)").run(
  "screen-pro-1", projectPro.id, 0, "Real-Time Portfolio Tracking", "Instant balance sync"
);

// Archived Project
const projectArchived = {
  id: "proj-archived",
  user_id: userFree.id,
  name: "ArchivedApp",
};
d1.rawDb.prepare("INSERT INTO projects (id, user_id, name, archived_at) VALUES (?, ?, ?, datetime('now'))").run(
  projectArchived.id, projectArchived.user_id, projectArchived.name
);

// -----------------------------------------------------------------------------
// Test 1: Unauthenticated requests return 401
// -----------------------------------------------------------------------------
{
  const env = envWith({ DB: d1 });

  // POST without session cookie
  let r = await post("/api/exports", { projectId: projectFree.id }, env);
  assert.equal(r.status, 401, "Expected 401 for unauthenticated export creation");
  let b = await r.json();
  assert.equal(b.error, "unauthorized");

  // GET details without session cookie
  r = await get("/api/exports/some-id", env);
  assert.equal(r.status, 401, "Expected 401 for unauthenticated export detail fetch");

  // GET download without session cookie or token
  r = await get("/api/exports/some-id/download", env);
  assert.equal(r.status, 401, "Expected 401 for unauthenticated export download without token");
}

// -----------------------------------------------------------------------------
// Test 2: Cross-tenant requests return 404
// -----------------------------------------------------------------------------
{
  const env = envWith({ DB: d1 });

  // Other user trying to export Free user's project
  let r = await post("/api/exports", { projectId: projectFree.id }, env, sessionOther.cookieHeader);
  assert.equal(r.status, 404, "Cross-tenant export request must return 404");
  let b = await r.json();
  assert.equal(b.error, "project not found");

  // Export non-existent project returns 404
  r = await post("/api/exports", { projectId: "non-existent-proj" }, env, sessionFree.cookieHeader);
  assert.equal(r.status, 404, "Non-existent project must return 404");

  // Export archived project returns 404
  r = await post("/api/exports", { projectId: projectArchived.id }, env, sessionFree.cookieHeader);
  assert.equal(r.status, 404, "Archived project must return 404");
}

// -----------------------------------------------------------------------------
// Test 3: Free user gets watermarked: true
// -----------------------------------------------------------------------------
let freeExportId;
let freeDownloadUrl;
{
  const env = envWith({ DB: d1 });
  const r = await post("/api/exports", { projectId: projectFree.id, store: "both" }, env, sessionFree.cookieHeader);
  assert.equal(r.status, 200, "POST /api/exports should succeed");
  const b = await r.json();

  assert.equal(b.ok, true);
  assert.ok(b.exportId, "exportId must be present");
  assert.ok(b.downloadUrl, "downloadUrl must be present");
  assert.equal(b.watermarked, true, "Free tier must get watermarked: true");
  assert.equal(b.status, "ready");
  assert.ok(b.expiresAt || b.expires_at, "expiresAt must be returned");

  freeExportId = b.exportId;
  freeDownloadUrl = b.downloadUrl;

  // Verify D1 exports record
  const row = d1.rawDb.prepare("SELECT * FROM exports WHERE id = ?").get(freeExportId);
  assert.ok(row, "D1 exports row must be created");
  assert.equal(row.user_id, userFree.id);
  assert.equal(row.project_id, projectFree.id);
  assert.equal(row.kind, "zip");
  assert.equal(row.watermarked, 1, "D1 watermarked column must be 1 for free user");
  assert.equal(row.status, "ready");
  assert.ok(row.expires_at, "expires_at must be populated");
  assert.ok(row.r2_key.startsWith(`u/${userFree.id}/exports/`), "r2_key must match u/{userId}/exports/{id}.zip");

  // Verify 7-day expiration
  const expDiff = d1.rawDb.prepare(
    "SELECT (strftime('%s', expires_at) - strftime('%s', 'now')) AS diff_seconds FROM exports WHERE id = ?"
  ).get(freeExportId);
  assert.ok(expDiff.diff_seconds >= 6 * 86400 && expDiff.diff_seconds <= 8 * 86400, "Expiration must be ~7 days");
}

// -----------------------------------------------------------------------------
// Test 4: ZIP bundle contains structured store folders (ios/, android/, copy/)
// -----------------------------------------------------------------------------
{
  const env = envWith({ DB: d1 });

  // Download export via session cookie
  const r = await get(`/api/exports/${freeExportId}/download`, env, sessionFree.cookieHeader);
  assert.equal(r.status, 200, "Download must succeed with 200");
  assert.equal(r.headers.get("Content-Type"), "application/zip");
  assert.equal(
    r.headers.get("Content-Disposition"),
    'attachment; filename="habithero-store-assets.zip"'
  );

  const arrayBuffer = await r.arrayBuffer();
  assert.ok(arrayBuffer.byteLength > 1000, "ZIP buffer must be non-empty");

  const zipEntries = readZip(new Uint8Array(arrayBuffer));

  // Check structured store folders
  const fileNames = Array.from(zipEntries.keys());

  // iOS folder assets
  assert.ok(fileNames.includes("ios/6.9-inch/01_screen_1320x2868.png"));
  assert.ok(fileNames.includes("ios/6.9-inch/02_screen_1320x2868.png"));
  assert.ok(fileNames.includes("ios/6.7-inch/01_screen_1290x2796.png"));
  assert.ok(fileNames.includes("ios/6.7-inch/02_screen_1290x2796.png"));
  assert.ok(fileNames.includes("ios/6.1-inch/01_screen_1179x2556.png"));
  assert.ok(fileNames.includes("ios/6.1-inch/02_screen_1179x2556.png"));

  // Android folder assets
  assert.ok(fileNames.includes("android/phone/01_screen_1080x1920.png"));
  assert.ok(fileNames.includes("android/phone/02_screen_1080x1920.png"));
  assert.ok(fileNames.includes("android/tablet/01_screen_1440x2560.png"));
  assert.ok(fileNames.includes("android/tablet/02_screen_1440x2560.png"));
  assert.ok(fileNames.includes("android/feature_graphic_1024x500.png"));

  // Copy folder assets
  assert.ok(fileNames.includes("copy/listing.json"));
  assert.ok(fileNames.includes("copy/listing.txt"));

  // Manifest
  assert.ok(fileNames.includes("manifest.json"));

  // Verify PNG specs (dimensions, no alpha, valid PNG header)
  const ios69Png = zipEntries.get("ios/6.9-inch/01_screen_1320x2868.png").data;
  assert.equal(checkDimensions(ios69Png, 1320, 2868), null, "iOS 6.9-inch dimensions must match 1320x2868");
  assert.equal(checkNoAlpha(ios69Png), null, "iOS 6.9-inch PNG must have no alpha channel");

  const featGraphic = zipEntries.get("android/feature_graphic_1024x500.png").data;
  assert.equal(checkDimensions(featGraphic, 1024, 500), null, "Feature graphic dimensions must match 1024x500");
  assert.equal(checkNoAlpha(featGraphic), null, "Feature graphic PNG must have no alpha channel");

  // Check manifest contents
  const manifest = JSON.parse(Buffer.from(zipEntries.get("manifest.json").data).toString("utf8"));
  assert.equal(manifest.projectId, projectFree.id);
  assert.equal(manifest.projectName, projectFree.name);
  assert.equal(manifest.watermarked, true, "Manifest for free user must have watermarked: true");
  assert.equal(manifest.screensCount, 2);

  // Check copy content
  const copyTxt = Buffer.from(zipEntries.get("copy/listing.txt").data).toString("utf8");
  assert.ok(copyTxt.includes("HabitHero"));
  assert.ok(copyTxt.includes("Watermarked: YES (Free Tier)"));
}

// -----------------------------------------------------------------------------
// Test 5: Paid user gets watermarked: false
// -----------------------------------------------------------------------------
let proExportId;
let proDownloadUrl;
{
  const env = envWith({ DB: d1 });
  const r = await post("/api/exports", { projectId: projectPro.id, store: "both" }, env, sessionPro.cookieHeader);
  assert.equal(r.status, 200, "Pro export must succeed");
  const b = await r.json();

  assert.equal(b.ok, true);
  assert.equal(b.watermarked, false, "Paid tier must get watermarked: false");
  assert.equal(b.status, "ready");

  proExportId = b.exportId;
  proDownloadUrl = b.downloadUrl;

  // Verify D1 exports record
  const row = d1.rawDb.prepare("SELECT * FROM exports WHERE id = ?").get(proExportId);
  assert.ok(row);
  assert.equal(row.watermarked, 0, "D1 watermarked column must be 0 for paid user");

  // Verify download via signed URL without cookie
  const dlRes = await get(proDownloadUrl, env);
  assert.equal(dlRes.status, 200, "Download via signed URL token must succeed without cookies");
  assert.equal(dlRes.headers.get("Content-Type"), "application/zip");
  assert.equal(
    dlRes.headers.get("Content-Disposition"),
    'attachment; filename="cryptopulse-store-assets.zip"'
  );

  const zipEntries = readZip(new Uint8Array(await dlRes.arrayBuffer()));
  const manifest = JSON.parse(Buffer.from(zipEntries.get("manifest.json").data).toString("utf8"));
  assert.equal(manifest.watermarked, false, "Manifest for paid user must have watermarked: false");

  const copyTxt = Buffer.from(zipEntries.get("copy/listing.txt").data).toString("utf8");
  assert.ok(copyTxt.includes("Watermarked: NO (Paid Tier)"));
}

// -----------------------------------------------------------------------------
// Test 6: GET /api/exports/:id returns export record
// -----------------------------------------------------------------------------
{
  const env = envWith({ DB: d1 });

  // Fetch Free export details
  let r = await get(`/api/exports/${freeExportId}`, env, sessionFree.cookieHeader);
  assert.equal(r.status, 200);
  let b = await r.json();
  assert.equal(b.ok, true);
  assert.equal(b.id, freeExportId);
  assert.equal(b.status, "ready");
  assert.equal(b.watermarked, true);
  assert.ok(b.downloadUrl.includes(`/api/exports/${freeExportId}/download?token=`));
  assert.ok(b.expiresAt || b.expires_at);

  // Fetch Pro export details
  r = await get(`/api/exports/${proExportId}`, env, sessionPro.cookieHeader);
  assert.equal(r.status, 200);
  b = await r.json();
  assert.equal(b.watermarked, false);

  // Cross-tenant fetch returns 404
  r = await get(`/api/exports/${freeExportId}`, env, sessionOther.cookieHeader);
  assert.equal(r.status, 404, "User cannot access other user's export record");
}

// -----------------------------------------------------------------------------
// Test 7: GET /api/exports/:id/download token verification & expiration
// -----------------------------------------------------------------------------
{
  const env = envWith({ DB: d1 });

  // Invalid or tampered token returns 401
  let r = await get(`/api/exports/${freeExportId}/download?token=invalid.token`, env);
  assert.equal(r.status, 401, "Tampered token must return 401");

  // Token for another export returns 401
  const proToken = proDownloadUrl.split("token=")[1];
  r = await get(`/api/exports/${freeExportId}/download?token=${proToken}`, env);
  assert.equal(r.status, 401, "Token for another export must be rejected");

  // Cross-tenant download with cookie but no token returns 404
  r = await get(`/api/exports/${freeExportId}/download`, env, sessionOther.cookieHeader);
  assert.equal(r.status, 404, "Cross-tenant download without signed token returns 404");

  // Expired export returns 410
  const expiredId = crypto.randomUUID();
  d1.rawDb.prepare(
    "INSERT INTO exports (id, user_id, project_id, kind, r2_key, watermarked, status, expires_at) VALUES (?, ?, ?, 'zip', 'r2', 0, 'ready', datetime('now', '-1 day'))"
  ).run(expiredId, userFree.id, projectFree.id);

  r = await get(`/api/exports/${expiredId}/download`, env, sessionFree.cookieHeader);
  assert.equal(r.status, 410, "Expired export must return 410");
}

// -----------------------------------------------------------------------------
// Test 8: R2 and Queue integrations
// -----------------------------------------------------------------------------
{
  const r2Storage = new Map();
  const mockR2 = {
    async put(key, data, meta) {
      r2Storage.set(key, { data, meta });
    },
    async get(key) {
      const item = r2Storage.get(key);
      if (!item) return null;
      return {
        async arrayBuffer() {
          return item.data.buffer;
        },
      };
    },
  };

  const queueMessages = [];
  const mockQueue = {
    async send(msg) {
      queueMessages.push(msg);
    },
  };

  const sentEmails = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("api.resend.com")) {
      sentEmails.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ id: "email-123" }), { status: 200 });
    }
    return origFetch(url, init);
  };

  try {
    const env = envWith({
      DB: d1,
      EXPORTS: mockR2,
      EXPORT_QUEUE: mockQueue,
      RESEND_API_KEY: "re_mock_key_12345",
    });

    const r = await post("/api/exports", { projectId: projectPro.id, store: "ios" }, env, sessionPro.cookieHeader);
    assert.equal(r.status, 200);
    const b = await r.json();

    // Verify R2 put was invoked with expected key
    const expectedKey = `u/${userPro.id}/exports/${b.exportId}.zip`;
    assert.ok(r2Storage.has(expectedKey), "R2 storage must receive export zip");
    assert.equal(r2Storage.get(expectedKey).meta.httpMetadata.contentType, "application/zip");

    // Verify Queue message was sent
    assert.equal(queueMessages.length, 1);
    assert.equal(queueMessages[0].id, b.exportId);
    assert.equal(queueMessages[0].userId, userPro.id);
    assert.equal(queueMessages[0].projectId, projectPro.id);
    assert.equal(queueMessages[0].store, "ios");

    // Verify Resend email was dispatched
    assert.equal(sentEmails.length, 1);
    assert.equal(sentEmails[0].body.to, userPro.email);
    assert.equal(sentEmails[0].body.subject, "Your AppCaptures export is ready");
    assert.ok(sentEmails[0].body.text.includes(b.downloadUrl));

    // Download from mock R2
    const dl = await get(b.downloadUrl, env);
    assert.equal(dl.status, 200);
    const zipEntries = readZip(new Uint8Array(await dl.arrayBuffer()));
    // Store was "ios" only -> should contain ios assets, no android assets
    const names = Array.from(zipEntries.keys());
    assert.ok(names.some((n) => n.startsWith("ios/")), "Should contain ios assets");
    assert.ok(!names.some((n) => n.startsWith("android/")), "Should not contain android assets when store is ios");
  } finally {
    globalThis.fetch = origFetch;
  }
}

// -----------------------------------------------------------------------------
// Test 9: Download signing fails closed without DOWNLOAD_SECRET
// -----------------------------------------------------------------------------
{
  const envNoSecret = { DB: d1 };
  const rCreate = await post(
    "/api/exports",
    { projectId: projectPro.id, store: "both" },
    envNoSecret,
    sessionPro.cookieHeader
  );
  assert.equal(rCreate.status, 503);
  assert.deepEqual(await rCreate.json(), { error: "download signing not configured" });

  const row = d1.rawDb.prepare("SELECT expires_at FROM exports WHERE id = ?").get(proExportId);
  const legacyDefaultToken = await signDownloadTokenWithSecret(
    proExportId,
    row.expires_at,
    "appcaptures-export-download-secret-key-v1"
  );
  let r = await get(`/api/exports/${proExportId}/download?token=${legacyDefaultToken}`, envNoSecret);
  assert.ok(r.status === 401 || r.status === 503, "Legacy default-key token must be rejected");

  const adminSignedToken = await signDownloadTokenWithSecret(
    proExportId,
    row.expires_at,
    "admin-token-used-as-download-secret-32"
  );
  r = await get(`/api/exports/${proExportId}/download?token=${adminSignedToken}`, envWith({ DB: d1, ADMIN_TOKEN: "admin-token-used-as-download-secret-32" }));
  assert.equal(r.status, 401, "ADMIN_TOKEN-signed download token must be rejected");

  r = await get(proDownloadUrl, envNoSecret);
  assert.ok(r.status === 401 || r.status === 503, "Signed URL must not work without DOWNLOAD_SECRET");
}

// -----------------------------------------------------------------------------
// Test 10: Legacy POST /api/exports without session returns 401
// -----------------------------------------------------------------------------
{
  const env = envWith({ DB: d1, EXPORT_QUEUE: { send: async () => {} } });
  const r = await post(
    "/api/exports",
    { appId: "legacy-app", size: "1320x2868", screens: [{}, {}] },
    env
  );
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), { error: "unauthorized" });
}

console.log("export-pipeline: all assertions passed");
