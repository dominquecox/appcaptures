// Projects and screens REST API unit tests (SPEC Section 3.3, AC-007)
// Run: node tests/projects-api.mjs

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

const apiPatch = (url, body, cookie, env) =>
  worker.fetch(
    req(url, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
    env
  );

const apiDelete = (url, cookie, env) =>
  worker.fetch(
    req(url, {
      method: "DELETE",
      headers: cookie ? { Cookie: cookie } : {},
    }),
    env
  );

// --- 1. Unauthenticated requests get 401 ---
{
  const db = createD1();
  const env = { DB: db };

  let r = await apiGet("/api/projects", null, env);
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), { error: "unauthorized" });

  r = await apiPost("/api/projects", { name: "App" }, null, env);
  assert.equal(r.status, 401);

  r = await apiGet("/api/projects/some-id", null, env);
  assert.equal(r.status, 401);

  r = await apiPatch("/api/projects/some-id", { name: "New Name" }, null, env);
  assert.equal(r.status, 401);

  r = await apiDelete("/api/projects/some-id", null, env);
  assert.equal(r.status, 401);

  r = await apiPost("/api/projects/some-id/screens", { headline: "Screen 1" }, null, env);
  assert.equal(r.status, 401);

  r = await apiPatch("/api/screens/some-id", { headline: "Updated" }, null, env);
  assert.equal(r.status, 401);

  r = await apiDelete("/api/screens/some-id", null, env);
  assert.equal(r.status, 401);
}

// --- 2. GET /api/projects (empty for new user) ---
{
  const db = createD1();
  const env = { DB: db };
  const user = createTestUser(db, "alice@example.com", "Alice");

  const r = await apiGet("/api/projects", user.cookie, env);
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.ok, true);
  assert.deepEqual(data.projects, []);
}

// --- 3. POST /api/projects creating a project with screens and default name ---
{
  const db = createD1();
  const env = { DB: db };
  const user = createTestUser(db, "alice@example.com", "Alice");

  // Create project with explicit name, platforms, brand, and screens
  const r = await apiPost(
    "/api/projects",
    {
      name: "Vidiloop iOS",
      platforms: ["ios"],
      brand: { primary: "#7c5cff", bg: "#0b0914", font: "Hanken Grotesk" },
      screens: [
        { ord: 0, headline: "Shoot short clips", subhead: "Effortless capture", locale: "en-US" },
        { ord: 1, headline: "Loop your moments", subhead: "Share with friends", locale: "en-US" },
      ],
    },
    user.cookie,
    env
  );

  assert.equal(r.status, 201);
  const data = await r.json();
  assert.equal(data.ok, true);
  assert.ok(data.project);
  assert.ok(data.project.id);
  assert.equal(data.project.name, "Vidiloop iOS");
  assert.deepEqual(data.project.platforms, ["ios"]);
  assert.equal(data.project.brand.primary, "#7c5cff");

  // Test default name when omitted
  const rDefault = await apiPost("/api/projects", {}, user.cookie, env);
  assert.equal(rDefault.status, 201);
  const dataDefault = await rDefault.json();
  assert.equal(dataDefault.project.name, "Untitled App");
}

// --- 4. GET /api/projects/:id returning project + screens ---
{
  const db = createD1();
  const env = { DB: db };
  const user = createTestUser(db, "alice@example.com", "Alice");

  const createRes = await apiPost(
    "/api/projects",
    {
      name: "Vidiloop Pro",
      platforms: ["ios", "marketing"],
      brand: { primary: "#7c5cff", bg: "#0b0914" },
      screens: [
        { ord: 0, headline: "Screen One", subhead: "Subhead One" },
        { ord: 1, headline: "Screen Two", subhead: "Subhead Two" },
      ],
    },
    user.cookie,
    env
  );
  const { project: created } = await createRes.json();

  const getRes = await apiGet(`/api/projects/${created.id}`, user.cookie, env);
  assert.equal(getRes.status, 200);
  const getData = await getRes.json();
  assert.equal(getData.ok, true);
  assert.equal(getData.project.id, created.id);
  assert.equal(getData.project.name, "Vidiloop Pro");
  assert.deepEqual(getData.project.platforms, ["ios", "marketing"]);
  assert.equal(getData.project.brand.primary, "#7c5cff");
  assert.equal(getData.screens.length, 2);
  assert.equal(getData.screens[0].ord, 0);
  assert.equal(getData.screens[0].headline, "Screen One");
  assert.equal(getData.screens[0].subhead, "Subhead One");
  assert.equal(getData.screens[1].ord, 1);
  assert.equal(getData.screens[1].headline, "Screen Two");

  // Non-existent project returns 404
  const notFound = await apiGet("/api/projects/non-existent-id", user.cookie, env);
  assert.equal(notFound.status, 404);
}

// --- 5. PATCH /api/projects/:id updating brand and platforms ---
{
  const db = createD1();
  const env = { DB: db };
  const user = createTestUser(db, "alice@example.com", "Alice");

  const createRes = await apiPost(
    "/api/projects",
    {
      name: "Original Name",
      platforms: ["ios"],
      brand: { primary: "#7c5cff" },
    },
    user.cookie,
    env
  );
  const { project: created } = await createRes.json();

  const patchRes = await apiPatch(
    `/api/projects/${created.id}`,
    {
      name: "Updated Name",
      platforms: ["ios", "android"],
      brand: { primary: "#ff6b00", bg: "#111111" },
    },
    user.cookie,
    env
  );
  assert.equal(patchRes.status, 200);
  assert.deepEqual(await patchRes.json(), { ok: true });

  const getRes = await apiGet(`/api/projects/${created.id}`, user.cookie, env);
  const getData = await getRes.json();
  assert.equal(getData.project.name, "Updated Name");
  assert.deepEqual(getData.project.platforms, ["ios", "android"]);
  assert.equal(getData.project.brand.primary, "#ff6b00");
  assert.equal(getData.project.brand.bg, "#111111");
}

// --- 6. POST /api/projects/:id/screens and PATCH /api/screens/:id ---
{
  const db = createD1();
  const env = { DB: db };
  const user = createTestUser(db, "alice@example.com", "Alice");

  const createRes = await apiPost(
    "/api/projects",
    { name: "Screens Test", platforms: ["ios"] },
    user.cookie,
    env
  );
  const { project: created } = await createRes.json();

  // Add screen to project
  const addRes = await apiPost(
    `/api/projects/${created.id}/screens`,
    {
      ord: 0,
      headline: "First Screen",
      subhead: "First Subhead",
      capture_r2_key: "r2/key/screen1.png",
      locale: "en-US",
    },
    user.cookie,
    env
  );
  assert.equal(addRes.status, 201);
  const addData = await addRes.json();
  assert.equal(addData.ok, true);
  assert.ok(addData.screen.id);
  assert.equal(addData.screen.project_id, created.id);
  assert.equal(addData.screen.ord, 0);
  assert.equal(addData.screen.headline, "First Screen");
  assert.equal(addData.screen.subhead, "First Subhead");

  const screenId = addData.screen.id;

  // Update screen
  const patchScreenRes = await apiPatch(
    `/api/screens/${screenId}`,
    {
      headline: "Updated Headline",
      subhead: "Updated Subhead",
      ord: 5,
    },
    user.cookie,
    env
  );
  assert.equal(patchScreenRes.status, 200);
  assert.deepEqual(await patchScreenRes.json(), { ok: true });

  const getRes = await apiGet(`/api/projects/${created.id}`, user.cookie, env);
  const getData = await getRes.json();
  assert.equal(getData.screens.length, 1);
  assert.equal(getData.screens[0].id, screenId);
  assert.equal(getData.screens[0].headline, "Updated Headline");
  assert.equal(getData.screens[0].subhead, "Updated Subhead");
  assert.equal(getData.screens[0].ord, 5);
}

// --- 7. DELETE /api/screens/:id ---
{
  const db = createD1();
  const env = { DB: db };
  const user = createTestUser(db, "alice@example.com", "Alice");

  const createRes = await apiPost(
    "/api/projects",
    {
      name: "Delete Screen Test",
      screens: [
        { ord: 0, headline: "Screen to keep" },
        { ord: 1, headline: "Screen to delete" },
      ],
    },
    user.cookie,
    env
  );
  const { project: created } = await createRes.json();

  const getRes1 = await apiGet(`/api/projects/${created.id}`, user.cookie, env);
  const screens1 = (await getRes1.json()).screens;
  assert.equal(screens1.length, 2);

  const screenToDelete = screens1[1].id;
  const delRes = await apiDelete(`/api/screens/${screenToDelete}`, user.cookie, env);
  assert.equal(delRes.status, 200);
  assert.deepEqual(await delRes.json(), { ok: true });

  const getRes2 = await apiGet(`/api/projects/${created.id}`, user.cookie, env);
  const screens2 = (await getRes2.json()).screens;
  assert.equal(screens2.length, 1);
  assert.equal(screens2[0].headline, "Screen to keep");

  // Deleting again returns 404
  const delAgain = await apiDelete(`/api/screens/${screenToDelete}`, user.cookie, env);
  assert.equal(delAgain.status, 404);
}

// --- 8. DELETE /api/projects/:id archiving ---
{
  const db = createD1();
  const env = { DB: db };
  const user = createTestUser(db, "alice@example.com", "Alice");

  const createRes = await apiPost(
    "/api/projects",
    { name: "Archive Me" },
    user.cookie,
    env
  );
  const { project: created } = await createRes.json();

  const delRes = await apiDelete(`/api/projects/${created.id}`, user.cookie, env);
  assert.equal(delRes.status, 200);
  assert.deepEqual(await delRes.json(), { ok: true });

  // Excluded from GET /api/projects
  const listRes = await apiGet("/api/projects", user.cookie, env);
  const listData = await listRes.json();
  assert.equal(listData.projects.find((p) => p.id === created.id), undefined);

  // GET /api/projects/:id returns 404
  const getRes = await apiGet(`/api/projects/${created.id}`, user.cookie, env);
  assert.equal(getRes.status, 404);

  // Verify archived_at is set in database
  const row = db.rawDb.prepare("SELECT archived_at FROM projects WHERE id = ?").get(created.id);
  assert.ok(row.archived_at, "archived_at timestamp must be set");
}

// --- 9. Authorization checks: User B cannot access or modify User A's project or screens ---
{
  const db = createD1();
  const env = { DB: db };
  const userA = createTestUser(db, "alice@example.com", "Alice");
  const userB = createTestUser(db, "bob@example.com", "Bob");

  // User A creates project and screen
  const createRes = await apiPost(
    "/api/projects",
    {
      name: "Alice Private App",
      platforms: ["ios"],
      screens: [{ ord: 0, headline: "Alice Secret" }],
    },
    userA.cookie,
    env
  );
  const { project: projectA } = await createRes.json();
  const detailA = await (await apiGet(`/api/projects/${projectA.id}`, userA.cookie, env)).json();
  const screenAId = detailA.screens[0].id;

  // User B lists projects — Alice's project is NOT returned
  const userBList = await (await apiGet("/api/projects", userB.cookie, env)).json();
  assert.equal(userBList.projects.length, 0);

  // User B tries to read Alice's project -> 404
  const readRes = await apiGet(`/api/projects/${projectA.id}`, userB.cookie, env);
  assert.equal(readRes.status, 404);

  // User B tries to update Alice's project -> 404
  const patchProjRes = await apiPatch(
    `/api/projects/${projectA.id}`,
    { name: "Hacked by Bob" },
    userB.cookie,
    env
  );
  assert.equal(patchProjRes.status, 404);

  // User B tries to add a screen to Alice's project -> 404
  const addScreenRes = await apiPost(
    `/api/projects/${projectA.id}/screens`,
    { headline: "Bob Screen" },
    userB.cookie,
    env
  );
  assert.equal(addScreenRes.status, 404);

  // User B tries to patch Alice's screen -> 404
  const patchScreenRes = await apiPatch(
    `/api/screens/${screenAId}`,
    { headline: "Hacked Screen" },
    userB.cookie,
    env
  );
  assert.equal(patchScreenRes.status, 404);

  // User B tries to delete Alice's screen -> 404
  const delScreenRes = await apiDelete(`/api/screens/${screenAId}`, userB.cookie, env);
  assert.equal(delScreenRes.status, 404);

  // User B tries to delete Alice's project -> 404
  const delProjRes = await apiDelete(`/api/projects/${projectA.id}`, userB.cookie, env);
  assert.equal(delProjRes.status, 404);

  // Verify Alice's project and screen are untouched
  const verifyRes = await apiGet(`/api/projects/${projectA.id}`, userA.cookie, env);
  assert.equal(verifyRes.status, 200);
  const verifyData = await verifyRes.json();
  assert.equal(verifyData.project.name, "Alice Private App");
  assert.equal(verifyData.screens[0].headline, "Alice Secret");
}

console.log("projects-api: all assertions passed");
