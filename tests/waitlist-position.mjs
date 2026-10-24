// Waitlist position tests — plain node, no framework. Run: node tests/waitlist-position.mjs
// Drives the REAL worker.js with a fake D1. Contract: one row per email
// (case-insensitive, trimmed, lowercased), position = ordinal join order,
// duplicates return their ORIGINAL position, invalid input 400s.
import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(path.join(root, "worker.js"), "utf8");
const worker = new Function(`${src.replace("export default", "const __w =")}; return __w;`)();

function fakeDB() {
  const rows = [];
  let t = 0;
  return {
    rows,
    prepare(sql) {
      return {
        _a: [],
        bind(...a) { this._a = a; return this; },
        async run() {
          if(/INSERT/i.test(sql)) {
            const [email, platform, source] = this._a;
            if(!rows.some(r=>r.email === email)) rows.push({ id: rows.length + 1, email, platform, source, at: `2026-01-01 00:00:${String(t++).padStart(2, "0")}` });
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

const env = { DB: fakeDB() };
let r = await worker.fetch(req({ email: "First@x.com", source: "web" }), env);
assert.deepEqual(await r.json(), { ok: true, position: 1 });
r = await worker.fetch(req({ email: "second@x.com" }), env);
assert.deepEqual(await r.json(), { ok: true, position: 2 });
// duplicate (different case): same row, ORIGINAL position — not the total.
r = await worker.fetch(req({ email: "FIRST@x.com", source: "other" }), env);
assert.deepEqual(await r.json(), { ok: true, position: 1 });
assert.equal(env.DB.rows.length, 2, "one row per address");
// invalid input never touches the table.
for(const bad of [{}, { email: "" }, { email: "nope" }, { email: "a@b" }]) {
  r = await worker.fetch(req(bad), env);
  assert.equal(r.status, 400);
}
assert.equal(env.DB.rows.length, 2);

console.log("waitlist-position: all assertions passed");
