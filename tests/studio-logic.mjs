// Studio logic regression tests — plain node, no framework.
// Run: node tests/studio-logic.mjs
// Exercises the REAL functions extracted from app/index.html source
// (normHex, slugFor, clampSelected) plus source tripwires for the
// export-sequencing and selection-reset fixes.
import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(path.join(root, "app", "index.html"), "utf8");

function extract(name) {
  const m = src.match(new RegExp(`function ${name}\\(.*?\\{[\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} must exist in app/index.html`);
  return m[0];
}

// normHex(v, fallback): tolerate missing #, 3-digit, case; reject garbage.
const normHex = new Function(`${extract("normHex")}; return normHex;`)();
assert.equal(normHex("#7c5cff", "#000000"), "#7c5cff");
assert.equal(normHex("7c5cff", "#000000"), "#7c5cff");
assert.equal(normHex("#fff", "#000000"), "#ffffff");
assert.equal(normHex("#AbC", "#000000"), "#aabbcc");
assert.equal(normHex("zzz", "#fb"), "#fb");
assert.equal(normHex("", "#fb"), "#fb");
assert.equal(normHex("#12345", "#fb"), "#fb");
assert.equal(normHex(null, "#fb"), "#fb");

// slugFor(headline): export filename slug with "screen" fallback.
const slugFor = new Function(`${extract("slugFor")}; return slugFor;`)();
assert.equal(slugFor("Loop any moment!"), "loop_any_moment");
assert.equal(slugFor("  --Hi--  "), "hi");
assert.equal(slugFor(""), "screen");
assert.equal(slugFor("A".repeat(60)), "a".repeat(24));

// clampSelected(): selection always lands on a real screen.
const clampSrc = extract("clampSelected");
const runClamp = (nScreens, sel) =>
  new Function("screens", "selected", `${clampSrc}; return clampSelected();`)(
    new Array(nScreens).fill({}), sel
  );
assert.equal(runClamp(8, 5), 5);
assert.equal(runClamp(1, 5), 0);
assert.equal(runClamp(3, -1), 0);

// Tripwires: sequential both-platform export, selection reset on app switch,
// dead blob: URLs cleared on load, empty-headline fallback in drawCard.
assert.ok(src.includes("await exportAll(w2,h2)"), "both-platform export must be sequential");
assert.ok(src.includes('selected=0; syncBrandUI();'), "app switch must reset selection");
assert.ok(src.includes('startsWith("blob:")'), "blob: URLs must be cleared on load");
assert.ok(src.includes('headline = headline || "Untitled"'), "drawCard needs empty-headline fallback");

// mergeWaitlist(server, local): D1 rows first, deduped by email (case-insensitive).
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
assert.equal(merged[0].via, "verify");
assert.equal(merged[1].email, "b@x.com");
assert.equal(mergeWaitlist(null, null).length, 0);

// Marketing headers: Apple sizes, landscape renderer, custom entry.
assert.ok(src.includes("5244x2950") && src.includes("3840x1646"), "marketing header sizes present");
assert.ok(src.includes("function drawHeader("), "landscape header renderer present");
assert.ok(src.includes('data-size="__custom"'), "custom size entry present");
assert.ok(src.includes("function paintCover("), "shared cover-fit helper present");
assert.ok(src.includes('id="btnResetAll"'), "studio reset button present");

// zipStore round-trip: build a real zip from the repo's own code, parse it
// back (local headers, central directory, end record), verify CRC + bytes.
function extractBalanced(marker) {
  const i = src.indexOf(marker);
  assert.ok(i >= 0, `${marker} must exist in app/index.html`);
  let j = src.indexOf("{", i), depth = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === "{") depth++;
    else if (src[k] === "}") { depth--; if (!depth) return src.slice(i, k + 1); }
  }
  throw new Error(`unbalanced block at ${marker}`);
}
const zipSrc = extractBalanced("const CRC_T") + ")()" + "\n" + extractBalanced("function crc32") + "\n" + extractBalanced("function zipStore");
const zipStore = new Function(`${zipSrc}; return zipStore;`)();
const payload = new Uint8Array([0, 1, 2, 250, 255, 16, 32]);
const blob = zipStore([
  { name: "01_hello_1320x2868.png", data: payload },
  { name: "02_empty_1320x2868.png", data: new Uint8Array(0) },
]);
const buf = new Uint8Array(await blob.arrayBuffer());
const dv = new DataView(buf.buffer);
const le32 = (o) => dv.getUint32(o, true);
const le16 = (o) => dv.getUint16(o, true);
assert.equal(le32(0), 0x04034b50, "local header signature");
const eocd = buf.length - 22;
assert.equal(le32(eocd), 0x06054b50, "end-of-central-directory signature");
const count = le16(eocd + 10), cdOff = le32(eocd + 16);
assert.equal(count, 2);
let p = cdOff;
const names = [];
for (let i = 0; i < count; i++) {
  assert.equal(le32(p), 0x02014b50, "central entry signature");
  const method = le16(p + 10), crc = le32(p + 16), len = le32(p + 24);
  const nl = le16(p + 28), el = le16(p + 30), fl = le16(p + 32), lh = le32(p + 42);
  assert.equal(method, 0, "stored (no compression)");
  names.push(Buffer.from(buf.slice(p + 46, p + 46 + nl)).toString("utf8"));
  assert.equal(le32(lh), 0x04034b50, "local header at recorded offset");
  const data = buf.slice(lh + 30 + le16(lh + 26), lh + 30 + le16(lh + 26) + len);
  assert.equal(data.length, len);
  const T = new Function(`${extractBalanced("const CRC_T")})(); return CRC_T;`)();
  let c = 0xffffffff;
  for (const b of data) c = T[(c ^ b) & 255] ^ (c >>> 8);
  assert.equal((c ^ 0xffffffff) >>> 0, crc, "crc round-trip");
  if (len) assert.deepEqual(Array.from(data), Array.from(payload));
  p += 46 + nl + el + fl;
}
assert.deepEqual(names, ["01_hello_1320x2868.png", "02_empty_1320x2868.png"]);

console.log("studio-logic: all assertions passed");
