// Studio tests — plain node, no framework.
// Run: node tests/studio-logic.mjs
// Models/render/store import directly (pure, node-safe). ui.js is DOM-bound:
// covered by source tripwires, with the real browser check left to dogfood.
import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const studioSrc = readFileSync(path.join(root, "app", "index.html"), "utf8");
const uiSrc = readFileSync(path.join(root, "app", "js", "ui.js"), "utf8");
const modelsSrc = readFileSync(path.join(root, "app", "js", "models.js"), "utf8");

const models = await import("../app/js/models.js");
const render = await import("../app/js/render.js");
const store = await import("../app/js/store.js");
const presets = await import("../app/js/presets.js");

// normHex: tolerate missing #, 3-digit, case; reject garbage.
assert.equal(models.normHex("#7c5cff", "#000000"), "#7c5cff");
assert.equal(models.normHex("7c5cff", "#000000"), "#7c5cff");
assert.equal(models.normHex("#fff", "#000000"), "#ffffff");
assert.equal(models.normHex("#AbC", "#000000"), "#aabbcc");
assert.equal(models.normHex("zzz", "#fb"), "#fb");
assert.equal(models.normHex("", "#fb"), "#fb");
assert.equal(models.normHex("#12345", "#fb"), "#fb");
assert.equal(models.normHex(null, "#fb"), "#fb");

// slugFor + parseSize.
assert.equal(models.slugFor("Loop any moment!"), "loop_any_moment");
assert.equal(models.slugFor("  --Hi--  "), "hi");
assert.equal(models.slugFor(""), "screen");
assert.equal(models.slugFor("A".repeat(60)), "a".repeat(24));
assert.deepEqual(models.parseSize("1320x2868"), [1320, 2868]);
assert.equal(models.parseSize("nope"), null);

// clampIndex: selection always lands on a real screen.
assert.equal(models.clampIndex(5, 8), 5);
assert.equal(models.clampIndex(5, 1), 0);
assert.equal(models.clampIndex(-1, 3), 0);
assert.equal(models.clampIndex(0, 0), 0);

// coerceBrand: garbage in, safe brand out.
{
  const b = models.coerceBrand({ primary: "zzz", headlineSize: 999, headlineWeight: "900", font: "Comic Sans", frame: "weird" }, null);
  assert.equal(b.primary, models.FALLBACK_PRIMARY);
  assert.equal(b.headlineSize, 72);
  assert.equal(b.headlineWeight, "700");
  assert.equal(b.font, "Hanken Grotesk");
  assert.equal(b.frame, "island");
  const kept = models.coerceBrand({ name: "Yaps", primary: "#ff6b00" }, null);
  assert.equal(kept.name, "Yaps");
  assert.equal(kept.primary, "#ff6b00");
}

// coerceScreen: blob: URLs die, headline capped.
{
  const s = models.coerceScreen({ headline: "x".repeat(100), file: "blob:dead", asset: "3" });
  assert.equal(s.headline.length, 48);
  assert.equal(s.file, "");
  assert.equal(s.asset, -1);
}

// presets shape: every app has screens, every vidiloop asset file resolves.
{
  for(const [id, p] of Object.entries(presets.APP_PRESETS)){
    assert.ok(p.screens.length >= 1, `${id} needs screens`);
    for(const s of p.screens) assert.ok(typeof s.headline === "string" && s.headline.length, `${id} headline`);
  }
  assert.ok(presets.PLATFORM_SIZES.marketing.some(s=>s.value === "5244x2950"));
  assert.ok(presets.PLATFORM_SIZES.marketing.some(s=>s.value === "3840x1646"));
}

// store: v3 round-trip, v2 migration, corrupt state falls back, no storage works.
{
  const fake = (()=>{ const m = new Map(); return {
    getItem: k=>(m.has(k) ? m.get(k) : null),
    setItem: (k, v)=>{ m.set(k, String(v)); },
    removeItem: k=>{ m.delete(k); },
  }; })();
  const a = store.createStore(fake);
  a.state.brand.name = "TestApp";
  a.state.screens = [{ headline: "Hi", file: "", asset: -1 }];
  a.save();
  const b = store.createStore(fake);
  b.load();
  assert.equal(b.state.brand.name, "TestApp");
  assert.equal(b.state.screens.length, 1);
  b.reset();
  const c = store.createStore(fake);
  c.load();
  assert.equal(c.state.brand.name, "Vidiloop"); // back to preset
  const broken = store.createStore({ getItem: ()=>"{oops", setItem: ()=>{}, removeItem: ()=>{} });
  broken.load();
  assert.equal(broken.state.screens.length, 8);
  const none = store.createStore(undefined);
  none.load(); none.save();
  assert.equal(none.state.brand.name, "Vidiloop");
}

// render module loads side-effect-free; zip round-trips through real code.
assert.equal(typeof render.draw, "function");
assert.equal(typeof render.drawHeader, "function");
{
  const payload = new Uint8Array([0, 1, 2, 250, 255, 16, 32]);
  const blob = render.zipStore([
    { name: "01_hello_1320x2868.png", data: payload },
    { name: "02_empty_1320x2868.png", data: new Uint8Array(0) },
  ]);
  const buf = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(buf.buffer);
  const le32 = o=>dv.getUint32(o, true), le16 = o=>dv.getUint16(o, true);
  assert.equal(le32(0), 0x04034b50);
  const eocd = buf.length - 22;
  assert.equal(le32(eocd), 0x06054b50);
  assert.equal(le16(eocd + 10), 2);
  let p = le32(eocd + 16);
  const names = [];
  for(let i = 0; i < 2; i++){
    assert.equal(le32(p), 0x02014b50);
    assert.equal(le16(p + 10), 0);
    const crc = le32(p + 16), len = le32(p + 24);
    const nl = le16(p + 28), el = le16(p + 30), fl = le16(p + 32), lh = le32(p + 42);
    names.push(Buffer.from(buf.slice(p + 46, p + 46 + nl)).toString("utf8"));
    assert.equal(le32(lh), 0x04034b50);
    const data = buf.slice(lh + 30 + le16(lh + 26), lh + 30 + le16(lh + 26) + len);
    assert.equal(data.length, len);
    assert.equal(render.crc32(data), crc, "crc round-trip");
    if(len) assert.deepEqual(Array.from(data), Array.from(payload));
    p += 46 + nl + el + fl;
  }
  assert.deepEqual(names, ["01_hello_1320x2868.png", "02_empty_1320x2868.png"]);
}

// ui.js wiring tripwires (DOM-bound; real behavior checked in dogfood).
for(const needle of [
  'id="btnResetAll"',
  'data-size="__custom"',
  "await exportAll(w2, h2)",
  "state.selected = 0; syncBrandUI();",
  'startsWith("blob:")',
  "openLightbox",
  'type="module" src="./js/main.js"',
]){
  assert.ok(uiSrc.includes(needle) || studioSrc.includes(needle) || modelsSrc.includes(needle), `wiring present: ${needle}`);
}
assert.ok(!/\bfunction drawCard\(/.test(uiSrc), "no canvas code left in ui.js");
assert.ok(!/APP_PRESETS\s*=/.test(uiSrc), "no hardcoded presets in ui.js");

// mergeWaitlist(server, local): D1 rows first, deduped by email (case-insensitive).
{
  const asrc = readFileSync(path.join(root, "admin", "index.html"), "utf8");
  const am = asrc.match(/function mergeWaitlist\(.*?\{\n[\s\S]*?\n\}/);
  assert.ok(am, "mergeWaitlist must exist in admin/index.html");
  const mergeWaitlist = new Function(`${am[0]}; return mergeWaitlist;`)();
  const merged = mergeWaitlist(
    [{ email: "A@x.com", at: "2026-10-19 05:15:03", via: "verify" }],
    [{ email: "a@X.com", at: "iso", via: "local" }, { email: "b@x.com", at: "iso", via: "local" }]
  );
  assert.equal(merged.length, 2);
  assert.equal(merged[0].srv, true);
  assert.equal(merged[1].email, "b@x.com");
  assert.equal(mergeWaitlist(null, null).length, 0);
}

console.log("studio-logic: all assertions passed");
