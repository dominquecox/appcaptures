// Store size registry and validation engine for AppCaptures.
// Official specs: Apple App Store Connect & Google Play Console.

/**
 * Supported Apple device resolutions in canonical orientation: minDim x maxDim.
 * Apple accepts both portrait and landscape orientation for all screenshots.
 */
export const SUPPORTED_APPLE_CANONICAL = new Set([
  // iPhone Duo
  "1398x2034", // Duo outer
  "2007x2853", // Duo inner
  // Dynamic Island large (iPhone 16 Pro Max, 16 Plus, 15 Pro Max, 15 Plus, 14 Pro Max, iPhone Air)
  "1320x2868",
  "1290x2796",
  "1260x2736", // iPhone Air
  // Face ID large (iPhone 14 Plus, 13/12/11 Pro Max, 11, XS Max, XR)
  "1284x2778",
  "1242x2688",
  // Dynamic Island medium (REQUIRED class in App Store Connect!)
  "1206x2622",
  "1179x2556",
  // Face ID medium (iPhone 14, 13 Pro/13/13 mini, 12 Pro/12/12 mini, 11 Pro, XS, X)
  "1170x2532",
  "1125x2436",
  "1080x2340",
  // Home button large (iPhone 8 Plus, 7 Plus, 6s Plus, 6 Plus)
  "1242x2208",
  // Home button medium (iPhone SE 2/3, iPhone 8, 7, 6s, 6)
  "750x1334",
  // Home button 4" (iPhone SE 1st gen, 5s, 5c, 5)
  "640x1136",
  "640x1096",
  "600x1136",
  // Home button 3.5" (iPhone 4s, 4)
  "640x960",
  "640x920",
  "600x960",
  // iPad 13" / 12.9" (REQUIRED if app runs on iPad)
  "2064x2752", // iPad Pro 13" M4
  "2048x2732", // iPad Pro 12.9" 2nd-6th gen, iPad Air 13"
  // iPad 11"
  "1668x2420", // iPad Pro 11" M4
  "1668x2388", // iPad Pro 11" 1st-4th gen
  "1640x2360", // iPad Air 11", iPad 10th gen
  "1488x2266", // iPad mini 6th/7th gen
  // iPad 10.5"
  "1668x2224", // iPad Pro 10.5", iPad Air 3rd gen
  // iPad 9.7"
  "1536x2048",
  "1536x2008",
  "1496x2048",
  "768x1024",
  "768x1004",
  "748x1024",
  // Mac (16:10)
  "800x1280",
  "900x1440",
  "1600x2560",
  "1800x2880",
  // Apple Watch
  "422x514",
  "410x502",
  "416x496",
  "396x484",
  "368x448",
  "312x390",
  // Apple TV & Vision Pro
  "1080x1920",
  "2160x3840",
  // App Store Icon
  "1024x1024",
]);

/**
 * Full store sizes registry for Apple App Store and Google Play.
 * Metadata per entry: platform, category, width, height, required, maxRatio, format.
 */
export const STORE_SIZES = [
  // ==========================================
  // APPLE APP STORE
  // ==========================================

  // iPhone Dynamic Island medium (REQUIRED class in App Store Connect!)
  {
    id: "apple-dynamic-island-medium-1179x2556",
    name: "iPhone Dynamic Island medium (1179×2556)",
    platform: "apple",
    category: "screenshot",
    width: 1179,
    height: 2556,
    required: true,
    maxRatio: null,
    format: ["png", "jpeg"],
  },
  {
    id: "apple-dynamic-island-medium-1206x2622",
    name: "iPhone Dynamic Island medium (1206×2622)",
    platform: "apple",
    category: "screenshot",
    width: 1206,
    height: 2622,
    required: true,
    maxRatio: null,
    format: ["png", "jpeg"],
  },

  // iPhone Dynamic Island large
  {
    id: "apple-dynamic-island-large-1260x2736",
    name: "iPhone Dynamic Island large / Air (1260×2736)",
    platform: "apple",
    category: "screenshot",
    width: 1260,
    height: 2736,
    required: false,
    maxRatio: null,
    format: ["png", "jpeg"],
  },
  {
    id: "apple-dynamic-island-large-1290x2796",
    name: "iPhone Dynamic Island large (1290×2796)",
    platform: "apple",
    category: "screenshot",
    width: 1290,
    height: 2796,
    required: false,
    maxRatio: null,
    format: ["png", "jpeg"],
  },
  {
    id: "apple-dynamic-island-large-1320x2868",
    name: "iPhone Dynamic Island large (1320×2868)",
    platform: "apple",
    category: "screenshot",
    width: 1320,
    height: 2868,
    required: false,
    maxRatio: null,
    format: ["png", "jpeg"],
  },

  // iPhone Face ID large
  {
    id: "apple-face-id-large-1242x2688",
    name: "iPhone Face ID large (1242×2688)",
    platform: "apple",
    category: "screenshot",
    width: 1242,
    height: 2688,
    required: false,
    maxRatio: null,
    format: ["png", "jpeg"],
  },
  {
    id: "apple-face-id-large-1284x2778",
    name: "iPhone Face ID large (1284×2778)",
    platform: "apple",
    category: "screenshot",
    width: 1284,
    height: 2778,
    required: false,
    maxRatio: null,
    format: ["png", "jpeg"],
  },

  // iPhone Face ID medium
  {
    id: "apple-face-id-medium-1170x2532",
    name: "iPhone Face ID medium (1170×2532)",
    platform: "apple",
    category: "screenshot",
    width: 1170,
    height: 2532,
    required: false,
    maxRatio: null,
    format: ["png", "jpeg"],
  },
  {
    id: "apple-face-id-medium-1125x2436",
    name: "iPhone Face ID medium (1125×2436)",
    platform: "apple",
    category: "screenshot",
    width: 1125,
    height: 2436,
    required: false,
    maxRatio: null,
    format: ["png", "jpeg"],
  },
  {
    id: "apple-face-id-medium-1080x2340",
    name: "iPhone Face ID medium (1080×2340)",
    platform: "apple",
    category: "screenshot",
    width: 1080,
    height: 2340,
    required: false,
    maxRatio: null,
    format: ["png", "jpeg"],
  },

  // iPhone Duo
  {
    id: "apple-iphone-duo-outer-1398x2034",
    name: "iPhone Duo outer (1398×2034)",
    platform: "apple",
    category: "screenshot",
    width: 1398,
    height: 2034,
    required: false,
    maxRatio: null,
    format: ["png", "jpeg"],
  },
  {
    id: "apple-iphone-duo-inner-2007x2853",
    name: "iPhone Duo inner (2007×2853)",
    platform: "apple",
    category: "screenshot",
    width: 2007,
    height: 2853,
    required: false,
    maxRatio: null,
    format: ["png", "jpeg"],
  },

  // iPad 13" / 12.9" (REQUIRED if app runs on iPad!)
  {
    id: "apple-ipad-13-2048x2732",
    name: "iPad 13\" / 12.9\" (2048×2732)",
    platform: "apple",
    category: "screenshot",
    width: 2048,
    height: 2732,
    required: true,
    maxRatio: null,
    format: ["png", "jpeg"],
  },
  {
    id: "apple-ipad-13-2064x2752",
    name: "iPad 13\" Pro M4 (2064×2752)",
    platform: "apple",
    category: "screenshot",
    width: 2064,
    height: 2752,
    required: true,
    maxRatio: null,
    format: ["png", "jpeg"],
  },

  // iPad 11"
  {
    id: "apple-ipad-11-1668x2420",
    name: "iPad 11\" Pro M4 (1668×2420)",
    platform: "apple",
    category: "screenshot",
    width: 1668,
    height: 2420,
    required: false,
    maxRatio: null,
    format: ["png", "jpeg"],
  },
  {
    id: "apple-ipad-11-1668x2388",
    name: "iPad 11\" Pro (1668×2388)",
    platform: "apple",
    category: "screenshot",
    width: 1668,
    height: 2388,
    required: false,
    maxRatio: null,
    format: ["png", "jpeg"],
  },
  {
    id: "apple-ipad-air-11-1640x2360",
    name: "iPad Air 11\" (1640×2360)",
    platform: "apple",
    category: "screenshot",
    width: 1640,
    height: 2360,
    required: false,
    maxRatio: null,
    format: ["png", "jpeg"],
  },

  // Apple App Store Icon
  {
    id: "apple-app-store-icon-1024x1024",
    name: "Apple App Store Icon (1024×1024)",
    platform: "apple",
    category: "icon",
    width: 1024,
    height: 1024,
    required: true,
    maxRatio: 1.0,
    format: ["png"],
  },

  // ==========================================
  // GOOGLE PLAY
  // ==========================================

  // Standard Phone Screenshots (9:16 portrait, max 2:1 ratio <= 2.0)
  {
    id: "google-play-phone-1080x1920",
    name: "Google Play Phone FHD (1080×1920)",
    platform: "google_play",
    category: "screenshot",
    width: 1080,
    height: 1920,
    required: true,
    maxRatio: 2.0,
    format: ["png", "jpeg"],
  },
  {
    id: "google-play-phone-1440x2560",
    name: "Google Play Phone QHD (1440×2560)",
    platform: "google_play",
    category: "screenshot",
    width: 1440,
    height: 2560,
    required: false,
    maxRatio: 2.0,
    format: ["png", "jpeg"],
  },
  {
    id: "google-play-phone-1080x2160",
    name: "Google Play Phone 18:9 Max Ratio (1080×2160)",
    platform: "google_play",
    category: "screenshot",
    width: 1080,
    height: 2160,
    required: false,
    maxRatio: 2.0,
    format: ["png", "jpeg"],
  },
  {
    id: "google-play-phone-1440x2880",
    name: "Google Play Phone 18:9 QHD+ (1440×2880)",
    platform: "google_play",
    category: "screenshot",
    width: 1440,
    height: 2880,
    required: false,
    maxRatio: 2.0,
    format: ["png", "jpeg"],
  },
  {
    id: "google-play-phone-720x1280",
    name: "Google Play Phone 720p HD (720×1280)",
    platform: "google_play",
    category: "screenshot",
    width: 720,
    height: 1280,
    required: false,
    maxRatio: 2.0,
    format: ["png", "jpeg"],
  },

  // Tablets (16:10 / 16:9, max 2:1 ratio <= 2.0)
  {
    id: "google-play-tablet-7-1200x1920",
    name: "Google Play 7\" Tablet (1200×1920)",
    platform: "google_play",
    category: "screenshot",
    width: 1200,
    height: 1920,
    required: false,
    maxRatio: 2.0,
    format: ["png", "jpeg"],
  },
  {
    id: "google-play-tablet-10-1600x2560",
    name: "Google Play 10\" Tablet (1600×2560)",
    platform: "google_play",
    category: "screenshot",
    width: 1600,
    height: 2560,
    required: false,
    maxRatio: 2.0,
    format: ["png", "jpeg"],
  },

  // Large screens / Landscape (max 2:1 ratio <= 2.0)
  {
    id: "google-play-landscape-1920x1080",
    name: "Google Play Landscape 16:9 (1920×1080)",
    platform: "google_play",
    category: "screenshot",
    width: 1920,
    height: 1080,
    required: false,
    maxRatio: 2.0,
    format: ["png", "jpeg"],
  },
  {
    id: "google-play-landscape-2560x1440",
    name: "Google Play Landscape QHD (2560×1440)",
    platform: "google_play",
    category: "screenshot",
    width: 2560,
    height: 1440,
    required: false,
    maxRatio: 2.0,
    format: ["png", "jpeg"],
  },

  // Feature Graphic (Required by Google Play Console!)
  {
    id: "google-play-feature-graphic-1024x500",
    name: "Google Play Feature Graphic (1024×500)",
    platform: "google_play",
    category: "feature_graphic",
    width: 1024,
    height: 500,
    required: true,
    maxRatio: null,
    format: ["png", "jpeg"],
  },

  // App Icon (Required by Google Play Console!)
  {
    id: "google-play-app-icon-512x512",
    name: "Google Play App Icon (512×512)",
    platform: "google_play",
    category: "icon",
    width: 512,
    height: 512,
    required: true,
    maxRatio: 1.0,
    format: ["png"],
  },
];

export const STORE_SIZE_REGISTRY = STORE_SIZES;

/**
 * Filtered convenience lists.
 */
export const GOOGLE_PLAY_SIZES = STORE_SIZES.filter(
  s => (s.platform === "google_play" || s.platform === "google" || s.platform === "android") && s.category === "screenshot"
);

export const APPLE_SIZES = STORE_SIZES.filter(
  s => (s.platform === "apple" || s.platform === "ios") && s.category === "screenshot"
);

export const REQUIRED_IOS_SIZES = STORE_SIZES.filter(
  s => s.platform === "apple" && s.required && s.category === "screenshot"
);

/**
 * Validates dimensions against official store rules.
 *
 * For Google Play:
 *   - Dimension >= 320 px and <= 3840 px.
 *   - Long side <= 2 * short side (max ratio 2.0:1).
 *
 * For Apple App Store:
 *   - Dimensions must match supported Apple device resolutions (portrait or landscape).
 *
 * @param {string} platform "apple" | "ios" | "google" | "play" | "android" | "google_play"
 * @param {number} width
 * @param {number} height
 * @returns {boolean} true if size meets store specifications, false otherwise.
 */
export function validateStoreSize(platform, width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return false;
  }

  const p = String(platform || "").toLowerCase().trim();
  const isApple = p === "apple" || p === "ios" || p === "app_store" || p === "appstore" || p === "app store";
  const isGoogle = p === "google" || p === "play" || p === "google_play" || p === "googleplay" || p === "android" || p === "google play";

  if (!isApple && !isGoogle) {
    return false;
  }

  if (isGoogle) {
    // Official Google Play screenshot rule:
    // Minimum dimension: 320 px. Maximum dimension: 3840 px.
    // The long side can't be more than 2x the short side (ratio <= 2.0).
    const minDim = Math.min(w, h);
    const maxDim = Math.max(w, h);
    if (minDim < 320 || maxDim > 3840) {
      return false;
    }
    if (maxDim > 2 * minDim) {
      return false;
    }
    return true;
  }

  if (isApple) {
    // Official Apple App Store Connect rule:
    // Matches supported Apple device resolutions (portrait or landscape swap).
    const minDim = Math.min(w, h);
    const maxDim = Math.max(w, h);
    return SUPPORTED_APPLE_CANONICAL.has(`${minDim}x${maxDim}`);
  }

  return false;
}

/**
 * Asserts that a PNG buffer contains no alpha channel or transparency.
 * Official requirement:
 * - Apple App Store: "Images can't include alpha channels or transparencies"
 * - Google Play: Screenshots & feature graphics must be "JPEG or 24-bit PNG (no alpha)"
 *
 * PNG specification:
 * - Signature: 8 bytes (89 50 4E 47 0D 0A 1A 0A)
 * - IHDR chunk starts at byte 8 (length: 13 bytes, data: bytes 16..28)
 * - Color type byte is at offset 25:
 *     0: Greyscale
 *     2: Truecolor RGB (no alpha)
 *     3: Indexed-color
 *     4: Greyscale with alpha
 *     6: Truecolor with alpha (RGBA)
 * - tRNS chunk (if present) introduces alpha transparency to types 0, 2, or 3.
 *
 * @param {Buffer|Uint8Array} pngBuffer
 * @throws {Error} If buffer is invalid, contains alpha (color type 4 or 6), or contains a tRNS chunk.
 * @returns {boolean} true if PNG is valid and completely free of alpha/transparency.
 */
export function assertNoAlpha(pngBuffer) {
  if (!pngBuffer) {
    throw new TypeError("assertNoAlpha: expected PNG buffer, got null or undefined");
  }

  const buf = Buffer.isBuffer(pngBuffer)
    ? pngBuffer
    : pngBuffer instanceof Uint8Array
      ? Buffer.from(pngBuffer.buffer, pngBuffer.byteOffset, pngBuffer.byteLength)
      : Buffer.from(pngBuffer);

  // PNG header signature (8 bytes) + IHDR chunk (12 overhead + 13 data = 25 bytes) = min 33 bytes
  if (buf.length < 33) {
    throw new Error("Invalid PNG: buffer too short to contain valid PNG header and IHDR chunk");
  }

  const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== PNG_SIG[i]) {
      throw new Error("Invalid PNG: missing standard PNG 8-byte signature");
    }
  }

  // Chunk length at 8..11, Chunk type at 12..15 ("IHDR")
  const chunkType = buf.toString("ascii", 12, 16);
  if (chunkType !== "IHDR") {
    throw new Error(`Invalid PNG: first chunk must be IHDR, found '${chunkType}'`);
  }

  // Offset 25 is the Color Type in IHDR data (8 sig + 4 len + 4 type + 4 width + 4 height + 1 bitDepth = 25)
  const colorType = buf[25];

  if (colorType === 4) {
    throw new Error("PNG contains alpha channel (color type 4: greyscale+alpha)");
  }
  if (colorType === 6) {
    throw new Error("PNG contains alpha channel (color type 6: RGBA)");
  }
  if (colorType !== 0 && colorType !== 2 && colorType !== 3) {
    throw new Error(`Invalid PNG: unrecognized color type byte ${colorType}`);
  }

  // Scan remaining chunks for tRNS (transparency)
  let offset = 8;
  while (offset + 8 <= buf.length) {
    const chunkLen = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    if (type === "tRNS") {
      throw new Error("PNG contains transparency: tRNS chunk detected");
    }
    offset += 12 + chunkLen;
    if (type === "IEND") {
      break;
    }
  }

  return true;
}
