/**
 * @ploonu/render-loop - Shared render-review-fix engine
 *
 * Implements code-generated asset rendering with deterministic checks
 * (dimensions, no-alpha enforcement, WCAG AA contrast) and vision review loop.
 */

/**
 * Checks PNG dimensions against expected width and height.
 * Inspects binary PNG header (IHDR chunk) or mock object.
 *
 * @param {Uint8Array|Buffer|object} png
 * @param {number|object} expectedWidth - Either number or { width, height }
 * @param {number} [expectedHeight]
 * @returns {object|null} Issue object if mismatch, null if dimensions match
 */
export function checkDimensions(png, expectedWidth, expectedHeight) {
  let expW = expectedWidth;
  let expH = expectedHeight;
  if (typeof expectedWidth === "object" && expectedWidth !== null) {
    expW = expectedWidth.width;
    expH = expectedWidth.height;
  }

  const actual = extractPngInfo(png);
  if (!actual || typeof actual.width !== "number" || typeof actual.height !== "number") {
    return {
      type: "dimension_mismatch",
      message: `Invalid PNG: unable to read dimensions. Expected ${expW}x${expH}.`,
      expected: { width: expW, height: expH },
      actual: null,
      ok: false,
    };
  }

  if (actual.width !== expW || actual.height !== expH) {
    return {
      type: "dimension_mismatch",
      message: `Dimensions mismatch: expected ${expW}x${expH}, got ${actual.width}x${actual.height}`,
      expected: { width: expW, height: expH },
      actual: { width: actual.width, height: actual.height },
      ok: false,
    };
  }

  return null;
}

/**
 * Inspects PNG binary header/chunks/mock to ensure no alpha channel or transparency is present.
 * Apple App Store Connect and Google Play require 24-bit PNG without alpha.
 *
 * @param {Uint8Array|Buffer|object} png
 * @returns {object|null} Issue object if alpha is present, null if clean
 */
export function checkNoAlpha(png) {
  if (!png) return null;

  // Handle mock objects
  if (typeof png === "object" && !isBufferLike(png)) {
    if (png.hasAlpha === true || png.alpha === true || png.hasTransparency === true) {
      return {
        type: "alpha_channel_detected",
        message: "PNG contains alpha channel or transparency (Apple and Play require no alpha)",
        ok: false,
      };
    }
    if (png.colorType === 4 || png.colorType === 6) {
      return {
        type: "alpha_channel_detected",
        message: `PNG contains alpha channel (color type ${png.colorType})`,
        ok: false,
      };
    }
    if (png.channels === 4) {
      return {
        type: "alpha_channel_detected",
        message: "PNG has 4 channels (RGBA) including alpha",
        ok: false,
      };
    }
    if (png.buffer && isBufferLike(png.buffer)) {
      return checkNoAlpha(png.buffer);
    }
    if (png.data && png.width && png.height) {
      if (png.data.length === png.width * png.height * 4) {
        return {
          type: "alpha_channel_detected",
          message: "PNG pixel buffer includes 4 channels (RGBA)",
          ok: false,
        };
      }
    }
    return null;
  }

  // Inspect binary PNG
  const info = extractPngInfo(png);
  if (!info || !info.isPng) {
    return null;
  }

  if (info.hasAlpha) {
    return {
      type: "alpha_channel_detected",
      message: info.alphaReason || "PNG contains alpha channel or transparency (Apple and Play require no alpha)",
      colorType: info.colorType,
      ok: false,
    };
  }

  return null;
}

/**
 * WCAG AA contrast ratio check.
 * Minimum 4.5:1 for normal text, 3:1 for large text.
 *
 * @param {string} fgHex
 * @param {string} bgHex
 * @param {boolean|object} [options] - boolean for isLarge or { isLarge, minRatio }
 * @returns {object} { ok, ratio, passesNormal, passesLarge, minRequired, issue? }
 */
export function checkContrast(fgHex, bgHex, options = {}) {
  const isLarge = typeof options === "boolean" ? options : Boolean(options?.isLarge || options?.large);
  const minNormal = 4.5;
  const minLarge = 3.0;
  const minRequired = isLarge ? minLarge : (options?.minRatio || minNormal);

  const rgb1 = parseHexColor(fgHex);
  const rgb2 = parseHexColor(bgHex);

  if (!rgb1 || !rgb2) {
    return {
      ok: false,
      ratio: 0,
      passesNormal: false,
      passesLarge: false,
      minRequired,
      issue: {
        type: "contrast_invalid_color",
        message: `Invalid hex color: fg="${fgHex}", bg="${bgHex}"`,
        ok: false,
      },
    };
  }

  const l1 = relativeLuminance(rgb1);
  const l2 = relativeLuminance(rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  const rawRatio = (lighter + 0.05) / (darker + 0.05);
  const ratio = Math.round(rawRatio * 100) / 100;

  const passesNormal = rawRatio >= minNormal;
  const passesLarge = rawRatio >= minLarge;
  const ok = rawRatio >= minRequired;

  const result = {
    ok,
    ratio,
    passesNormal,
    passesLarge,
    minRequired,
  };

  if (!ok) {
    result.issue = {
      type: "contrast_too_low",
      message: `Contrast ratio ${ratio}:1 is below required minimum ${minRequired}:1 (WCAG AA)`,
      ratio,
      minRequired,
      fgHex,
      bgHex,
      ok: false,
    };
  }

  return result;
}

/**
 * Main render-review-fix loop.
 */
export async function runLoop({
  target = "html", // "html" | "pptx"
  brief, // { copy, brand, assets, sizes }
  generate, // async (brief) -> code
  render, // async (code, size) -> png[] (Buffer/Uint8Array or mock)
  checks, // async (png, code, size) -> issues[]
  review, // async (png, issues) -> visionIssues[]
  fix, // async (code, issues) -> newCode
  maxPasses = 3,
  budget,
}) {
  if (typeof render !== "function") {
    throw new TypeError("render function is required in runLoop");
  }

  // Adjust maxPasses if budget specifies a limit
  let effectiveMaxPasses = maxPasses;
  if (budget) {
    if (typeof budget === "number") {
      effectiveMaxPasses = Math.min(effectiveMaxPasses, budget);
    } else if (typeof budget.maxPasses === "number") {
      effectiveMaxPasses = Math.min(effectiveMaxPasses, budget.maxPasses);
    } else if (typeof budget.passes === "number") {
      effectiveMaxPasses = Math.min(effectiveMaxPasses, budget.passes);
    }
  }

  // Pass 1: generate code from brief
  let code = typeof generate === "function" ? await generate(brief) : (brief?.code || "");
  const passes = [];
  let finalPngs = [];
  let lastIssues = [];

  const rawSizes = Array.isArray(brief?.sizes) && brief.sizes.length > 0
    ? brief.sizes
    : (brief?.size ? [brief.size] : [undefined]);

  for (let pass = 1; pass <= effectiveMaxPasses; pass++) {
    const passIssues = [];
    const currentPngs = [];

    for (const rawSize of rawSizes) {
      const size = normalizeSize(rawSize);
      const rendered = await render(code, size);
      const pngList = Array.isArray(rendered) ? rendered : (rendered ? [rendered] : []);

      if (pngList.length === 0) {
        passIssues.push({
          type: "render_empty",
          message: "Render returned no PNG output",
          size,
        });
      }

      for (const png of pngList) {
        currentPngs.push(png);
        const pngIssues = [];

        // 1. Built-in deterministic checks
        if (size?.width && size?.height) {
          const dimIssue = checkDimensions(png, size.width, size.height);
          if (dimIssue) pngIssues.push(dimIssue);
        }

        const alphaIssue = checkNoAlpha(png);
        if (alphaIssue) pngIssues.push(alphaIssue);

        // 2. User-provided checks
        if (typeof checks === "function") {
          const userIssues = await checks(png, code, size);
          if (Array.isArray(userIssues)) {
            pngIssues.push(...userIssues);
          } else if (userIssues) {
            pngIssues.push(userIssues);
          }
        }

        // 3. Vision review: called if deterministic checks fail or if vision review is provided
        if (typeof review === "function") {
          const visionIssues = await review(png, [...pngIssues]);
          if (visionIssues) {
            const vList = Array.isArray(visionIssues) ? visionIssues : [visionIssues];
            for (const vi of vList) {
              if (!pngIssues.includes(vi)) {
                pngIssues.push(vi);
              }
            }
          }
        }

        passIssues.push(...pngIssues);
      }
    }

    finalPngs = currentPngs;
    lastIssues = passIssues;
    const remainingIssues = passIssues.length > 0;

    // Record telemetry: { pass, issues, fixed: !remainingIssues }
    passes.push({
      pass,
      issues: passIssues,
      fixed: !remainingIssues,
    });

    // If no issues remain, break and return success status
    if (!remainingIssues) {
      break;
    }

    // If issues remain and pass < maxPasses, call fix(code, issues) to get updated code
    if (pass < effectiveMaxPasses && typeof fix === "function") {
      code = await fix(code, passIssues);
    }
  }

  return {
    code,
    pngs: finalPngs,
    passes,
    status: lastIssues.length === 0 ? "ok" : "max_passes_reached",
  };
}

// ----------------- Helpers -----------------

function isBufferLike(x) {
  return Buffer.isBuffer(x) || x instanceof Uint8Array;
}

function normalizeSize(s) {
  if (!s) return undefined;
  if (typeof s === "string") {
    const m = s.match(/^(\d+)\s*[xX×]\s*(\d+)$/);
    if (m) {
      return { width: parseInt(m[1], 10), height: parseInt(m[2], 10), name: s };
    }
    return { name: s };
  }
  return s;
}

function parseHexColor(hex) {
  if (typeof hex !== "string") return null;
  let str = hex.trim().replace(/^#/, "");
  if (str.length === 3) {
    str = str.split("").map((c) => c + c).join("");
  }
  if (str.length !== 6) return null;
  const num = parseInt(str, 16);
  if (Number.isNaN(num)) return null;
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function relativeLuminance({ r, g, b }) {
  const [lr, lg, lb] = [r, g, b].map((val) => {
    const s = val / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function extractPngInfo(png) {
  if (!png) return null;

  // Handle mock objects
  if (typeof png === "object" && !isBufferLike(png)) {
    if (typeof png.width === "number" && typeof png.height === "number") {
      const hasAlpha = Boolean(png.hasAlpha || png.alpha || png.channels === 4 || png.colorType === 4 || png.colorType === 6);
      return {
        width: png.width,
        height: png.height,
        colorType: png.colorType ?? (hasAlpha ? 6 : 2),
        hasAlpha,
        isPng: true,
      };
    }
    if (png.buffer && isBufferLike(png.buffer)) {
      return extractPngInfo(png.buffer);
    }
    return null;
  }

  const buf = Buffer.isBuffer(png) ? png : Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  if (buf.length < 24) return null;

  // PNG Signature: 89 50 4E 47 0D 0A 1A 0A
  const isPng =
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a;

  if (!isPng) return null;

  const chunkType = buf.toString("ascii", 12, 16);
  if (chunkType !== "IHDR") return null;

  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colorType = buf[25];

  let hasAlpha = colorType === 4 || colorType === 6;
  let alphaReason = hasAlpha ? `PNG contains alpha channel (color type ${colorType})` : null;

  // Scan for tRNS chunk if colorType is 0, 2, or 3
  if (!hasAlpha) {
    let offset = 8; // skip signature
    while (offset + 8 <= buf.length) {
      const len = buf.readUInt32BE(offset);
      const type = buf.toString("ascii", offset + 4, offset + 8);
      if (type === "tRNS") {
        hasAlpha = true;
        alphaReason = "PNG contains tRNS transparency chunk";
        break;
      }
      if (type === "IEND") break;
      offset += 12 + len;
    }
  }

  return {
    width,
    height,
    bitDepth,
    colorType,
    hasAlpha,
    alphaReason,
    isPng: true,
  };
}

export default {
  runLoop,
  checkDimensions,
  checkNoAlpha,
  checkContrast,
};
