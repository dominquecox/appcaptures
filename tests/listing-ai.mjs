// AI Listing Copywriter unit and integration tests (AC-009)
// Run: node tests/listing-ai.mjs

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
import path from "node:path";
import worker from "../worker.js";
import {
  validateListingLimits,
  sanitizeListing,
  containsEmoji,
  stripEmojis,
  containsBannedPlayKeywords,
  stripBannedPlayKeywords,
  getUtf8ByteLength,
  truncateUtf8Bytes,
  sanitizeAppleKeywords,
  completeAI,
  generateListingCopy,
  APPLE_LIMITS,
  PLAY_LIMITS,
} from "../engine/ai-adapter.js";

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

async function createTestUserAndSession(db, email = "user@example.com") {
  const userId = crypto.randomUUID();
  db.rawDb.prepare(
    "INSERT INTO users (id, email, status, plan, created_at, last_login_at) VALUES (?, ?, 'active', 'free', datetime('now'), datetime('now'))"
  ).run(userId, email);

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

function createTestProject(db, userId, name = "FitTrack Pro", archived = false) {
  const projectId = crypto.randomUUID();
  db.rawDb.prepare(
    "INSERT INTO projects (id, user_id, name, platforms_json, brand_json, created_at, updated_at, archived_at) VALUES (?, ?, ?, '[\"ios\",\"play\"]', '{}', datetime('now'), datetime('now'), ?)"
  ).run(projectId, userId, name, archived ? new Date().toISOString() : null);
  return projectId;
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
const get = (url, env, headers = {}) =>
  worker.fetch(
    req(url, {
      method: "GET",
      headers,
    }),
    env
  );

// =========================================================================
// 1. Unit tests: validateListingLimits and sanitizeListing
// =========================================================================

// --- 1.1 Apple App Store Limits & Sanitization ---
{
  // Valid Apple listing
  const validApple = {
    title: "FitTrack: Workout Companion", // 28 chars <= 30
    subtitle: "Track Sets, Reps & Progress", // 27 chars <= 30
    promo: "Start your new fitness journey today with our brand new routines!", // 65 chars <= 170
    description: "FitTrack is the premier fitness tracker for athletes and beginners alike. Log workouts seamlessly.",
    keywords: "fitness,workout,tracker,gym,health,exercise", // 44 bytes <= 100
  };
  assert.equal(validateListingLimits("ios", validApple), true, "Valid Apple listing must pass");
  assert.equal(validateListingLimits("apple", validApple), true, "Normalize 'apple' must pass");

  // Invalid Apple listing exceeding character & byte limits
  const oversizedApple = {
    title: "A".repeat(31), // > 30 chars
    subtitle: "B".repeat(31), // > 30 chars
    promo: "C".repeat(171), // > 170 chars
    description: "D".repeat(4001), // > 4000 chars
    keywords: "gym,fitness," + "workout,".repeat(15) + "health", // > 100 bytes
  };
  assert.equal(validateListingLimits("ios", oversizedApple), false, "Oversized Apple fields must be rejected");

  const detailedRes = validateListingLimits("ios", oversizedApple, { detailed: true });
  assert.equal(detailedRes.valid, false);
  assert.equal(detailedRes.errors.length, 5, "Must report 5 distinct limit violations");

  // Sanitizing clamps and truncates all fields to guarantee compliance
  const sanitizedApple = sanitizeListing("ios", oversizedApple);
  assert.ok(sanitizedApple.title.length <= APPLE_LIMITS.title, "Sanitized title <= 30 chars");
  assert.equal(sanitizedApple.title.length, 30);
  assert.ok(sanitizedApple.subtitle.length <= APPLE_LIMITS.subtitle, "Sanitized subtitle <= 30 chars");
  assert.equal(sanitizedApple.subtitle.length, 30);
  assert.ok(sanitizedApple.promo.length <= APPLE_LIMITS.promo, "Sanitized promo <= 170 chars");
  assert.equal(sanitizedApple.promo.length, 170);
  assert.ok(sanitizedApple.description.length <= APPLE_LIMITS.description, "Sanitized description <= 4000 chars");
  assert.equal(sanitizedApple.description.length, 4000);

  const kwBytes = new TextEncoder().encode(sanitizedApple.keywords).length;
  assert.ok(kwBytes <= APPLE_LIMITS.keywordsBytes, `Sanitized keywords byte length (${kwBytes}) <= 100 UTF-8 bytes`);
  assert.equal(validateListingLimits("ios", sanitizedApple), true, "Sanitized Apple listing must be valid");

  // UTF-8 multi-byte character keyword truncation test
  const multiByteKeywords = "照片,相机,图片编辑,设计,滤镜,相册,摄影,修图,美图,特效,背景,贴纸,相框,海报,壁纸,拼图";
  assert.ok(new TextEncoder().encode(multiByteKeywords).length > 100, "Initial multi-byte keywords exceed 100 bytes");
  const sanitizedMultiByte = sanitizeListing("ios", { keywords: multiByteKeywords });
  const mbBytes = new TextEncoder().encode(sanitizedMultiByte.keywords).length;
  assert.ok(mbBytes <= 100, `Multi-byte keywords (${mbBytes} bytes) must be <= 100 UTF-8 bytes`);
  assert.equal(validateListingLimits("ios", sanitizedMultiByte), true);
}

// --- 1.2 Google Play Limits & Sanitization ---
{
  // Valid Play listing
  const validPlay = {
    title: "FitTrack - Workout & Gym Routine Tracker", // 40 chars <= 50
    short: "Track workouts, routines, and progress with clean intuitive charts.", // 68 chars <= 80, no emojis, no spam
    full: "FitTrack makes it effortless to log every gym session, record weight lifted, and analyze personal records over time.",
  };
  assert.equal(validateListingLimits("play", validPlay), true, "Valid Play listing must pass");
  assert.equal(validateListingLimits("google", validPlay), true, "Normalize 'google' must pass");

  // Invalid Play listing: character limits
  const oversizedPlay = {
    title: "X".repeat(51), // > 50 chars
    short: "Y".repeat(81), // > 80 chars
    full: "Z".repeat(4001), // > 4000 chars
  };
  assert.equal(validateListingLimits("play", oversizedPlay), false, "Oversized Play fields must be rejected");

  // Invalid Play listing: emojis in short description
  const emojiPlay = {
    title: "FitTrack",
    short: "🚀 Best workout app for muscle gain! 🔥 Keep lifting ✨",
    full: "A comprehensive workout tracker.",
  };
  assert.equal(validateListingLimits("play", emojiPlay), false, "Emojis in short description must be rejected");
  assert.equal(containsEmoji(emojiPlay.short), true);

  // Invalid Play listing: banned spam keywords in short description
  for (const banned of ["#1", "best", "free", "top rated", "download now"]) {
    const spamPlay = {
      title: "FitTrack",
      short: `Track workouts with the ${banned} companion.`,
      full: "A comprehensive workout tracker.",
    };
    assert.equal(validateListingLimits("play", spamPlay), false, `Banned keyword '${banned}' must be rejected`);
  }

  // Sanitizing Play fields: clamps title, strips emojis, strips spam keywords, clamps short & full
  const dirtyPlay = {
    title: "🚀 Super FitTrack Workout Companion for Android Users Everywhere" + "X".repeat(50),
    short: "🔥 The #1 best free app for gym routines! Top rated tool download now for results. " + "A".repeat(50),
    full: "Detailed overview. " + "B".repeat(4100),
  };

  const sanitizedPlay = sanitizeListing("play", dirtyPlay);
  assert.ok(sanitizedPlay.title.length <= PLAY_LIMITS.title, "Sanitized title <= 50 chars");
  assert.equal(containsEmoji(sanitizedPlay.title), false, "No emojis in title");
  assert.ok(sanitizedPlay.short.length <= PLAY_LIMITS.short, "Sanitized short <= 80 chars");
  assert.equal(containsEmoji(sanitizedPlay.short), false, "No emojis in short description");
  assert.equal(containsBannedPlayKeywords(sanitizedPlay.short), false, "No banned spam keywords in short");
  assert.ok(sanitizedPlay.full.length <= PLAY_LIMITS.full, "Sanitized full <= 4000 chars");
  assert.equal(validateListingLimits("play", sanitizedPlay), true, "Sanitized Play listing must pass validation");
}

// =========================================================================
// 2. Provider-Agnostic AI Adapter tests
// =========================================================================
{
  // 2.1 Default Workers AI invocation
  let calledModel = null;
  let calledOptions = null;
  const mockWorkersAI = {
    run: async (model, inputs, options) => {
      calledModel = model;
      calledOptions = options;
      return { response: JSON.stringify({ title: "Generated App", subtitle: "Easy Tool", promo: "Promo", description: "Desc", keywords: "tool,app" }) };
    },
  };

  const textRes = await completeAI({
    task: "generate-listing",
    messages: [{ role: "user", content: "Generate iOS listing" }],
    schema: { type: "object" },
    env: { AI: mockWorkersAI },
  });
  assert.equal(calledModel, "@cf/meta/llama-3.3-70b-instruct", "Default text model must be llama-3.3-70b-instruct");
  assert.equal(textRes.data.title, "Generated App");

  // 2.2 Vision model selection when images provided
  const visionRes = await completeAI({
    task: "generate-listing",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Analyze screenshots" },
          { type: "image", image: "base64data" },
        ],
      },
    ],
    schema: { type: "object" },
    env: { AI: mockWorkersAI },
  });
  assert.equal(calledModel, "@cf/meta/llama-3.2-11b-vision-instruct", "Vision model used when images provided");

  // 2.3 Cloudflare AI Gateway routing
  await completeAI({
    task: "generate-listing",
    messages: [{ role: "user", content: "Test gateway" }],
    env: { AI: mockWorkersAI, AI_GATEWAY_ID: "my-gateway-id" },
  });
  assert.deepEqual(calledOptions, { gateway: { id: "my-gateway-id" } }, "Routes through Cloudflare AI Gateway");

  // 2.4 Gemini fallback when env.AI is not present
  let geminiUrl = null;
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, opts) => {
      geminiUrl = String(url);
      return new Response(JSON.stringify({
        candidates: [{
          content: { parts: [{ text: JSON.stringify({ title: "Gemini App", subtitle: "Gemini Sub", promo: "P", description: "D", keywords: "k" }) }] },
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    const geminiRes = await completeAI({
      task: "generate-listing",
      messages: [{ role: "user", content: "Hello Gemini" }],
      schema: { type: "object" },
      env: { GEMINI_API_KEY: "fake-gemini-key" },
    });
    assert.ok(geminiUrl.includes("generativelanguage.googleapis.com"), "Gemini URL called when GEMINI_API_KEY present");
    assert.equal(geminiRes.data.title, "Gemini App");
  } finally {
    globalThis.fetch = originalFetch;
  }

  // 2.5 Deterministic mock fallback when neither is present
  const mockRes = await completeAI({
    task: "generate-listing",
    messages: [{ role: "user", content: "App Name: CoffeeLog\nStore: ios" }],
    schema: { type: "object" },
    env: {},
  });
  assert.ok(mockRes.data.title.includes("CoffeeLog"), "Mock fallback respects App Name");
  assert.equal(validateListingLimits("ios", mockRes.data), true, "Mock fallback produces valid listing");
}

// =========================================================================
// 3. Integration tests: POST /api/listing/generate & GET /api/projects/:id/listing
// =========================================================================

// --- 3.1 Unauthenticated requests return 401 ---
{
  const db = createD1();
  const env = { DB: db };

  // POST without session cookie -> 401
  let r = await post("/api/listing/generate", { projectId: "proj-123", store: "ios" }, env);
  assert.equal(r.status, 401, "Unauthenticated POST /api/listing/generate must return 401");
  assert.deepEqual(await r.json(), { error: "unauthorized" });

  // GET without session cookie -> 401
  r = await get("/api/projects/proj-123/listing?store=ios", env);
  assert.equal(r.status, 401, "Unauthenticated GET /api/projects/:id/listing must return 401");
  assert.deepEqual(await r.json(), { error: "unauthorized" });
}

// --- 3.2 Request validation & 400 errors ---
{
  const db = createD1();
  const env = { DB: db };
  const { cookie } = await createTestUserAndSession(db, "valid-user@example.com");
  const headers = { Cookie: cookie };

  // Missing projectId
  let r = await post("/api/listing/generate", { store: "ios" }, env, headers);
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { error: "projectId required" });

  // Missing or invalid store
  r = await post("/api/listing/generate", { projectId: "p1", store: "windows-store" }, env, headers);
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { error: "store must be ios or play" });

  // Invalid locale format
  r = await post("/api/listing/generate", { projectId: "p1", store: "ios", locale: "invalid_locale_format" }, env, headers);
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { error: "invalid locale format" });
}

// --- 3.3 Cross-tenant and archived project isolation (404) ---
{
  const db = createD1();
  const env = { DB: db };
  const userA = await createTestUserAndSession(db, "userA@example.com");
  const userB = await createTestUserAndSession(db, "userB@example.com");

  const projectA = createTestProject(db, userA.userId, "App A");
  const archivedProject = createTestProject(db, userA.userId, "Archived App", true);

  // User B attempting to access User A's project -> 404
  let r = await post(
    "/api/listing/generate",
    { projectId: projectA, store: "ios" },
    env,
    { Cookie: userB.cookie }
  );
  assert.equal(r.status, 404, "Cross-tenant POST must return 404");
  assert.deepEqual(await r.json(), { error: "not found" });

  r = await get(`/api/projects/${projectA}/listing?store=ios`, env, { Cookie: userB.cookie });
  assert.equal(r.status, 404, "Cross-tenant GET must return 404");
  assert.deepEqual(await r.json(), { error: "not found" });

  // Accessing archived project -> 404
  r = await post(
    "/api/listing/generate",
    { projectId: archivedProject, store: "ios" },
    env,
    { Cookie: userA.cookie }
  );
  assert.equal(r.status, 404, "Archived project POST must return 404");
  assert.deepEqual(await r.json(), { error: "not found" });

  r = await get(`/api/projects/${archivedProject}/listing?store=ios`, env, { Cookie: userA.cookie });
  assert.equal(r.status, 404, "Archived project GET must return 404");
  assert.deepEqual(await r.json(), { error: "not found" });
}

// --- 3.4 Full flow: Generate and Retrieve iOS Listing ---
{
  const db = createD1();
  const env = { DB: db };
  const user = await createTestUserAndSession(db, "dev@example.com");
  const projectId = createTestProject(db, user.userId, "HabitTracker");

  // Generate iOS listing
  const r = await post(
    "/api/listing/generate",
    {
      projectId,
      store: "ios",
      locale: "en-US",
      appName: "HabitTracker",
      context: "A daily habit streak counter and routine organizer.",
    },
    env,
    { Cookie: user.cookie }
  );

  assert.equal(r.status, 200, "Successful generation returns 200");
  const res = await r.json();
  assert.equal(res.ok, true);
  assert.ok(res.listing.id, "Listing ID generated");
  assert.equal(res.listing.projectId, projectId);
  assert.equal(res.listing.store, "ios");
  assert.equal(res.listing.locale, "en-US");

  const fields = res.listing.fields;
  assert.ok(fields.title.length <= 30, `Title '${fields.title}' must be <= 30 chars`);
  assert.ok(fields.subtitle.length <= 30, `Subtitle '${fields.subtitle}' must be <= 30 chars`);
  assert.ok(fields.promo.length <= 170, `Promo '${fields.promo}' must be <= 170 chars`);
  assert.ok(fields.description.length <= 4000, "Description must be <= 4000 chars");
  assert.ok(new TextEncoder().encode(fields.keywords).length <= 100, "Keywords must be <= 100 UTF-8 bytes");
  assert.equal(validateListingLimits("ios", fields), true, "Returned listing strictly satisfies store limits");

  // Verify persisted row in D1 listings table
  const row = db.rawDb.prepare("SELECT * FROM listings WHERE id = ?").get(res.listing.id);
  assert.ok(row, "Row must exist in listings table");
  assert.equal(row.project_id, projectId);
  assert.equal(row.store, "ios");
  assert.equal(row.locale, "en-US");
  const savedFields = JSON.parse(row.fields_json);
  assert.deepEqual(savedFields, fields, "Persisted fields must match response");

  // Retrieve saved listing via GET /api/projects/:id/listing?store=ios
  const getRes = await get(`/api/projects/${projectId}/listing?store=ios`, env, { Cookie: user.cookie });
  assert.equal(getRes.status, 200, "GET listing returns 200");
  const getData = await getRes.json();
  assert.equal(getData.ok, true);
  assert.equal(getData.listing.id, res.listing.id);
  assert.equal(getData.listing.store, "ios");
  assert.deepEqual(getData.listing.fields, fields);
}

// --- 3.5 Full flow: Generate and Retrieve Google Play Listing ---
{
  const db = createD1();
  const env = { DB: db };
  const user = await createTestUserAndSession(db, "playdev@example.com");
  const projectId = createTestProject(db, user.userId, "QuickNotes Pro");

  // Generate Google Play listing
  const r = await post(
    "/api/listing/generate",
    {
      projectId,
      store: "play",
      locale: "en-US",
      appName: "QuickNotes Pro",
      context: "Fast markdown notepad with cloud sync.",
    },
    env,
    { Cookie: user.cookie }
  );

  assert.equal(r.status, 200);
  const res = await r.json();
  assert.equal(res.ok, true);
  assert.equal(res.listing.store, "play");

  const fields = res.listing.fields;
  assert.ok(fields.title.length <= 50, `Play title '${fields.title}' <= 50 chars`);
  assert.ok(fields.short.length <= 80, `Play short '${fields.short}' <= 80 chars`);
  assert.equal(containsEmoji(fields.short), false, "Short description has no emojis");
  assert.equal(containsBannedPlayKeywords(fields.short), false, "Short description has no banned keywords");
  assert.ok(fields.full.length <= 4000, "Play full description <= 4000 chars");
  assert.equal(validateListingLimits("play", fields), true);

  // Retrieve Play listing via GET /api/projects/:id/listing?store=play
  const getRes = await get(`/api/projects/${projectId}/listing?store=play`, env, { Cookie: user.cookie });
  assert.equal(getRes.status, 200);
  const getData = await getRes.json();
  assert.equal(getData.ok, true);
  assert.equal(getData.listing.store, "play");
  assert.deepEqual(getData.listing.fields, fields);
}

// --- 3.6 Re-generation updates existing listing row in place ---
{
  const db = createD1();
  const env = { DB: db };
  const user = await createTestUserAndSession(db, "updater@example.com");
  const projectId = createTestProject(db, user.userId, "UpdateApp");

  const r1 = await post(
    "/api/listing/generate",
    { projectId, store: "ios", context: "Version 1" },
    env,
    { Cookie: user.cookie }
  );
  const res1 = await r1.json();
  const firstId = res1.listing.id;

  const r2 = await post(
    "/api/listing/generate",
    { projectId, store: "ios", context: "Version 2 with new features" },
    env,
    { Cookie: user.cookie }
  );
  const res2 = await r2.json();
  assert.equal(res2.listing.id, firstId, "Second generation updates the existing listing row id");

  const rows = db.rawDb.prepare("SELECT COUNT(*) AS c FROM listings WHERE project_id = ? AND store = ?").get(projectId, "ios");
  assert.equal(rows.c, 1, "Only one row exists for project and store");
}

console.log("listing-ai: all assertions passed");
