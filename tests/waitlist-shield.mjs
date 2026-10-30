// Waitlist bot-shield tests — plain node, no framework. Run: node tests/waitlist-shield.mjs
// Loads the REAL worker.js and drives POST /api/waitlist with a fake D1 and
// a stubbed siteverify endpoint. The shield is env-gated: unset secret =
// today's open behavior, byte for byte.
import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(path.join(root, "worker.js"), "utf8");
const worker = new Function(`${src.replace("export default", "const __w =")}; return __w;`)();

function fakeDB() {
  const rows = [];
  return {
    rows,
    prepare(sql) {
      return {
        _a: [],
        bind(...a) { this._a = a; return this; },
        async run() {
          if(/INSERT(\s+OR\s+IGNORE)?\s+INTO waitlist/i.test(sql)){
            const [email, platform, source] = this._a;
            if(!rows.some(r=>r.email === email)) rows.push({ id: rows.length + 1, email, platform, source, at: "2026-01-01 00:00:00" });
          }
          return {};
        },
        async first() {
          if(/COUNT\(\*\)/i.test(sql)) {
            if(/WHERE at </i.test(sql)) { const [at, , id] = this._a; return { c: rows.filter(r=>r.at < at || (r.at === at && r.id <= id)).length }; }
            return { c: rows.length };
          }
          if(/SELECT at/i.test(sql)) {
            const [email] = this._a;
            const r = rows.find(x=>x.email === email);
            return r ? { at: r.at, id: r.id } : null;
          }
          return null;
        },
        async all() { return { results: rows.map(r=>({ email: r.email, at: r.at, via: r.source })) }; },
      };
    },
  };
}
const req = (body) => new Request("http://t/api/waitlist", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const realFetch = globalThis.fetch;

async function withSiteverify(mode, fn){
  let seen = null;
  globalThis.fetch = async (url, init) => {
    assert.ok(String(url).includes("siteverify"), "only siteverify is fetched");
    seen = { url: String(url), body: String(init.body) };
    if(mode === "throw") throw new Error("down");
    return Response.json(mode === "ok" ? { success: true } : { success: false });
  };
  try{ return { r: await fn(), seen }; }
  finally{ globalThis.fetch = realFetch; }
}

// unset secret: open behavior unchanged (incl. never calling siteverify).
{
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error("must not fetch"); };
  try{
    const r = await worker.fetch(req({ email: "open@x.com" }), { DB: fakeDB() });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, position: 1 });
    assert.equal(called, false);
  } finally{ globalThis.fetch = realFetch; }
}

// prod fail-closed: unset secret in prod returns 403 forbidden and 0 rows inserted.
{
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error("must not fetch"); };
  try {
    const db = fakeDB();
    const env = { DB: db, ENV: "prod" };
    const r = await worker.fetch(req({ email: "prod@x.com" }), env);
    assert.equal(r.status, 403);
    assert.deepEqual(await r.json(), { error: "forbidden" });
    assert.equal(called, false);
    assert.equal(db.rows.length, 0, "no row inserted on prod fail-closed");
  } finally { globalThis.fetch = realFetch; }
}

// secret set: valid token passes, secret actually sent.
{
  const { r, seen } = await withSiteverify("ok", () =>
    worker.fetch(req({ email: "human@x.com", turnstile: "tok123" }), { DB: fakeDB(), TURNSTILE_SECRET: "s3cr3t" }));
  assert.equal(r.status, 200);
  assert.ok(seen.body.includes("secret=s3cr3t"), "secret transmitted");
  assert.ok(seen.body.includes("response=tok123"), "token transmitted");
}

// secret set: failed verify, missing token, oversized token, outage all 403.
{
  const env = { DB: fakeDB(), TURNSTILE_SECRET: "s3cr3t" };
  let out = await withSiteverify("fail", () =>
    worker.fetch(req({ email: "bot@x.com", turnstile: "bad" }), env));
  assert.equal(out.r.status, 403);
  out = await withSiteverify("ok", () => worker.fetch(req({ email: "bot@x.com" }), env));
  assert.equal(out.r.status, 403);
  out = await withSiteverify("ok", () =>
    worker.fetch(req({ email: "bot@x.com", turnstile: "x".repeat(2049) }), env));
  assert.equal(out.r.status, 403);
  out = await withSiteverify("throw", () =>
    worker.fetch(req({ email: "bot@x.com", turnstile: "tok" }), env));
  assert.equal(out.r.status, 403);
  assert.equal(env.DB.rows.length, 0, "no row stored on rejection");
}

console.log("waitlist-shield: all assertions passed");
