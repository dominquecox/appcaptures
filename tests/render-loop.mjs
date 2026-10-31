// Render-review-fix loop tests — plain node, no framework.
// Run: node tests/render-loop.mjs
import { strict as assert } from "node:assert";
import zlib from "node:zlib";
import {
  runLoop,
  checkDimensions,
  checkNoAlpha,
  checkContrast,
} from "../engine/render-loop.js";

// Helper: build minimal valid PNG buffers (RGB 24-bit or RGBA 32-bit, or RGB + tRNS)
function makeCrcTable() {
  const cTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    cTable[n] = c;
  }
  return cTable;
}
const crcTable = makeCrcTable();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const toCrc = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(toCrc), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function createTestPng(width, height, colorType = 2, withTrns = false) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth: 8 bits per sample
  ihdrData[9] = colorType; // 2 = RGB (24-bit), 6 = RGBA (32-bit)
  ihdrData[10] = 0; // deflate
  ihdrData[11] = 0; // adaptive filtering
  ihdrData[12] = 0; // non-interlaced

  const ihdrChunk = makeChunk("IHDR", ihdrData);
  const chunks = [sig, ihdrChunk];

  if (withTrns && colorType === 2) {
    // tRNS for RGB is 6 bytes (transparent RGB color value)
    chunks.push(makeChunk("tRNS", Buffer.alloc(6, 0)));
  }

  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const rawScanline = Buffer.alloc(1 + width * bytesPerPixel, 0);
  const rawData = Buffer.concat(Array(height).fill(rawScanline));
  const compressed = zlib.deflateSync(rawData);
  chunks.push(makeChunk("IDAT", compressed));
  chunks.push(makeChunk("IEND", Buffer.alloc(0)));

  return Buffer.concat(chunks);
}

// -----------------------------------------------------------------------------
// Test 1: Clean pass in 1 iteration when no issues.
// -----------------------------------------------------------------------------
{
  const brief = {
    copy: { headline: "Track Habits" },
    sizes: [{ width: 1290, height: 2796 }],
  };

  const result = await runLoop({
    target: "html",
    brief,
    generate: async (b) => ({
      html: `<h1>${b.copy.headline}</h1>`,
      width: 1290,
      height: 2796,
    }),
    render: async (code, size) => [createTestPng(size.width, size.height, 2)],
    review: async (png, issues) => [],
    fix: async (code, issues) => code,
    maxPasses: 3,
  });

  assert.equal(result.status, "ok", "Test 1: status should be ok");
  assert.equal(result.passes.length, 1, "Test 1: should complete in exactly 1 pass");
  assert.equal(result.passes[0].pass, 1, "Test 1: pass index is 1");
  assert.equal(result.passes[0].issues.length, 0, "Test 1: pass 1 has zero issues");
  assert.equal(result.passes[0].fixed, true, "Test 1: pass 1 fixed is true");
  assert.equal(result.pngs.length, 1, "Test 1: returns 1 png");
  assert.ok(result.code, "Test 1: returns generated code");
}

// -----------------------------------------------------------------------------
// Test 2: Deterministic check catches dimension mismatch, fixes on pass 2, status "ok".
// -----------------------------------------------------------------------------
{
  const brief = {
    sizes: [{ width: 1290, height: 2796 }],
  };

  let fixCalled = false;
  const result = await runLoop({
    target: "html",
    brief,
    generate: async () => ({
      // Initially generates code with incorrect dimensions
      width: 1000,
      height: 2000,
    }),
    render: async (code, size) => [createTestPng(code.width, code.height, 2)],
    fix: async (code, issues) => {
      fixCalled = true;
      assert.ok(
        issues.some((i) => i.type === "dimension_mismatch"),
        "Test 2: fix received dimension_mismatch issue"
      );
      // Correct the dimensions
      return { width: 1290, height: 2796 };
    },
    maxPasses: 3,
  });

  assert.ok(fixCalled, "Test 2: fix was called");
  assert.equal(result.status, "ok", "Test 2: status is ok after fix");
  assert.equal(result.passes.length, 2, "Test 2: completed on pass 2");
  assert.equal(result.passes[0].pass, 1, "Test 2: first pass index is 1");
  assert.equal(result.passes[0].fixed, false, "Test 2: pass 1 fixed is false");
  assert.ok(
    result.passes[0].issues.some((i) => i.type === "dimension_mismatch"),
    "Test 2: pass 1 caught dimension mismatch"
  );
  assert.equal(result.passes[1].pass, 2, "Test 2: second pass index is 2");
  assert.equal(result.passes[1].fixed, true, "Test 2: pass 2 fixed is true");
  assert.equal(result.passes[1].issues.length, 0, "Test 2: pass 2 issues cleared");
  assert.equal(result.code.width, 1290, "Test 2: final code width is 1290");
  assert.equal(result.code.height, 2796, "Test 2: final code height is 2796");
}

// -----------------------------------------------------------------------------
// Test 3: Deterministic check catches alpha channel when transparency present.
// -----------------------------------------------------------------------------
{
  // 3a. Unit checks on binary PNGs and mock structures
  const rgbPng = createTestPng(100, 100, 2);
  const rgbaPng = createTestPng(100, 100, 6);
  const rgbWithTrnsPng = createTestPng(100, 100, 2, true);

  assert.equal(checkNoAlpha(rgbPng), null, "Test 3a: 24-bit RGB PNG has no alpha issue");

  const issueRgba = checkNoAlpha(rgbaPng);
  assert.ok(issueRgba, "Test 3a: 32-bit RGBA PNG triggers alpha issue");
  assert.equal(issueRgba.type, "alpha_channel_detected");
  assert.equal(issueRgba.colorType, 6);

  const issueTrns = checkNoAlpha(rgbWithTrnsPng);
  assert.ok(issueTrns, "Test 3a: tRNS chunk triggers alpha issue");
  assert.equal(issueTrns.type, "alpha_channel_detected");

  // Mock object handling
  assert.equal(checkNoAlpha({ hasAlpha: false, channels: 3 }), null);
  assert.equal(checkNoAlpha({ hasAlpha: true }).type, "alpha_channel_detected");
  assert.equal(checkNoAlpha({ channels: 4 }).type, "alpha_channel_detected");
  assert.equal(checkNoAlpha({ colorType: 6 }).type, "alpha_channel_detected");

  // 3b. End-to-end loop: alpha caught in pass 1, fixed to RGB in pass 2
  const brief = {
    sizes: [{ width: 100, height: 100 }],
  };

  const loopResult = await runLoop({
    brief,
    generate: async () => ({ hasAlpha: true }),
    render: async (code) => [createTestPng(100, 100, code.hasAlpha ? 6 : 2)],
    fix: async (code, issues) => {
      assert.ok(
        issues.some((i) => i.type === "alpha_channel_detected"),
        "Test 3b: fix received alpha issue"
      );
      return { hasAlpha: false };
    },
    maxPasses: 3,
  });

  assert.equal(loopResult.status, "ok", "Test 3b: status ok");
  assert.equal(loopResult.passes.length, 2, "Test 3b: fixed on pass 2");
  assert.ok(
    loopResult.passes[0].issues.some((i) => i.type === "alpha_channel_detected"),
    "Test 3b: pass 1 caught alpha"
  );
  assert.equal(loopResult.passes[1].issues.length, 0, "Test 3b: pass 2 clean");
}

// -----------------------------------------------------------------------------
// Test 4: Reaches maxPasses and returns status "max_passes_reached" when fix does not resolve issues.
// -----------------------------------------------------------------------------
{
  const brief = {
    sizes: [{ width: 1290, height: 2796 }],
  };

  let fixCallCount = 0;
  const result = await runLoop({
    brief,
    generate: async () => ({ width: 500, height: 500 }),
    render: async (code) => [createTestPng(code.width, code.height, 2)],
    fix: async (code, issues) => {
      fixCallCount++;
      // Intentionally returns code that does not resolve the issue
      return code;
    },
    maxPasses: 3,
  });

  assert.equal(result.status, "max_passes_reached", "Test 4: status is max_passes_reached");
  assert.equal(result.passes.length, 3, "Test 4: ran exactly 3 passes");
  assert.equal(fixCallCount, 2, "Test 4: fix called on passes 1 and 2, but not after pass 3");
  assert.equal(result.passes[0].fixed, false, "Test 4: pass 1 fixed false");
  assert.equal(result.passes[1].fixed, false, "Test 4: pass 2 fixed false");
  assert.equal(result.passes[2].fixed, false, "Test 4: pass 3 fixed false");
  assert.ok(result.passes[2].issues.length > 0, "Test 4: final pass has remaining issues");
}

// -----------------------------------------------------------------------------
// Test 5: Contrast check utility enforces WCAG AA.
// -----------------------------------------------------------------------------
{
  // 5a. High contrast (black on white)
  const blackWhite = checkContrast("#000000", "#ffffff");
  assert.equal(blackWhite.ok, true, "Test 5a: #000000 on #ffffff passes");
  assert.equal(blackWhite.ratio, 21, "Test 5a: ratio is 21:1");
  assert.equal(blackWhite.passesNormal, true, "Test 5a: passes normal text (>= 4.5:1)");
  assert.equal(blackWhite.passesLarge, true, "Test 5a: passes large text (>= 3.0:1)");
  assert.equal(blackWhite.issue, undefined, "Test 5a: no issue");

  // 5b. Valid normal text contrast boundary (#767676 is ~4.54:1)
  const boundaryPass = checkContrast("#767676", "#ffffff");
  assert.equal(boundaryPass.ok, true, "Test 5b: #767676 passes normal");
  assert.equal(boundaryPass.passesNormal, true);
  assert.equal(boundaryPass.passesLarge, true);

  // 5c. Fails normal text but passes large text (#777777 is ~4.48:1)
  const boundaryFailNormal = checkContrast("#777777", "#ffffff");
  assert.equal(boundaryFailNormal.ok, false, "Test 5c: #777777 fails normal text");
  assert.equal(boundaryFailNormal.passesNormal, false);
  assert.equal(boundaryFailNormal.passesLarge, true, "Test 5c: passes large text");
  assert.ok(boundaryFailNormal.issue, "Test 5c: issue attached when ok is false");
  assert.equal(boundaryFailNormal.issue.type, "contrast_too_low");

  // With large text flag
  const largeCheck = checkContrast("#777777", "#ffffff", { isLarge: true });
  assert.equal(largeCheck.ok, true, "Test 5c: passes when evaluated for large text");
  assert.equal(largeCheck.minRequired, 3.0);

  // With boolean flag for large
  const largeCheckBool = checkContrast("#777777", "#ffffff", true);
  assert.equal(largeCheckBool.ok, true, "Test 5c: boolean large flag works");

  // 5d. Fails both normal and large text (#999999 is ~2.85:1)
  const lowContrast = checkContrast("#999999", "#ffffff");
  assert.equal(lowContrast.ok, false);
  assert.equal(lowContrast.passesNormal, false);
  assert.equal(lowContrast.passesLarge, false);

  // Same color (1:1)
  const identical = checkContrast("#ffffff", "#ffffff");
  assert.equal(identical.ok, false);
  assert.equal(identical.ratio, 1);

  // 5e. Hex formatting tolerance: 3-digit, uppercase, missing #
  assert.equal(checkContrast("#fff", "#000").ratio, 21);
  assert.equal(checkContrast("fff", "000").ratio, 21);
  assert.equal(checkContrast("FFFFFF", "000000").ratio, 21);
  assert.equal(checkContrast("#AbC", "#123").ok, true);

  // Invalid hex input
  const invalid = checkContrast("not-a-color", "#ffffff");
  assert.equal(invalid.ok, false);
  assert.equal(invalid.issue.type, "contrast_invalid_color");
}

// -----------------------------------------------------------------------------
// Test 6: Vision review and custom checks integration
// -----------------------------------------------------------------------------
{
  const brief = {
    copy: { text: "Title" },
    sizes: [{ width: 100, height: 100 }],
  };

  let reviewCount = 0;
  const result = await runLoop({
    brief,
    generate: async () => ({ text: "Title", overlap: true }),
    render: async () => [createTestPng(100, 100, 2)],
    checks: async (png, code, size) => {
      // Custom user check
      if (code.text.length < 2) {
        return [{ type: "text_too_short", message: "Text too short" }];
      }
      return [];
    },
    review: async (png, issues) => {
      reviewCount++;
      // Vision model detects visual overlap on pass 1
      if (reviewCount === 1) {
        return [{ type: "vision_overlap", message: "Headline overlaps status bar" }];
      }
      return [];
    },
    fix: async (code, issues) => {
      assert.ok(issues.some((i) => i.type === "vision_overlap"));
      return { text: "Title", overlap: false };
    },
    maxPasses: 3,
  });

  assert.equal(result.status, "ok");
  assert.equal(result.passes.length, 2);
  assert.equal(reviewCount, 2);
  assert.ok(result.passes[0].issues.some((i) => i.type === "vision_overlap"));
  assert.equal(result.passes[1].issues.length, 0);
}

// -----------------------------------------------------------------------------
// Test 7: Budget limit halts loop earlier if budget.maxPasses is lower
// -----------------------------------------------------------------------------
{
  const brief = { sizes: [{ width: 100, height: 100 }] };
  const result = await runLoop({
    brief,
    generate: async () => ({ width: 50, height: 50 }),
    render: async (code) => [createTestPng(code.width, code.height, 2)],
    fix: async (code) => code,
    maxPasses: 5,
    budget: { maxPasses: 2 },
  });

  assert.equal(result.status, "max_passes_reached");
  assert.equal(result.passes.length, 2, "Test 7: halted at budget limit 2");
}

console.log("render-loop: all assertions passed");
