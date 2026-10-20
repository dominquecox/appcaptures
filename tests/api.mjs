// Worker API tests — plain node, no framework. Run: node tests/api.mjs
// Loads the REAL worker.js (ESM source, evaluated with stub globals) and
// drives fetch() with a fake D1 + fake queue. Waitlist behavior here is the
// production contract: do not weaken these assertions to fit a change.
import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(path.join(root, "worker.js"), "utf8");
const worker = new Function(`${src.replace("export default", "const __w =")}; return __w;`)();

// Minimal fake D1: INSERT (unique email), COUNT(*), SELECT-all.
function fakeDB() {
  const rows = [];
  return {
    rows,
    prepare(sql) {
      return {
        _a: [],
        bind(...a) { this._a = a; return this; },
        async run() {
          if (/INSERT INTO waitlist/i.test(sql)) {
            const [email, platform, source] = this._a;
            if (rows.some((r) => r.email === email)) throw new Error("UNIQUE constraint");
            rows.push({ email, platform, source, at: "2026-01-01 00:00:00" });
          }
          return {};
        },
        async first() {
          if (/COUNT\(\*\)/i.test(sql)) return { c: rows.length };
          return null;
        },
        async all() {
          // mirror the real SELECT: email, at, source AS via
          return { results: rows.map((r) => ({ email: r.email, at: r.at, via: r.source })) };
        },
      };
    },
  };
}
const req = (p, init) => new Request(`http://t${p}`, init);
const post = (p, body, env) =>
  worker.fetch(
    req(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    env
  );

// --- waitlist contract (production) ---
{
  const env = { DB: fakeDB() };
  let r = await post("/api/waitlist", { email: "a@x.com", source: "t" }, env);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, position: 1 });
  r = await post("/api/waitlist", { email: "b@x.com" }, env);
  assert.deepEqual(await r.json(), { ok: true, position: 2 });
  r = await post("/api/waitlist", { email: "a@x.com" }, env); // duplicate keeps position
  assert.deepEqual(await r.json(), { ok: true, position: 2 });
  r = await post("/api/waitlist", { email: "nope" }, env);
  assert.equal(r.status, 400);
  r = await worker.fetch(req("/api/waitlist"), env);
  assert.equal(r.status, 200);
  const list = await r.json();
  assert.equal(list.items.length, 2);
  assert.equal(list.items[0].via, "t");
  assert.equal(list.items[1].via, null); // b@x.com had no source -> null survives
}
{
  const r = await worker.fetch(req("/api/waitlist"), {}); // no binding
  assert.equal(r.status, 503);
}

// --- health ---
{
  const r = await worker.fetch(req("/api/health"), { DB: fakeDB() });
  assert.deepEqual(await r.json(), { ok: true, version: 1, db: true, ai: false, queue: false });
}

// --- listing/generate: validation now, model later ---
{
  const env = {};
  let r = await post("/api/listing/generate", {}, env);
  assert.equal(r.status, 400);
  r = await post("/api/listing/generate", { appId: "vidiloop", screenshots: ["a"], locale: "english" }, env);
  assert.equal(r.status, 400);
  r = await post(
    "/api/listing/generate",
    { appId: "vidiloop", screenshots: ["a", "b"], locale: "en-US" },
    env
  );
  assert.equal(r.status, 501);
  assert.deepEqual(await r.json(), { ok: false, error: "ai not configured" });
}

// --- exports: validation now, queue later ---
{
  const sent = [];
  const env = { EXPORT_QUEUE: { send: async (m) => sent.push(m) } };
  let r = await post("/api/exports", {}, env);
  assert.equal(r.status, 400);
  r = await post("/api/exports", { appId: "v", size: "1320x2868", screens: [{}, {}] }, {});
  assert.equal(r.status, 501);
  r = await post("/api/exports", { appId: "v", size: "1320x2868", screens: [{}, {}] }, env);
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.ok, true);
  assert.equal(b.status, "queued");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].id, b.id);
}

console.log("api: all assertions passed");
