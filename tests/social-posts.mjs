// Social launch-post generator unit and integration tests (AC-010)
// Run: node tests/social-posts.mjs

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
import path from "node:path";
import worker from "../worker.js";
import {
  sanitizeTwitterPost,
  sanitizeLinkedInPost,
  sanitizeProductHunt,
  sanitizeThreadsPost,
  sanitizeSocialPosts,
  generateSocialPosts,
  completeAI,
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

function createTestProject(db, userId, name = "FitTrack Pro", brand = {}, archived = false) {
  const projectId = crypto.randomUUID();
  db.rawDb.prepare(
    "INSERT INTO projects (id, user_id, name, platforms_json, brand_json, created_at, updated_at, archived_at) VALUES (?, ?, ?, '[\"ios\",\"play\"]', ?, datetime('now'), datetime('now'), ?)"
  ).run(projectId, userId, name, JSON.stringify(brand), archived ? new Date().toISOString() : null);
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

// =========================================================================
// 1. Unit Tests: Platform Constraints and Sanitizers
// =========================================================================

// --- 1.1 Twitter Constraints (<= 280 chars, 1-2 hashtags) ---
{
  // Default generator produces valid tweet <= 280 chars
  const tweet = sanitizeTwitterPost("", { projectName: "FitTrack Pro", tone: "launch" });
  assert.ok(typeof tweet === "string", "Tweet must be a string");
  assert.ok(tweet.length <= 280, `Tweet length (${tweet.length}) must be <= 280`);
  assert.ok(/#\w+/.test(tweet), "Tweet must include hashtags");

  // Oversized text (> 280 chars) is truncated cleanly to <= 280 chars
  const oversized = "A".repeat(350) + " #fitness #launch #extra";
  const truncated = sanitizeTwitterPost(oversized, { projectName: "FitTrack Pro" });
  assert.ok(truncated.length <= 280, `Truncated tweet (${truncated.length}) must be <= 280 chars`);
  assert.ok(/#\w+/.test(truncated), "Truncated tweet must retain hashtags");

  // Plain text without hashtags has 1-2 hashtags appended
  const noTags = "Just launched our brand new workout tracker! Go check it out now.";
  const tagged = sanitizeTwitterPost(noTags, { projectName: "FitTrack Pro" });
  assert.ok(tagged.length <= 280, "Must be <= 280 chars");
  const count = (tagged.match(/#\w+/g) || []).length;
  assert.ok(count >= 1 && count <= 2, `Hashtag count (${count}) must be 1 or 2`);

  // Excessive hashtags (> 2) are trimmed to at most 2
  const tooManyTags = "Check this out! #one #two #three #four #five";
  const cappedTags = sanitizeTwitterPost(tooManyTags, { projectName: "TestApp" });
  const finalTagCount = (cappedTags.match(/#\w+/g) || []).length;
  assert.ok(finalTagCount <= 2, `Capped tag count (${finalTagCount}) must be <= 2`);
}

// --- 1.2 Product Hunt Constraints (Tagline <= 60 chars, makerComment) ---
{
  const ph = sanitizeProductHunt(null, { projectName: "FitTrack Pro", tone: "launch" });
  assert.ok(typeof ph === "object" && ph !== null, "Product Hunt post must be an object");
  assert.ok(typeof ph.tagline === "string", "Tagline must be a string");
  assert.ok(ph.tagline.length <= 60, `Tagline length (${ph.tagline.length}) must be <= 60`);
  assert.ok(typeof ph.makerComment === "string", "Maker comment must be a string");
  assert.ok(ph.makerComment.length > 20, "Maker comment must have substantive content");

  // Oversized tagline (> 60 chars) is strictly truncated
  const longTagline = "A".repeat(85);
  const phTruncated = sanitizeProductHunt({ tagline: longTagline }, { projectName: "FitTrack Pro" });
  assert.ok(phTruncated.tagline.length <= 60, `PH Tagline length (${phTruncated.tagline.length}) must be <= 60`);
}

// --- 1.3 LinkedIn Constraints (Narrative Structure) ---
{
  const li = sanitizeLinkedInPost("", {
    projectName: "FitTrack Pro",
    tone: "launch",
    context: "The fastest workout tracker on the market.",
  });
  assert.ok(typeof li === "string", "LinkedIn post must be a string");
  // Verify narrative structure: problem, solution, value proposition, call to action
  assert.ok(/problem|challenge/i.test(li), "LinkedIn post must address the problem");
  assert.ok(/solution|built|introducing|launch/i.test(li), "LinkedIn post must describe the solution / launch");
  assert.ok(/highlight|feature|value/i.test(li), "LinkedIn post must detail key highlights / value");
  assert.ok(/feedback|comment|try/i.test(li), "LinkedIn post must include a call to action / feedback request");
}

// --- 1.4 Threads Constraints (Casual conversational format) ---
{
  const threads = sanitizeThreadsPost("", { projectName: "FitTrack Pro", tone: "launch" });
  assert.ok(typeof threads === "string", "Threads post must be a string");
  assert.ok(threads.length > 10, "Threads post must have content");
}

// --- 1.5 Multi-Platform Sanitizer ---
{
  const sanitized = sanitizeSocialPosts(
    {},
    {
      projectName: "AppCaptures",
      platforms: ["twitter", "linkedin", "producthunt", "threads"],
      tone: "hype",
    }
  );
  assert.ok(sanitized.twitter, "Must have twitter");
  assert.ok(sanitized.linkedin, "Must have linkedin");
  assert.ok(sanitized.producthunt, "Must have producthunt");
  assert.ok(sanitized.threads, "Must have threads");
  assert.equal(sanitized.twitter.length <= 280, true);
  assert.equal(sanitized.producthunt.tagline.length <= 60, true);
}

// =========================================================================
// 2. Integration Tests: POST /api/post/generate
// =========================================================================

// --- 2.1 Authenticated User Requests Launch Posts (Default Platforms) ---
{
  const db = createD1();
  const { cookie, userId } = await createTestUserAndSession(db, "founder@example.com");
  const projectId = createTestProject(db, userId, "LaunchPad Studio", {
    tagline: "Ship screenshot assets 10x faster",
    description: "Automated studio for App Store and Play Store graphics.",
  });

  const res = await post(
    "/api/post/generate",
    { projectId },
    { DB: db },
    { Cookie: cookie }
  );

  assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
  const data = await res.json();
  assert.equal(data.ok, true, "Response ok must be true");
  assert.equal(data.projectId, projectId, "Returned projectId must match");
  assert.ok(data.posts, "Response must include posts object");

  // Twitter verification
  assert.ok(typeof data.posts.twitter === "string", "Twitter post must be a string");
  assert.ok(data.posts.twitter.length <= 280, `Twitter post length (${data.posts.twitter.length}) must be <= 280`);
  assert.ok(/#\w+/.test(data.posts.twitter), "Twitter post must include hashtags");

  // Product Hunt verification
  assert.ok(typeof data.posts.producthunt === "object" && data.posts.producthunt !== null, "Product Hunt post must be an object");
  assert.ok(typeof data.posts.producthunt.tagline === "string", "Product Hunt tagline must be a string");
  assert.ok(data.posts.producthunt.tagline.length <= 60, `Product Hunt tagline (${data.posts.producthunt.tagline.length}) must be <= 60`);
  assert.ok(typeof data.posts.producthunt.makerComment === "string", "Product Hunt maker comment must be a string");
  assert.ok(data.posts.producthunt.makerComment.length > 20, "Product Hunt maker comment must be substantive");

  // LinkedIn verification
  assert.ok(typeof data.posts.linkedin === "string", "LinkedIn post must be a string");
  assert.ok(/problem|challenge/i.test(data.posts.linkedin), "LinkedIn post must highlight problem solved");
  assert.ok(/solution|value|built|launch/i.test(data.posts.linkedin), "LinkedIn post must highlight value proposition");
}

// --- 2.2 Target Platforms Customization ---
{
  const db = createD1();
  const { cookie, userId } = await createTestUserAndSession(db, "builder@example.com");
  const projectId = createTestProject(db, userId, "ThreadFlow");

  // Request only twitter and threads
  let res = await post(
    "/api/post/generate",
    { projectId, platforms: ["twitter", "threads"], tone: "hype" },
    { DB: db },
    { Cookie: cookie }
  );
  assert.equal(res.status, 200);
  let data = await res.json();
  assert.ok(data.posts.twitter, "Twitter must be present");
  assert.ok(data.posts.threads, "Threads must be present");
  assert.equal(data.posts.linkedin, undefined, "LinkedIn should not be present when unrequested");
  assert.equal(data.posts.producthunt, undefined, "Product Hunt should not be present when unrequested");

  // Request all 4 platforms
  res = await post(
    "/api/post/generate",
    { projectId, platforms: ["twitter", "linkedin", "producthunt", "threads"], tone: "minimal" },
    { DB: db },
    { Cookie: cookie }
  );
  assert.equal(res.status, 200);
  data = await res.json();
  assert.ok(data.posts.twitter, "Twitter must be present");
  assert.ok(data.posts.linkedin, "LinkedIn must be present");
  assert.ok(data.posts.producthunt, "Product Hunt must be present");
  assert.ok(data.posts.threads, "Threads must be present");
  assert.ok(data.posts.twitter.length <= 280);
  assert.ok(data.posts.producthunt.tagline.length <= 60);
}

// --- 2.3 Tone Variations (launch, hype, story, minimal) ---
{
  const db = createD1();
  const { cookie, userId } = await createTestUserAndSession(db, "tones@example.com");
  const projectId = createTestProject(db, userId, "SonicSpeed");

  for (const tone of ["launch", "hype", "story", "minimal"]) {
    const res = await post(
      "/api/post/generate",
      { projectId, tone },
      { DB: db },
      { Cookie: cookie }
    );
    assert.equal(res.status, 200, `Tone ${tone} must succeed`);
    const data = await res.json();
    assert.ok(data.posts.twitter.length <= 280, `Tone ${tone} Twitter post must be <= 280`);
    assert.ok(data.posts.producthunt.tagline.length <= 60, `Tone ${tone} PH tagline must be <= 60`);
  }
}

// --- 2.4 Unauthenticated Requests Return 401 ---
{
  const db = createD1();
  const { userId } = await createTestUserAndSession(db, "unauth@example.com");
  const projectId = createTestProject(db, userId, "SecretApp");

  // No cookie header
  let res = await post("/api/post/generate", { projectId }, { DB: db });
  assert.equal(res.status, 401, "Missing session cookie must return 401");
  let body = await res.json();
  assert.equal(body.error, "unauthorized");

  // Invalid cookie header
  res = await post(
    "/api/post/generate",
    { projectId },
    { DB: db },
    { Cookie: "appcaptures_session=invalid_random_token" }
  );
  assert.equal(res.status, 401, "Invalid session token must return 401");
}

// --- 2.5 Cross-Tenant Requests Return 404 ---
{
  const db = createD1();
  const userA = await createTestUserAndSession(db, "userA@example.com");
  const userB = await createTestUserAndSession(db, "userB@example.com");

  // Project belongs to User A
  const projectA = createTestProject(db, userA.userId, "Project A");

  // User B attempts to generate posts for User A's project
  const res = await post(
    "/api/post/generate",
    { projectId: projectA },
    { DB: db },
    { Cookie: userB.cookie }
  );

  assert.equal(res.status, 404, "Cross-tenant request must return 404");
  const body = await res.json();
  assert.equal(body.error, "not found");
}

// --- 2.6 Project Not Found Returns 404 ---
{
  const db = createD1();
  const user = await createTestUserAndSession(db, "missing@example.com");
  const nonExistentId = crypto.randomUUID();

  const res = await post(
    "/api/post/generate",
    { projectId: nonExistentId },
    { DB: db },
    { Cookie: user.cookie }
  );

  assert.equal(res.status, 404, "Non-existent project must return 404");
  const body = await res.json();
  assert.equal(body.error, "not found");
}

// --- 2.7 Archived Project Returns 404 ---
{
  const db = createD1();
  const user = await createTestUserAndSession(db, "archived@example.com");
  const archivedProjectId = createTestProject(db, user.userId, "Archived App", {}, true);

  const res = await post(
    "/api/post/generate",
    { projectId: archivedProjectId },
    { DB: db },
    { Cookie: user.cookie }
  );

  assert.equal(res.status, 404, "Archived project must return 404");
  const body = await res.json();
  assert.equal(body.error, "not found");
}

// --- 2.8 Request Validation: Missing Project ID ---
{
  const db = createD1();
  const user = await createTestUserAndSession(db, "valid@example.com");

  // Missing projectId
  let res = await post("/api/post/generate", {}, { DB: db }, { Cookie: user.cookie });
  assert.equal(res.status, 400, "Missing projectId must return 400");
  let body = await res.json();
  assert.equal(body.error, "projectId required");

  // Empty string projectId
  res = await post("/api/post/generate", { projectId: "   " }, { DB: db }, { Cookie: user.cookie });
  assert.equal(res.status, 400, "Whitespace projectId must return 400");
}

// --- 2.9 Model AI Integration with Custom Mock Binding ---
{
  const db = createD1();
  const user = await createTestUserAndSession(db, "ai@example.com");
  const projectId = createTestProject(db, user.userId, "AI Driven App");

  let aiCalled = false;
  const mockAI = {
    async run(model, { messages }) {
      aiCalled = true;
      return {
        response: JSON.stringify({
          twitter: "Introducing AI Driven App: automated creative studio! #launch #ai",
          linkedin: "🚀 Excited to announce AI Driven App!\n\nThe Problem:\nManual creative iteration takes days.\n\nOur Solution:\nInstant generation.\n\nKey Highlights:\n• Automated design\n\nTry it out today!",
          producthunt: {
            tagline: "AI Driven App – Instant creative generation",
            makerComment: "Hello makers! Excited to share our launch today.",
          },
        }),
      };
    },
  };

  const res = await post(
    "/api/post/generate",
    { projectId },
    { DB: db, AI: mockAI },
    { Cookie: user.cookie }
  );

  assert.equal(res.status, 200);
  assert.equal(aiCalled, true, "AI binding must be invoked when present");
  const data = await res.json();
  assert.ok(data.posts.twitter.length <= 280);
  assert.ok(data.posts.producthunt.tagline.length <= 60);
  assert.ok(/problem/i.test(data.posts.linkedin));
}

console.log("social-posts: all assertions passed");
