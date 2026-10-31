// Test suite for store size registry matching official Apple and Play specs.
// Run: node tests/store-sizes.mjs

import { strict as assert } from "node:assert";
import zlib from "node:zlib";
import * as presets from "../app/js/presets.js";
import * as models from "../app/js/models.js";
import {
  STORE_SIZES,
  STORE_SIZE_REGISTRY,
  GOOGLE_PLAY_SIZES,
  APPLE_SIZES,
  REQUIRED_IOS_SIZES,
  SUPPORTED_APPLE_CANONICAL,
  validateStoreSize,
  assertNoAlpha,
} from "../engine/store-sizes.js";

// Helper to construct real, valid PNG binaries in memory with specific color types and chunks.
function createTestPng(colorType, { withTrns = false } = {}) {
  const crc32Table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
    crc32Table[i] = c >>> 0;
  }

  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c = crc32Table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  }

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR data: 13 bytes
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(1, 0); // width = 1
  ihdrData.writeUInt32BE(1, 4); // height = 1
  ihdrData[8] = 8; // 8 bits per channel
  ihdrData[9] = colorType; // 0=gray, 2=RGB, 4=gray+alpha, 6=RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdrChunk = makeChunk("IHDR", ihdrData);

  const chunks = [sig, ihdrChunk];

  if (withTrns) {
    // Optional tRNS chunk for transparency in RGB/indexed
    const trnsData = Buffer.from([0, 0, 0, 0, 0, 0]);
    chunks.push(makeChunk("tRNS", trnsData));
  }

  // Scanline: filter byte 0 followed by pixel bytes
  let rawPixels;
  if (colorType === 0) rawPixels = Buffer.from([0, 128]);
  else if (colorType === 2) rawPixels = Buffer.from([0, 255, 0, 0]);
  else if (colorType === 4) rawPixels = Buffer.from([0, 128, 255]);
  else if (colorType === 6) rawPixels = Buffer.from([0, 255, 0, 0, 255]);
  else rawPixels = Buffer.from([0, 0]);

  const compressed = zlib.deflateSync(rawPixels);
  chunks.push(makeChunk("IDAT", compressed));
  chunks.push(makeChunk("IEND", Buffer.alloc(0)));

  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------------
// 1. Assert all Google Play sizes in app/js/presets.js and engine/store-sizes.js satisfy ratio <= 2.0
// ---------------------------------------------------------------------
{
  assert.ok(presets.PLATFORM_SIZES.android.length >= 2, "presets must define Android sizes");

  for (const s of presets.PLATFORM_SIZES.android) {
    const parsed = models.parseSize(s.value);
    assert.ok(parsed, `presets size ${s.value} must be parseable`);
    const [w, h] = parsed;
    const ratio = Math.max(w, h) / Math.min(w, h);
    assert.ok(
      ratio <= 2.0,
      `presets Android size ${s.value} violates Google Play 2:1 rule! Ratio is ${ratio.toFixed(3)}:1`
    );
  }

  // Confirm old violations are gone
  assert.ok(
    !presets.PLATFORM_SIZES.android.some(s => s.value === "1080x2400"),
    "1080x2400 (ratio 2.22:1) must be removed from presets"
  );
  assert.ok(
    !presets.PLATFORM_SIZES.android.some(s => s.value === "1440x3120"),
    "1440x3120 (ratio 2.17:1) must be removed from presets"
  );

  // Confirm standard compliant replacements are present
  assert.ok(
    presets.PLATFORM_SIZES.android.some(s => s.value === "1080x1920"),
    "1080x1920 (standard 9:16) must be present in presets.android"
  );
  assert.ok(
    presets.PLATFORM_SIZES.android.some(s => s.value === "1440x2560"),
    "1440x2560 (standard QHD 9:16) must be present in presets.android"
  );

  // Check engine registry: all Google Play screenshot sizes must satisfy ratio <= 2.0
  assert.ok(GOOGLE_PLAY_SIZES.length >= 4, "engine must define Google Play screenshot sizes");
  for (const s of GOOGLE_PLAY_SIZES) {
    const ratio = Math.max(s.width, s.height) / Math.min(s.width, s.height);
    assert.ok(
      ratio <= 2.0,
      `engine Google Play size ${s.id} (${s.width}x${s.height}) violates 2:1 rule! Ratio is ${ratio.toFixed(3)}:1`
    );
    assert.equal(s.maxRatio, 2.0, `${s.id} maxRatio metadata must be 2.0`);
  }

  const allPlayScreenshotsInRegistry = STORE_SIZES.filter(
    s => (s.platform === "google_play" || s.platform === "google" || s.platform === "android") && s.category === "screenshot"
  );
  for (const s of allPlayScreenshotsInRegistry) {
    const ratio = Math.max(s.width, s.height) / Math.min(s.width, s.height);
    assert.ok(
      ratio <= 2.0,
      `Registry entry ${s.id} must satisfy ratio <= 2.0 (got ${ratio.toFixed(3)})`
    );
  }
}

// ---------------------------------------------------------------------
// 2. Assert required iOS sizes (1179×2556, 1260×2736, 1242×2688, 2048×2732) exist in registry
// ---------------------------------------------------------------------
{
  const requiredTargets = [
    { w: 1179, h: 2556, desc: "iOS Dynamic Island medium (REQUIRED)" },
    { w: 1260, h: 2736, desc: "iOS Dynamic Island large (iPhone Air)" },
    { w: 1242, h: 2688, desc: "iOS Face ID large" },
    { w: 2048, h: 2732, desc: "iPad 13\"" },
  ];

  for (const target of requiredTargets) {
    const foundInRegistry = STORE_SIZES.find(
      s => s.platform === "apple" && s.width === target.w && s.height === target.h
    );
    assert.ok(foundInRegistry, `engine STORE_SIZES must contain ${target.desc} (${target.w}x${target.h})`);
    assert.equal(foundInRegistry.category, "screenshot");

    const foundInPresets = presets.PLATFORM_SIZES.ios.find(
      s => s.value === `${target.w}x${target.h}`
    );
    assert.ok(foundInPresets, `presets.PLATFORM_SIZES.ios must contain ${target.desc} (${target.w}x${target.h})`);
  }

  // 1179x2556 and 2048x2732 are required classes in App Store Connect
  const diMedium = STORE_SIZES.find(s => s.platform === "apple" && s.width === 1179 && s.height === 2556);
  assert.equal(diMedium.required, true, "1179x2556 must have required: true");

  const ipad13 = STORE_SIZES.find(s => s.platform === "apple" && s.width === 2048 && s.height === 2732);
  assert.equal(ipad13.required, true, "2048x2732 must have required: true");
}

// ---------------------------------------------------------------------
// 3. Assert Play feature graphic (1024×500) and store icons (512×512, 1024×1024) exist
// ---------------------------------------------------------------------
{
  // Google Play feature graphic: 1024x500
  const playGraphic = STORE_SIZES.find(
    s => s.platform === "google_play" && s.category === "feature_graphic" && s.width === 1024 && s.height === 500
  );
  assert.ok(playGraphic, "engine STORE_SIZES must contain Google Play feature graphic 1024x500");
  assert.equal(playGraphic.required, true, "Play feature graphic is required by Google Play Console");

  const playGraphicPreset = presets.PLATFORM_SIZES.marketing.find(s => s.value === "1024x500");
  assert.ok(playGraphicPreset, "presets.PLATFORM_SIZES.marketing must contain 1024x500 feature graphic");

  // Google Play app icon: 512x512
  const playIcon = STORE_SIZES.find(
    s => s.platform === "google_play" && s.category === "icon" && s.width === 512 && s.height === 512
  );
  assert.ok(playIcon, "engine STORE_SIZES must contain Google Play app icon 512x512");
  assert.equal(playIcon.required, true, "Play app icon is required by Google Play Console");

  const playIconPreset = presets.PLATFORM_SIZES.marketing.find(s => s.value === "512x512");
  assert.ok(playIconPreset, "presets.PLATFORM_SIZES.marketing must contain 512x512 Play icon");

  // Apple App Store icon: 1024x1024
  const appleIcon = STORE_SIZES.find(
    s => s.platform === "apple" && s.category === "icon" && s.width === 1024 && s.height === 1024
  );
  assert.ok(appleIcon, "engine STORE_SIZES must contain Apple App Store icon 1024x1024");
  assert.equal(appleIcon.required, true, "App Store icon is required by App Store Connect");

  const appleIconPreset = presets.PLATFORM_SIZES.marketing.find(s => s.value === "1024x1024");
  assert.ok(appleIconPreset, "presets.PLATFORM_SIZES.marketing must contain 1024x1024 App Store icon");

  // STORE_PREVIEWS export in presets
  assert.ok(Array.isArray(presets.STORE_PREVIEWS), "presets must export STORE_PREVIEWS");
  assert.ok(presets.STORE_PREVIEWS.some(s => s.value === "1024x500"));
  assert.ok(presets.STORE_PREVIEWS.some(s => s.value === "512x512"));
  assert.ok(presets.STORE_PREVIEWS.some(s => s.value === "1024x1024"));
}

// ---------------------------------------------------------------------
// 4. Assert validateStoreSize accepts valid sizes and rejects violations
// ---------------------------------------------------------------------
{
  // Google Play valid sizes
  assert.equal(validateStoreSize("google", 1080, 1920), true, "Play accepts 1080x1920 (ratio 1.78 <= 2.0)");
  assert.equal(validateStoreSize("play", 1440, 2560), true, "Play accepts 1440x2560 (ratio 1.78 <= 2.0)");
  assert.equal(validateStoreSize("android", 1080, 2160), true, "Play accepts 1080x2160 (ratio exactly 2.0)");
  assert.equal(validateStoreSize("google_play", 720, 1280), true, "Play accepts 720x1280");
  assert.equal(validateStoreSize("google", 1920, 1080), true, "Play accepts landscape 1920x1080");
  assert.equal(validateStoreSize("play", 320, 640), true, "Play accepts boundary min 320x640");
  assert.equal(validateStoreSize("play", 1920, 3840), true, "Play accepts boundary max 1920x3840");

  // Google Play rejected violations
  assert.equal(validateStoreSize("google", 1080, 2400), false, "Play rejects 1080x2400 (ratio 2.22:1 > 2:1)");
  assert.equal(validateStoreSize("play", 1440, 3120), false, "Play rejects 1440x3120 (ratio 2.17:1 > 2:1)");
  assert.equal(validateStoreSize("android", 1080, 2400), false, "Play rejects 1080x2400 on 'android' platform name");
  assert.equal(validateStoreSize("google", 319, 600), false, "Play rejects min dimension < 320 px");
  assert.equal(validateStoreSize("google", 1920, 3841), false, "Play rejects max dimension > 3840 px");
  assert.equal(validateStoreSize("google", 1000, 2001), false, "Play rejects long side > 2 * short side");
  assert.equal(validateStoreSize("google", 0, 1920), false, "Play rejects zero dimension");
  assert.equal(validateStoreSize("google", -100, -200), false, "Play rejects negative dimension");

  // Apple valid sizes (portrait and landscape)
  assert.equal(validateStoreSize("apple", 1179, 2556), true, "Apple accepts 1179x2556 portrait");
  assert.equal(validateStoreSize("ios", 2556, 1179), true, "Apple accepts 2556x1179 landscape swap");
  assert.equal(validateStoreSize("apple", 1260, 2736), true, "Apple accepts 1260x2736 (iPhone Air)");
  assert.equal(validateStoreSize("ios", 1242, 2688), true, "Apple accepts 1242x2688 (Face ID large)");
  assert.equal(validateStoreSize("apple", 2048, 2732), true, "Apple accepts 2048x2732 (iPad 13\")");
  assert.equal(validateStoreSize("apple", 2064, 2752), true, "Apple accepts 2064x2752 (iPad Pro M4)");
  assert.equal(validateStoreSize("ios", 1320, 2868), true, "Apple accepts 1320x2868 (iPhone 16 Pro Max)");
  assert.equal(validateStoreSize("apple", 1024, 1024), true, "Apple accepts 1024x1024 App Store icon");

  // Apple rejected violations
  assert.equal(validateStoreSize("apple", 1080, 2400), false, "Apple rejects non-Apple resolution 1080x2400");
  assert.equal(validateStoreSize("apple", 999, 999), false, "Apple rejects arbitrary dimension 999x999");
  assert.equal(validateStoreSize("ios", 1000, 2000), false, "Apple rejects arbitrary dimension 1000x2000");
  assert.equal(validateStoreSize("apple", 0, 0), false, "Apple rejects zero dimensions");

  // Unknown platform
  assert.equal(validateStoreSize("unknown_platform", 1080, 1920), false, "Rejects unknown platform");
  assert.equal(validateStoreSize(null, 1080, 1920), false, "Rejects null platform");
}

// ---------------------------------------------------------------------
// 5. Assert assertNoAlpha accepts 24-bit RGB PNG (color type 2) and rejects RGBA PNG (color type 6)
// ---------------------------------------------------------------------
{
  const rgbPng = createTestPng(2); // 24-bit Truecolor RGB (no alpha)
  assert.equal(rgbPng[25], 2, "RGB PNG byte 25 must be color type 2");
  assert.doesNotThrow(() => {
    const res = assertNoAlpha(rgbPng);
    assert.equal(res, true, "assertNoAlpha returns true for 24-bit RGB PNG");
  }, "assertNoAlpha must accept 24-bit RGB PNG without throwing");

  const grayPng = createTestPng(0); // 8-bit Greyscale (no alpha)
  assert.equal(grayPng[25], 0, "Greyscale PNG byte 25 must be color type 0");
  assert.doesNotThrow(() => {
    assert.equal(assertNoAlpha(grayPng), true);
  }, "assertNoAlpha must accept greyscale PNG without alpha");

  // RGBA PNG (color type 6) must be rejected
  const rgbaPng = createTestPng(6); // 32-bit RGBA
  assert.equal(rgbaPng[25], 6, "RGBA PNG byte 25 must be color type 6");
  assert.throws(
    () => assertNoAlpha(rgbaPng),
    /alpha channel|RGBA/i,
    "assertNoAlpha must throw when color type is 6 (RGBA)"
  );

  // Greyscale + Alpha PNG (color type 4) must be rejected
  const grayAlphaPng = createTestPng(4);
  assert.equal(grayAlphaPng[25], 4, "Greyscale+alpha byte 25 must be color type 4");
  assert.throws(
    () => assertNoAlpha(grayAlphaPng),
    /alpha/i,
    "assertNoAlpha must throw when color type is 4 (greyscale+alpha)"
  );

  // PNG with tRNS chunk must be rejected
  const rgbWithTrns = createTestPng(2, { withTrns: true });
  assert.throws(
    () => assertNoAlpha(rgbWithTrns),
    /transparency|tRNS/i,
    "assertNoAlpha must throw when transparency tRNS chunk is detected"
  );

  // Invalid buffers
  assert.throws(() => assertNoAlpha(null), TypeError, "assertNoAlpha throws TypeError on null");
  assert.throws(() => assertNoAlpha(Buffer.from("not a png")), /Invalid PNG/i, "assertNoAlpha throws on non-PNG");
  assert.throws(() => assertNoAlpha(Buffer.alloc(10)), /too short|Invalid PNG/i, "assertNoAlpha throws on short buffer");
}

console.log("store-sizes: all assertions passed");
