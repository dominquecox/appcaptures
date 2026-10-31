// Store limits and listing compliance engine for AppCaptures (AC-009).
// Enforces official Apple App Store Connect and Google Play Console listing guidelines.

/**
 * Normalized store identifiers.
 */
export function normalizeStore(store) {
  const s = String(store || "").toLowerCase().trim();
  if (s === "ios" || s === "apple" || s === "appstore" || s === "app_store" || s === "app store") {
    return "ios";
  }
  if (s === "play" || s === "google" || s === "googleplay" || s === "google_play" || s === "android" || s === "google play") {
    return "play";
  }
  return null;
}

/**
 * Official Apple App Store Connect metadata limits:
 * - title: 30 characters
 * - subtitle: 30 characters
 * - promo (promotional text): 170 characters
 * - description: 4000 characters
 * - keywords: 100 UTF-8 bytes (comma-separated list)
 */
export const APPLE_LIMITS = Object.freeze({
  title: 30,
  subtitle: 30,
  promo: 170,
  description: 4000,
  keywordsBytes: 100,
});

/**
 * Official Google Play Console metadata limits & policy:
 * - title: 50 characters
 * - short description: 80 characters (NO emojis, NO banned promotional buzzwords)
 * - full description: 4000 characters
 */
export const PLAY_LIMITS = Object.freeze({
  title: 50,
  short: 80,
  full: 4000,
  bannedKeywords: Object.freeze(["#1", "best", "free", "top rated", "download now"]),
});

export const STORE_LIMITS = Object.freeze({
  ios: APPLE_LIMITS,
  apple: APPLE_LIMITS,
  play: PLAY_LIMITS,
  google: PLAY_LIMITS,
});

// Regex to detect Extended Pictographic emojis, emoji presentation, and joiners
const EMOJI_REGEX = /[\p{Extended_Pictographic}\uFE0F\u200D\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
const EMOJI_GLOBAL_REGEX = /[\p{Extended_Pictographic}\uFE0F\u200D\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;

// Regex patterns for Google Play spam keywords
const BANNED_PATTERNS = [
  /(?:^|[^\w])#1(?=[^\w]|$)/i,
  /\b(best|free|top rated|download now)\b/i,
];

/**
 * Checks whether a string contains emojis.
 */
export function containsEmoji(str) {
  if (!str) return false;
  return EMOJI_REGEX.test(str);
}

/**
 * Strips all emojis from a string.
 */
export function stripEmojis(str) {
  if (!str) return "";
  return String(str).replace(EMOJI_GLOBAL_REGEX, "");
}

/**
 * Checks whether a string contains banned Google Play spam keywords.
 */
export function containsBannedPlayKeywords(str) {
  if (!str) return false;
  return BANNED_PATTERNS.some((pattern) => pattern.test(str));
}

/**
 * Strips banned Google Play spam keywords.
 */
export function stripBannedPlayKeywords(str) {
  if (!str) return "";
  let clean = String(str);
  clean = clean.replace(/(?:^|[^\w])#1(?=[^\w]|$)/gi, " ");
  clean = clean.replace(/\b(best|free|top rated|download now)\b/gi, " ");
  return clean;
}

/**
 * Calculates exact UTF-8 byte length of a string.
 */
export function getUtf8ByteLength(str) {
  if (!str) return 0;
  return new TextEncoder().encode(String(str)).length;
}

/**
 * Safely truncates a string to fit within maxBytes UTF-8 bytes without breaking multi-byte code units.
 */
export function truncateUtf8Bytes(str, maxBytes) {
  if (!str) return "";
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8");
  const bytes = encoder.encode(String(str));
  if (bytes.length <= maxBytes) return String(str);
  let slice = bytes.subarray(0, maxBytes);
  let res = decoder.decode(slice);
  while (encoder.encode(res).length > maxBytes) {
    res = res.slice(0, -1);
  }
  return res;
}

/**
 * Sanitizes Apple App Store keywords:
 * - Comma-separated list
 * - Guaranteed <= 100 UTF-8 bytes
 */
export function sanitizeAppleKeywords(keywords) {
  if (!keywords) return "";
  let raw = "";
  if (Array.isArray(keywords)) {
    raw = keywords.map((k) => String(k).trim()).filter(Boolean).join(",");
  } else {
    raw = String(keywords).trim();
  }
  const encoder = new TextEncoder();
  if (encoder.encode(raw).length <= APPLE_LIMITS.keywordsBytes) {
    return raw;
  }

  const items = raw.split(",").map((k) => k.trim()).filter(Boolean);
  const kept = [];
  let currentBytes = 0;
  for (const item of items) {
    const itemBytes = encoder.encode(item).length;
    const sepBytes = kept.length > 0 ? 1 : 0;
    if (currentBytes + sepBytes + itemBytes <= APPLE_LIMITS.keywordsBytes) {
      kept.push(item);
      currentBytes += sepBytes + itemBytes;
    }
  }

  let result = kept.join(",");
  if (!result && items.length > 0) {
    result = truncateUtf8Bytes(items[0], APPLE_LIMITS.keywordsBytes);
  }

  // Ensure absolute compliance
  while (result.length > 0 && encoder.encode(result).length > APPLE_LIMITS.keywordsBytes) {
    result = result.slice(0, -1);
  }
  return result;
}

/**
 * Inspects listing fields and returns array of human-readable error messages.
 */
export function getListingValidationErrors(store, fields) {
  const norm = normalizeStore(store);
  if (!norm) return [`Unsupported store: ${store}`];
  if (!fields || typeof fields !== "object") return ["Fields must be an object"];

  const errors = [];
  if (norm === "ios") {
    if (typeof fields.title === "string" && fields.title.length > APPLE_LIMITS.title) {
      errors.push(`title exceeds ${APPLE_LIMITS.title} characters (${fields.title.length})`);
    }
    if (typeof fields.subtitle === "string" && fields.subtitle.length > APPLE_LIMITS.subtitle) {
      errors.push(`subtitle exceeds ${APPLE_LIMITS.subtitle} characters (${fields.subtitle.length})`);
    }
    const promo = fields.promo ?? fields.promotionalText;
    if (typeof promo === "string" && promo.length > APPLE_LIMITS.promo) {
      errors.push(`promo exceeds ${APPLE_LIMITS.promo} characters (${promo.length})`);
    }
    const desc = fields.description ?? fields.full;
    if (typeof desc === "string" && desc.length > APPLE_LIMITS.description) {
      errors.push(`description exceeds ${APPLE_LIMITS.description} characters (${desc.length})`);
    }
    if (fields.keywords !== undefined && fields.keywords !== null) {
      const kwStr = Array.isArray(fields.keywords) ? fields.keywords.join(",") : String(fields.keywords);
      const bytes = getUtf8ByteLength(kwStr);
      if (bytes > APPLE_LIMITS.keywordsBytes) {
        errors.push(`keywords exceed ${APPLE_LIMITS.keywordsBytes} UTF-8 bytes (${bytes})`);
      }
    }
  } else if (norm === "play") {
    if (typeof fields.title === "string" && fields.title.length > PLAY_LIMITS.title) {
      errors.push(`title exceeds ${PLAY_LIMITS.title} characters (${fields.title.length})`);
    }
    const short = fields.short ?? fields.shortDescription;
    if (typeof short === "string") {
      if (short.length > PLAY_LIMITS.short) {
        errors.push(`short exceeds ${PLAY_LIMITS.short} characters (${short.length})`);
      }
      if (containsEmoji(short)) {
        errors.push("short contains emojis (disallowed by Google Play)");
      }
      if (containsBannedPlayKeywords(short)) {
        errors.push("short contains banned spam keywords");
      }
    }
    const full = fields.full ?? fields.description ?? fields.fullDescription;
    if (typeof full === "string" && full.length > PLAY_LIMITS.full) {
      errors.push(`full exceeds ${PLAY_LIMITS.full} characters (${full.length})`);
    }
  }

  return errors;
}

/**
 * Validates listing fields against official store limits.
 * Returns true if valid, false if invalid.
 * If options.detailed is true, returns { valid: boolean, errors: string[] }.
 */
export function validateListingLimits(store, fields, { detailed = false } = {}) {
  const errors = getListingValidationErrors(store, fields);
  const valid = errors.length === 0;
  if (detailed) {
    return { valid, errors };
  }
  return valid;
}

/**
 * Sanitizes and clamps listing fields to guarantee 100% compliance with official store guidelines.
 */
export function sanitizeListing(store, fields = {}) {
  const norm = normalizeStore(store);
  if (!norm) throw new Error(`Unsupported store: ${store}`);

  if (norm === "ios") {
    const title = String(fields.title || "").slice(0, APPLE_LIMITS.title);
    const subtitle = String(fields.subtitle || "").slice(0, APPLE_LIMITS.subtitle);
    const promoRaw = fields.promo ?? fields.promotionalText;
    const promo = promoRaw !== undefined && promoRaw !== null ? String(promoRaw).slice(0, APPLE_LIMITS.promo) : "";
    const descRaw = fields.description ?? fields.full ?? "";
    const description = String(descRaw).slice(0, APPLE_LIMITS.description);
    const keywords = sanitizeAppleKeywords(fields.keywords ?? "");

    return {
      title,
      subtitle,
      promo,
      description,
      keywords,
    };
  }

  if (norm === "play") {
    let title = String(fields.title || "");
    title = stripEmojis(title).slice(0, PLAY_LIMITS.title);

    let shortRaw = fields.short ?? fields.shortDescription ?? "";
    let short = stripEmojis(String(shortRaw));
    short = stripBannedPlayKeywords(short);
    short = short
      .replace(/\s+([.,!?;:])/g, "$1")
      .replace(/[.,!?;:]{2,}/g, (m) => m[0])
      .replace(/\s+/g, " ")
      .trim();
    short = short.slice(0, PLAY_LIMITS.short);

    let fullRaw = fields.full ?? fields.description ?? fields.fullDescription ?? "";
    let full = String(fullRaw).slice(0, PLAY_LIMITS.full);

    const keywords = fields.keywords
      ? (Array.isArray(fields.keywords) ? fields.keywords.join(",") : String(fields.keywords)).slice(0, 500)
      : undefined;

    return {
      title,
      short,
      full,
      ...(keywords ? { keywords } : {}),
      description: full,
      shortDescription: short,
    };
  }
}
