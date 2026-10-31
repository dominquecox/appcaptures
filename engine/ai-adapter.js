// Provider-Agnostic AI Adapter for AppCaptures (AC-009).
// Routes to Cloudflare Workers AI with AI Gateway support, Gemini fallback,
// and deterministic mock fallback for offline/test environments.

import {
  normalizeStore,
  validateListingLimits,
  sanitizeListing,
  containsEmoji,
  stripEmojis,
  containsBannedPlayKeywords,
  stripBannedPlayKeywords,
  APPLE_LIMITS,
  PLAY_LIMITS,
  STORE_LIMITS,
  getUtf8ByteLength,
  truncateUtf8Bytes,
  sanitizeAppleKeywords,
  getListingValidationErrors,
} from "./store-limits.js";

export {
  normalizeStore,
  validateListingLimits,
  sanitizeListing,
  containsEmoji,
  stripEmojis,
  containsBannedPlayKeywords,
  stripBannedPlayKeywords,
  APPLE_LIMITS,
  PLAY_LIMITS,
  STORE_LIMITS,
  getUtf8ByteLength,
  truncateUtf8Bytes,
  sanitizeAppleKeywords,
  getListingValidationErrors,
};

/**
 * Checks if messages contain image data.
 */
function hasImages(messages) {
  if (!Array.isArray(messages)) return false;
  for (const m of messages) {
    if (m.image || (Array.isArray(m.images) && m.images.length > 0)) return true;
    if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part && (part.type === "image" || part.type === "image_url" || part.image)) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Strips code fences and attempts to parse JSON.
 */
function parseJsonOutput(text) {
  if (typeof text !== "string") return text;
  let clean = text.trim();
  // Strip markdown code fences if model wrapped in ```json ... ```
  if (clean.startsWith("```")) {
    clean = clean.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }
  try {
    return JSON.parse(clean);
  } catch {
    // If text contains a JSON object substring, try to isolate it
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(clean.slice(start, end + 1));
      } catch {
        return clean;
      }
    }
    return clean;
  }
}

/**
 * Deterministic mock fallback for offline tests and local development.
 */
function runMockAI({ task, messages, schema }) {
  let store = "ios";
  let appName = "App";
  let context = "";

  for (const m of messages || []) {
    const c = typeof m.content === "string" ? m.content : JSON.stringify(m.content || "");
    if (/google|play|android/i.test(c)) store = "play";
    if (/apple|ios/i.test(c)) store = "ios";
    const nameMatch = c.match(/App\s*Name:\s*([^\n,]+)/i);
    if (nameMatch) appName = nameMatch[1].trim();
    const ctxMatch = c.match(/Context\s*(?:&\s*Features)?:\s*([^\n]+)/i);
    if (ctxMatch) context = ctxMatch[1].trim();
  }

  let mockData;
  if (store === "play") {
    mockData = {
      title: `${appName} - Screenshots & Companion`.slice(0, PLAY_LIMITS.title),
      short: "The ultimate solution for your daily workflow with seamless performance.".slice(0, PLAY_LIMITS.short),
      full: `${appName} is designed to make your daily workflow effortless. Featuring high performance, intuitive navigation, and beautiful responsive design crafted for Android devices.\n\nKey features:\n• Fast and responsive\n• Zero complex setup\n• Secure and private`,
      keywords: "productivity,utilities,tools,companion",
    };
  } else {
    mockData = {
      title: `${appName}: Fast & Easy`.slice(0, APPLE_LIMITS.title),
      subtitle: "Simple & Powerful Companion".slice(0, APPLE_LIMITS.subtitle),
      promo: "Experience the next level of mobile productivity with seamless performance and design.".slice(0, APPLE_LIMITS.promo),
      description: `${appName} is designed to make your daily workflow effortless. Featuring powerful tools, intuitive navigation, and beautiful responsive design crafted for iOS.\n\nHighlights:\n- Clean modern interface\n- Blazing-fast performance\n- Cloud sync enabled`,
      keywords: "productivity,utility,tools,assistant,fast,easy",
    };
  }

  const text = JSON.stringify(mockData, null, 2);
  return {
    text,
    data: mockData,
    ...mockData,
  };
}

/**
 * Invokes Gemini REST API as a fallback provider.
 */
async function runGemini({ messages, schema, env }) {
  const apiKey = env.GEMINI_API_KEY;
  const model = "gemini-2.0-flash";

  let url;
  if (env.AI_GATEWAY_ID && env.CLOUDFLARE_ACCOUNT_ID) {
    url = `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/google-ai-studio/v1beta/models/${model}:generateContent?key=${apiKey}`;
  } else {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  }

  const contents = (messages || []).map((m) => {
    const role = m.role === "assistant" ? "model" : "user";
    const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    return { role, parts: [{ text }] };
  });

  const payload = {
    contents,
    generationConfig: schema ? { responseMimeType: "application/json" } : {},
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Gemini API error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const data = schema ? parseJsonOutput(text) : text;

  return {
    text,
    data,
    ...(typeof data === "object" && data !== null ? data : {}),
  };
}

/**
 * Provider-agnostic AI completion engine.
 *
 * @param {Object} options
 * @param {string} [options.task] Task identifier (e.g. "generate-listing")
 * @param {Array} options.messages Chat messages array
 * @param {Object} [options.schema] Optional JSON schema or structured format description
 * @param {Object} [options.env] Cloudflare Worker environment bindings
 */
export async function completeAI({ task, messages = [], schema = null, env = {} }) {
  // 1. Cloudflare Workers AI (Default)
  if (env.AI && typeof env.AI.run === "function") {
    const model = hasImages(messages)
      ? "@cf/meta/llama-3.2-11b-vision-instruct"
      : "@cf/meta/llama-3.3-70b-instruct";

    const aiOptions = env.AI_GATEWAY_ID ? { gateway: { id: env.AI_GATEWAY_ID } } : undefined;
    const runResult = await env.AI.run(model, { messages }, aiOptions);

    let text = "";
    if (typeof runResult === "string") {
      text = runResult;
    } else if (runResult && typeof runResult.response === "string") {
      text = runResult.response;
    } else {
      text = JSON.stringify(runResult);
    }

    const data = schema ? parseJsonOutput(text) : text;
    return {
      text,
      data,
      ...(typeof data === "object" && data !== null ? data : {}),
    };
  }

  // 2. Gemini fallback
  if (env.GEMINI_API_KEY) {
    return runGemini({ messages, schema, env });
  }

  // 3. Mock fallback for deterministic tests / local environments
  return runMockAI({ task, messages, schema });
}

/**
 * Generates and sanitizes store listing copy based on app metadata and screenshots.
 */
export async function generateListingCopy({
  store,
  appName = "App",
  context = "",
  locale = "en-US",
  screenshots = [],
  env = {},
}) {
  const norm = normalizeStore(store);
  if (!norm) throw new Error(`Unsupported store: ${store}`);

  const isApple = norm === "ios";
  const systemPrompt = isApple
    ? `You are an expert App Store Optimization (ASO) copywriter. Create metadata for Apple App Store Connect in locale "${locale}".
Strict Limits:
- title: strictly <= 30 characters
- subtitle: strictly <= 30 characters
- promo: strictly <= 170 characters
- description: strictly <= 4000 characters
- keywords: comma-separated list strictly <= 100 UTF-8 bytes
Respond ONLY with a JSON object: {"title":"...","subtitle":"...","promo":"...","description":"...","keywords":"..."}`
    : `You are an expert Google Play Console ASO copywriter. Create metadata for Google Play Console in locale "${locale}".
Strict Limits:
- title: strictly <= 50 characters
- short: strictly <= 80 characters. Absolutely NO emojis. NO banned spam keywords ("#1", "best", "free", "top rated", "download now").
- full: strictly <= 4000 characters
Respond ONLY with a JSON object: {"title":"...","short":"...","full":"..."}`;

  const userPrompt = `App Name: ${appName}
Context & Features: ${context || "A modern mobile app built for high performance and delightful user experience."}
Store: ${isApple ? "Apple App Store" : "Google Play"}
Locale: ${locale}
${screenshots.length > 0 ? `Screenshots attached: ${screenshots.length} images.` : ""}`;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const aiResult = await completeAI({
    task: "generate-listing",
    messages,
    schema: isApple
      ? { type: "object", properties: { title: {}, subtitle: {}, promo: {}, description: {}, keywords: {} } }
      : { type: "object", properties: { title: {}, short: {}, full: {} } },
    env,
  });

  const rawFields = aiResult.data || aiResult;
  return sanitizeListing(norm, rawFields);
}
