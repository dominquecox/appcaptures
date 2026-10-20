// Brand + Screen models: defaults, coercion, and shared guards.
// Pure — no DOM, no storage. Directly unit-tested by tests/studio-logic.mjs.
import { APP_PRESETS } from "./presets.js";

export const FALLBACK_PRIMARY = "#7c5cff";
export const FALLBACK_BG = "#0b0914";

export function normHex(v, fallback){
  let s = String(v == null ? "" : v).trim();
  if(!s.startsWith("#")) s = "#" + s;
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(s);
  if(!m) return fallback;
  let h = m[1];
  if(h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  return "#" + h.toLowerCase();
}

export function slugFor(headline){
  return String(headline || "").toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"").slice(0,24) || "screen";
}

export function parseSize(s){
  const m = /^(\d+)x(\d+)$/.exec(String(s || ""));
  return m ? [+m[1], +m[2]] : null;
}

const WEIGHTS = new Set(["500", "600", "700", "800"]);
const ALIGNS = new Set(["center", "left"]);
const FONTS = new Set(["Inter", "Hanken Grotesk"]);
const FRAMES = new Set(["island", "notch", "minimal"]);

export function coerceBrand(raw, preset){
  const p = preset || {};
  const b = { ...(raw || {}) };
  return {
    name: String(b.name || p.name || "App").slice(0, 30) || "App",
    primary: normHex(b.primary ?? p.primary, FALLBACK_PRIMARY),
    bg: normHex(b.bg ?? p.bg, FALLBACK_BG),
    font: FONTS.has(b.font) ? b.font : "Hanken Grotesk",
    frame: FRAMES.has(b.frame) ? b.frame : "island",
    headlineSize: Math.min(72, Math.max(32, parseInt(b.headlineSize ?? p.headlineSize ?? 50, 10) || 50)),
    headlineWeight: WEIGHTS.has(String(b.headlineWeight ?? p.headlineWeight)) ? String(b.headlineWeight ?? p.headlineWeight) : "700",
    headlineColor: normHex(b.headlineColor ?? p.headlineColor, "#0f172a"),
    headlineAlign: ALIGNS.has(b.headlineAlign ?? p.headlineAlign) ? (b.headlineAlign ?? p.headlineAlign) : "center",
  };
}

export function coerceScreen(raw){
  const s = { ...(raw || {}) };
  return {
    headline: String(s.headline ?? "Untitled").slice(0, 48),
    file: typeof s.file === "string" && !s.file.startsWith("blob:") ? s.file : "",
    asset: Number.isInteger(s.asset) ? s.asset : -1,
  };
}

export function presetFor(appId){
  return APP_PRESETS[appId] || APP_PRESETS.generic;
}

export function clampIndex(i, n){
  if(n <= 0) return 0;
  return Math.max(0, Math.min(i, n - 1));
}

export function screensFor(appId){
  return presetFor(appId).screens.map(coerceScreen);
}
