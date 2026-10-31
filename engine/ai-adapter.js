// Provider-Agnostic AI Adapter for AppCaptures (AC-009, AC-010).
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
  if (clean.startsWith("```")) {
    clean = clean.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }
  try {
    return JSON.parse(clean);
  } catch {
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
 * Sanitize domain name from project name for links.
 */
function sanitizeDomain(name) {
  return String(name || "app")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 30) || "app";
}

/**
 * Sanitizes and enforces Twitter launch tweet constraints:
 * - Punchy launch tweet <= 280 characters.
 * - Includes 1-2 relevant hashtags.
 */
export function sanitizeTwitterPost(raw, { projectName = "App", tone = "launch" } = {}) {
  let text = typeof raw === "string" ? raw.trim() : "";
  if (!text) {
    const domain = sanitizeDomain(projectName);
    if (tone === "hype") {
      text = `🔥 Big news! ${projectName} is officially live. Built to revolutionize how you work. Try it today: https://${domain}.com #launch #startup`;
    } else if (tone === "story") {
      text = `We spent months solving the biggest friction points in our workflow, and today we're launching ${projectName} for everyone. #buildinpublic #launch`;
    } else if (tone === "minimal") {
      text = `${projectName} is here. Fast, reliable, and simple. https://${domain}.com #launch #tools`;
    } else {
      text = `🚀 Excited to announce the launch of ${projectName}! Built to help you create, design, and ship faster than ever. #launch #startup`;
    }
  }

  // Ensure 1-2 relevant hashtags
  const tagMatches = text.match(/#\w+/g);
  if (!tagMatches || tagMatches.length === 0) {
    text = `${text} #launch #startup`;
  } else if (tagMatches.length > 2) {
    let count = 0;
    text = text.replace(/#\w+/g, (match) => {
      count++;
      return count <= 2 ? match : "";
    }).replace(/\s+/g, " ").trim();
  }

  // Ensure length <= 280 characters
  if (text.length > 280) {
    const tags = (text.match(/#\w+/g) || ["#launch"]).slice(0, 2).join(" ");
    const maxBodyLen = 280 - tags.length - 1;
    let body = text.replace(/#\w+/g, "").trim().slice(0, maxBodyLen).trim();
    body = body.replace(/[,;:\-\s]+$/, "");
    text = `${body} ${tags}`;
    if (text.length > 280) {
      text = text.slice(0, 280);
    }
  }

  return text;
}

/**
 * Sanitizes and enforces LinkedIn post constraints:
 * - Professional announcement post highlighting value prop and problem solved.
 * - Narrative structure (hook, problem, solution/value, highlights, call to action).
 */
export function sanitizeLinkedInPost(raw, { projectName = "App", tone = "launch", context = "", brandInfo = {} } = {}) {
  let text = typeof raw === "string" ? raw.trim() : "";

  const hasProblem = /problem|challenge|struggle|pain point|frustrat|why we built/i.test(text);
  const hasValueOrSolution = /solution|value|help|feature|built|introducing|launching|announc/i.test(text);

  if (!text || text.length < 60 || !hasProblem || !hasValueOrSolution) {
    const valueProp = context || brandInfo.tagline || brandInfo.description || `${projectName} empowers teams to capture, create, and launch beautiful assets effortlessly.`;
    text = `🚀 Excited to announce the official launch of ${projectName}!\n\n` +
      `The Problem:\n` +
      `For too long, creating polished marketing and app assets meant juggling multiple disconnected tools, dealing with rigid templates, and spending hours on repetitive formatting.\n\n` +
      `The Solution:\n` +
      `We built ${projectName} to change that. ${valueProp}\n\n` +
      `Key Value & Highlights:\n` +
      `• Streamlined workflow from concept to publication\n` +
      `• High-performance exports tailored for every major platform\n` +
      `• Intuitive, modern design built for creators and growing teams\n\n` +
      `We'd love for you to try it out and share your thoughts. What features would you like to see next? Drop a comment below!`;
  }

  return text;
}

/**
 * Sanitizes and enforces Product Hunt launch constraints:
 * - Object: { tagline: "<= 60 chars", makerComment: "..." }
 */
export function sanitizeProductHunt(raw, { projectName = "App", tone = "launch", context = "" } = {}) {
  let tagline = "";
  let makerComment = "";

  if (typeof raw === "object" && raw !== null) {
    tagline = String(raw.tagline || "").trim();
    makerComment = String(raw.makerComment || raw.comment || "").trim();
  } else if (typeof raw === "string") {
    tagline = raw.trim();
  }

  if (!tagline) {
    if (tone === "minimal") {
      tagline = `${projectName} – Clean and effortless workflow`.slice(0, 60);
    } else if (tone === "hype") {
      tagline = `${projectName} – The next-gen platform for builders`.slice(0, 60);
    } else {
      tagline = `${projectName} – Modern screenshot & app studio`.slice(0, 60);
    }
  }

  // Strict <= 60 characters
  if (tagline.length > 60) {
    tagline = tagline.slice(0, 60).trim().replace(/[,;:\-\s]+$/, "");
  }

  if (!makerComment) {
    makerComment = `Hey Product Hunt! 👋\n\nI'm so excited to share ${projectName} with you all today.\n\n${context || "We built this to eliminate the friction and repetitive work in our daily workflow. Our goal is to give makers and teams a powerful, beautiful platform that just works."}\n\nKey Highlights:\n• Lightning fast and intuitive\n• Zero complex setup\n• Designed with privacy and quality first\n\nI'd love to hear your thoughts, feedback, and questions in the comments below! Thank you for the support! 🚀`;
  }

  return {
    tagline,
    makerComment,
  };
}

/**
 * Sanitizes and enforces Threads post constraints:
 * - Casual conversational post.
 */
export function sanitizeThreadsPost(raw, { projectName = "App", tone = "launch" } = {}) {
  let text = typeof raw === "string" ? raw.trim() : "";
  if (!text) {
    if (tone === "minimal") {
      text = `${projectName} is live. check it out and let us know what you think 👀`;
    } else if (tone === "hype") {
      text = `finally dropped ${projectName} today!! 🔥\n\nbeen working on this non-stop and cannot wait for you all to try it. link in bio!`;
    } else {
      text = `we just launched ${projectName} today! 🚀\n\nbuilt something we genuinely wanted to use every day. would love your feedback — link in bio 👀`;
    }
  }
  return text;
}

/**
 * Sanitizes posts object for all requested platforms.
 */
export function sanitizeSocialPosts(rawPosts, {
  projectName = "App",
  brandInfo = {},
  platforms = ["twitter", "linkedin", "producthunt"],
  tone = "launch",
  context = "",
} = {}) {
  const result = {};
  const raw = typeof rawPosts === "object" && rawPosts !== null ? rawPosts : {};

  for (const p of platforms) {
    if (p === "twitter") {
      result.twitter = sanitizeTwitterPost(raw.twitter, { projectName, tone });
    } else if (p === "linkedin") {
      result.linkedin = sanitizeLinkedInPost(raw.linkedin, { projectName, tone, context, brandInfo });
    } else if (p === "producthunt") {
      result.producthunt = sanitizeProductHunt(raw.producthunt, { projectName, tone, context });
    } else if (p === "threads") {
      result.threads = sanitizeThreadsPost(raw.threads, { projectName, tone });
    }
  }

  return result;
}

/**
 * Deterministic mock fallback for offline tests and local development.
 */
function runMockAI({ task, messages, schema }) {
  let isSocial = task === "generate-posts";
  let appName = "App";
  let context = "";
  let tone = "launch";
  let platforms = ["twitter", "linkedin", "producthunt"];

  for (const m of messages || []) {
    const c = typeof m.content === "string" ? m.content : JSON.stringify(m.content || "");
    if (/twitter|linkedin|producthunt|threads|launch post/i.test(c)) isSocial = true;
    const nameMatch = c.match(/Project\s*Name:\s*([^\n,]+)/i) || c.match(/App\s*Name:\s*([^\n,]+)/i);
    if (nameMatch) appName = nameMatch[1].trim();
    const ctxMatch = c.match(/Context:\s*([^\n]+)/i);
    if (ctxMatch) context = ctxMatch[1].trim();
    const toneMatch = c.match(/Tone:\s*([^\n]+)/i);
    if (toneMatch) tone = toneMatch[1].trim();
    const platMatch = c.match(/Target Platforms:\s*([^\n]+)/i);
    if (platMatch) {
      platforms = platMatch[1].split(",").map((s) => s.trim().toLowerCase());
    }
  }

  if (isSocial) {
    const posts = sanitizeSocialPosts({}, {
      projectName: appName,
      platforms,
      tone,
      context,
    });
    return {
      text: JSON.stringify(posts, null, 2),
      data: posts,
      ...posts,
    };
  }

  // Store listing mock fallback (AC-009)
  let store = "ios";
  for (const m of messages || []) {
    const c = typeof m.content === "string" ? m.content : JSON.stringify(m.content || "");
    if (/google|play|android/i.test(c)) store = "play";
    if (/apple|ios/i.test(c)) store = "ios";
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
 * @param {string} [options.task] Task identifier (e.g. "generate-posts", "generate-listing")
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
 * Generates tailored launch posts for requested platforms.
 */
export async function generateSocialPosts({
  projectName = "App",
  brandInfo = {},
  platforms = ["twitter", "linkedin", "producthunt"],
  tone = "launch",
  context = "",
  env = {},
  completeAI: customCompleteAI,
}) {
  const aiFunc = customCompleteAI || completeAI;

  const prompt = `You are an expert social media and product marketing copywriter.
Project Name: ${projectName}
Tone: ${tone}
Context: ${context || brandInfo.tagline || brandInfo.description || "A modern software platform built for high performance and exceptional user experience."}
Brand Info: ${JSON.stringify(brandInfo)}
Target Platforms: ${platforms.join(", ")}

Generate tailored launch posts for the requested platforms:
${platforms.includes("twitter") ? "- twitter: punchy launch tweet strictly <= 280 characters with 1-2 relevant hashtags." : ""}
${platforms.includes("linkedin") ? "- linkedin: professional announcement post highlighting value proposition, problem solved, and key features." : ""}
${platforms.includes("producthunt") ? '- producthunt: an object with "tagline" (strictly <= 60 characters) and "makerComment" (engaging maker introduction and invite for feedback).' : ""}
${platforms.includes("threads") ? "- threads: casual, conversational launch post." : ""}

Respond ONLY with a valid JSON object matching the requested platforms:
{
  ${platforms.includes("twitter") ? '"twitter": "...",' : ""}
  ${platforms.includes("linkedin") ? '"linkedin": "...",' : ""}
  ${platforms.includes("producthunt") ? '"producthunt": { "tagline": "...", "makerComment": "..." },' : ""}
  ${platforms.includes("threads") ? '"threads": "..."' : ""}
}`;

  const aiResult = await aiFunc({
    task: "generate-posts",
    messages: [
      { role: "system", content: "You are an expert product marketing copywriter. Output strict JSON only." },
      { role: "user", content: prompt },
    ],
    schema: { type: "object" },
    env,
  });

  const rawPosts = aiResult.data || aiResult;
  return sanitizeSocialPosts(rawPosts, {
    projectName,
    brandInfo,
    platforms,
    tone,
    context,
  });
}

/**
 * Generates and sanitizes store listing copy based on app metadata and screenshots (AC-009).
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
