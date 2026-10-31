// Render APIs and job review unit tests (SPEC Section 3.3, AC-008)
// Run: node tests/render-api.mjs

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
import path from "node:path";
import crypto from "node:crypto";
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

function createTestUser(db, email, name = "Test User") {
  const userId = crypto.randomUUID();
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const sessionId = crypto.randomUUID();

  db.rawDb.prepare(
    "INSERT INTO users (id, email, name, status, plan) VALUES (?, ?, ?, 'active', 'free')"
  ).run(userId, email, name);

  db.rawDb.prepare(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, datetime('now', '+30 days'))"
  ).run(sessionId, userId, tokenHash);

  return {
    userId,
    email,
    token: rawToken,
    cookie: `appcaptures_session=${rawToken}`,
  };
}

const req = (url, init = {}) => new Request(`https://appcaptures.com${url}`, init);

const apiGet = (url, cookie, env) =>
  worker.fetch(
    req(url, {
      method: "GET",
      headers: cookie ? { Cookie: cookie } : {},
    }),
    env
  );

const apiPost = (url, body, cookie, env) =>
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

// --- 1. Unauthenticated requests fail closed with 401 ---
{
  const db = createD1();
  const env = { DB: db };

  // Missing DB returns 503
  let r = await apiPost("/api/projects/proj-123/render", { targetSizes: ["1290x2796"] }, null, {});
  assert.equal(r.status, 503);

  r = await apiGet("/api/jobs/job-123", null, {});
  assert.equal(r.status, 503);

  // Missing session cookie returns 401
  r = await apiPost("/api/projects/proj-123/render", { targetSizes: ["1290x2796"] }, null, env);
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), { error: "unauthorized" });

  r = await apiGet("/api/jobs/job-123", null, env);
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), { error: "unauthorized" });
}

// --- 2. Authenticated user submits render job & validates D1 storage and review notes ---
{
  const db = createD1();
  const env = { DB: db };
  const user = createTestUser(db, "alice@example.com", "Alice");

  // Create project with initial screens
  const createProjRes = await apiPost(
    "/api/projects",
    {
      name: "HabitLoop",
      platforms: ["ios"],
      brand: { bg: "#0b0914", headlineColor: "#ffffff" },
      screens: [
        { headline: "Track Habits Everyday", subhead: "Streak counter and insights", ord: 0 },
        { headline: "Never Break The Chain", subhead: "Daily reminders", ord: 1 },
      ],
    },
    user.cookie,
    env
  );
  assert.equal(createProjRes.status, 201);
  const { project } = await createProjRes.json();

  // Submit render job
  const renderRes = await apiPost(
    `/api/projects/${project.id}/render`,
    {
      targetSizes: ["1290x2796", "1179x2556"],
      store: "apple",
    },
    user.cookie,
    env
  );
  assert.equal(renderRes.status, 200);
  const renderData = await renderRes.json();

  // Validate response contract
  assert.equal(renderData.ok, true);
  assert.ok(renderData.jobId, "jobId must be returned");
  assert.equal(typeof renderData.jobId, "string");
  assert.equal(renderData.status, "completed");
  assert.deepEqual(renderData.targetSizes, ["1290x2796", "1179x2556"]);
  assert.ok(Array.isArray(renderData.passes), "passes must be an array");
  assert.ok(renderData.passes.length >= 1, "at least 1 pass must be executed");

  // Validate per-pass review notes
  const pass1 = renderData.passes[0];
  assert.equal(pass1.pass, 1);
  assert.equal(pass1.fixed, true);
  assert.ok(Array.isArray(pass1.notes), "notes must be an array of review notes");

  // Telemetry assertions for review notes
  assert.ok(
    pass1.notes.some((n) => n.includes("Dimensions verified")),
    "must include Dimensions verified note"
  );
  assert.ok(
    pass1.notes.some((n) => n.includes("No alpha verified")),
    "must include No alpha verified note"
  );
  assert.ok(
    pass1.notes.some((n) => n.includes("WCAG AA contrast verified")),
    "must include WCAG AA contrast verified note"
  );
  assert.ok(
    pass1.notes.some((n) => n.includes("Checking store dimensions & ratio")),
    "must include interactive per-pass dimension check note"
  );
  assert.ok(
    pass1.notes.some((n) => n.includes("Alpha transparency check")),
    "must include alpha transparency check note"
  );
  assert.ok(
    pass1.notes.some((n) => n.includes("Contrast audit")),
    "must include contrast audit note"
  );

  // Validate D1 renders table insertion
  const renderRow = db.rawDb.prepare("SELECT * FROM renders WHERE id = ?").get(renderData.jobId);
  assert.ok(renderRow, "renders row must be inserted into D1");
  assert.equal(renderRow.project_id, project.id);
  assert.equal(renderRow.target_size, "1290x2796, 1179x2556");
  assert.equal(renderRow.status, "completed");
  assert.equal(renderRow.html_r2_key, `renders/${renderData.jobId}/index.html`);
  assert.equal(renderRow.png_r2_key, `renders/${renderData.jobId}/screen.png`);
  assert.equal(renderRow.passes, renderData.passes.length);

  const parsedReviewJson = JSON.parse(renderRow.review_json);
  assert.deepEqual(parsedReviewJson, renderData.passes);

  // --- 3. GET /api/jobs/:id returns passes and review details ---
  const jobRes = await apiGet(`/api/jobs/${renderData.jobId}`, user.cookie, env);
  assert.equal(jobRes.status, 200);
  const jobData = await jobRes.json();

  assert.equal(jobData.ok, true);
  assert.equal(jobData.job.id, renderData.jobId);
  assert.equal(jobData.job.projectId, project.id);
  assert.equal(jobData.job.targetSize, "1290x2796, 1179x2556");
  assert.equal(jobData.job.status, "completed");
  assert.deepEqual(jobData.job.passes, renderData.passes);

  // Non-existent job returns 404
  const notFoundJob = await apiGet("/api/jobs/non-existent-uuid", user.cookie, env);
  assert.equal(notFoundJob.status, 404);
}

// --- 4. Multi-tenant isolation: User B cannot render or access User A's jobs ---
{
  const db = createD1();
  const env = { DB: db };
  const userA = createTestUser(db, "alice@example.com", "Alice");
  const userB = createTestUser(db, "bob@example.com", "Bob");

  const createProjRes = await apiPost(
    "/api/projects",
    { name: "Alice App", platforms: ["ios"] },
    userA.cookie,
    env
  );
  const { project } = await createProjRes.json();

  const renderA = await apiPost(
    `/api/projects/${project.id}/render`,
    { targetSizes: ["1290x2796"] },
    userA.cookie,
    env
  );
  const { jobId } = await renderA.json();

  // User B tries to render Alice's project -> 404 (tenant isolation)
  const bobRender = await apiPost(
    `/api/projects/${project.id}/render`,
    { targetSizes: ["1290x2796"] },
    userB.cookie,
    env
  );
  assert.equal(bobRender.status, 404);

  // User B tries to read Alice's job -> 404 (tenant isolation)
  const bobJob = await apiGet(`/api/jobs/${jobId}`, userB.cookie, env);
  assert.equal(bobJob.status, 404);
}

// --- 5. Project archiving: archived projects cannot be rendered ---
{
  const db = createD1();
  const env = { DB: db };
  const user = createTestUser(db, "alice@example.com", "Alice");

  const createProjRes = await apiPost(
    "/api/projects",
    { name: "Archived App", platforms: ["ios"] },
    user.cookie,
    env
  );
  const { project } = await createProjRes.json();

  // Soft-delete project
  const delRes = await worker.fetch(
    req(`/api/projects/${project.id}`, {
      method: "DELETE",
      headers: { Cookie: user.cookie },
    }),
    env
  );
  assert.equal(delRes.status, 200);

  // Attempting render on archived project returns 404
  const renderArchived = await apiPost(
    `/api/projects/${project.id}/render`,
    { targetSizes: ["1290x2796"] },
    user.cookie,
    env
  );
  assert.equal(renderArchived.status, 404);
}

// --- 6. Target sizes default according to project platforms ---
{
  const db = createD1();
  const env = { DB: db };
  const user = createTestUser(db, "alice@example.com", "Alice");

  // iOS default presets
  const iosProjRes = await apiPost(
    "/api/projects",
    { name: "iOS Only", platforms: ["ios"] },
    user.cookie,
    env
  );
  const { project: iosProj } = await iosProjRes.json();

  const iosRender = await apiPost(`/api/projects/${iosProj.id}/render`, {}, user.cookie, env);
  assert.equal(iosRender.status, 200);
  const iosData = await iosRender.json();
  assert.deepEqual(iosData.targetSizes, ["1290x2796", "1179x2556"]);

  // Android default presets
  const androidProjRes = await apiPost(
    "/api/projects",
    { name: "Android Only", platforms: ["android"] },
    user.cookie,
    env
  );
  const { project: androidProj } = await androidProjRes.json();

  const androidRender = await apiPost(`/api/projects/${androidProj.id}/render`, {}, user.cookie, env);
  assert.equal(androidRender.status, 200);
  const androidData = await androidRender.json();
  assert.deepEqual(androidData.targetSizes, ["1080x1920"]);
}

console.log("render-api: all assertions passed");
