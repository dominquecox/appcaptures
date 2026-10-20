// Studio UI: controls, preview strip, exports, lightbox, keyboard.
// DOM-bound (browser only). State comes from store.js, drawing from render.js.
import { VIDILOOP_ASSETS, PLATFORM_SIZES } from "./presets.js";
import { coerceBrand, presetFor, screensFor, slugFor, normHex } from "./models.js";
import { draw, canvasBytes, zipStore, parseSize } from "./render.js";
import { createStore } from "./store.js";

const { state, load, save, reset } = createStore(
  typeof localStorage !== "undefined" ? localStorage : undefined
);
load();

const appSelect = document.getElementById("appSelect");
const platformSelect = document.getElementById("platformSelect");
const brandName = document.getElementById("brandName");
const brandPrimary = document.getElementById("brandPrimary");
const brandPrimaryText = document.getElementById("brandPrimaryText");
const brandBg = document.getElementById("brandBg");
const brandBgText = document.getElementById("brandBgText");
const brandFont = document.getElementById("brandFont");
const deviceFrame = document.getElementById("deviceFrame");
const leftPanel = document.getElementById("leftPanel");
const strip = document.getElementById("strip");
const sizeBtns = document.getElementById("sizeBtns");
export const CUSTOM_SIZES = []; // session-only custom WxH entries (not persisted)

// init controls from brand
function syncBrandUI(){
  const brand = state.brand;
  brandName.value = brand.name;
  brandPrimary.value = brand.primary;
  brandPrimaryText.value = brand.primary;
  brandBg.value = brand.bg;
  brandBgText.value = brand.bg;
  brandFont.value = brand.font;
  deviceFrame.value = brand.frame;
  const hs = document.getElementById("headlineSize");
  const hsv = document.getElementById("headlineSizeVal");
  const hw = document.getElementById("headlineWeight");
  const hc = document.getElementById("headlineColor");
  const hct = document.getElementById("headlineColorText");
  const ha = document.getElementById("headlineAlign");
  if(hs){ hs.value = brand.headlineSize; hsv.textContent = brand.headlineSize; }
  if(hw) hw.value = brand.headlineWeight;
  if(hc) hc.value = brand.headlineColor;
  if(hct) hct.value = brand.headlineColor;
  if(ha) ha.value = brand.headlineAlign;
  document.documentElement.style.setProperty("--primary", brand.primary);
  document.documentElement.style.setProperty("--bg", brand.bg);
  document.body.style.background = brand.bg;
  document.querySelector(".header").style.background = brand.bg;
  appSelect.value = state.appId;
  platformSelect.value = state.platform;
}
syncBrandUI();

function buildSizeBtns(){
  const base = state.platform === "both"
    ? [...PLATFORM_SIZES.ios, ...PLATFORM_SIZES.android]
    : PLATFORM_SIZES[state.platform];
  const list = [...base, ...CUSTOM_SIZES.filter(c=>c.platform === state.platform || state.platform === "both")];
  if(!list.find(s=>s.value === state.exportSize)) state.exportSize = list[0].value;
  sizeBtns.innerHTML = list.map(s=>`<button class="size-btn ${s.value === state.exportSize ? "active" : ""}" data-size="${s.value}">${s.label}</button>`).join("") + `<button class="size-btn" data-size="__custom">Custom…</button>`;
  sizeBtns.querySelectorAll(".size-btn").forEach(b=>b.addEventListener("click",()=>{
    if(b.dataset.size === "__custom"){ addCustomSize(); return; }
    state.exportSize = b.dataset.size;
    syncSizeBadge();
    renderStripOnly();
    save();
    buildSizeBtns();
  }));
  syncSizeBadge();
  const p = state.platform;
  const platLabel = p === "ios" ? "iOS" : p === "android" ? "Android" : p === "marketing" ? "Marketing" : p === "duo" ? "iPhone Duo" : "iOS + Android";
  document.getElementById("previewTitle").textContent = `Preview — ${state.brand.name} · ${platLabel}`;
}
function addCustomSize(){
  const v = prompt("Custom size as WIDTHxHEIGHT (e.g. 1320x2868)?", "");
  if(!v) return;
  const m = /^(\d+)x(\d+)$/.exec(v.trim());
  if(!m || +m[1] < 100 || +m[2] < 100 || +m[1] > 6000 || +m[2] > 6000){ alert("Use WIDTHxHEIGHT, 100–6000 each."); return; }
  state.exportSize = `${+m[1]}x${+m[2]}`;
  CUSTOM_SIZES.push({ value: state.exportSize, label: `${+m[1]}×${+m[2]}`, note: "Custom", platform: state.platform });
  syncSizeBadge(); renderStripOnly(); save(); buildSizeBtns();
}
function syncSizeBadge(){
  const all = [...PLATFORM_SIZES.ios, ...PLATFORM_SIZES.android, ...PLATFORM_SIZES.marketing, ...PLATFORM_SIZES.duo, ...CUSTOM_SIZES];
  const f = all.find(s=>s.value === state.exportSize);
  document.getElementById("sizeBadge").textContent = state.exportSize.replace("x", " × ") + (f ? ` · ${f.note}` : "");
}
buildSizeBtns();

function buildLeft(){
  leftPanel.innerHTML = "";
  document.getElementById("countPill").textContent = `${state.screens.length} screen${state.screens.length === 1 ? "" : "s"}`;
  state.screens.forEach((s, i)=>{
    const div = document.createElement("div");
    div.className = "card-editor" + (i === state.selected ? " active" : "");
    const assetOptions = state.appId === "vidiloop" ? VIDILOOP_ASSETS : [{label:"Custom upload (no preset)", path:""}];
    div.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="width:24px;height:24px;border-radius:999px;background:${i === state.selected ? state.brand.primary : "#211c3d"};color:#fff;display:grid;place-items:center;font-weight:800;font-size:11px">${i + 1}</span>
        <span style="font-weight:800;font-size:12px;color:#e5e7eb">Screen ${i + 1}</span>
        <button class="mini" data-k="remove" data-i="${i}" style="margin-left:auto;padding:3px 7px;font-size:10px">✕</button>
      </div>
      <label class="label">Headline — 3 to 6 words</label>
      <input type="text" value="${escapeHtmlAttr(s.headline)}" data-k="headline" data-i="${i}" maxlength="48" class="input" />
      ${state.appId === "vidiloop" ? `<label class="label" style="margin-top:7px">Preset image</label><select class="select-full" data-k="asset" data-i="${i}">${assetOptions.map((a, ai)=>`<option value="${ai}" ${ai === s.asset ? "selected" : ""}>${a.label}</option>`).join("")}</select>` : ``}
      <div class="row" style="margin-top:7px">
        <label class="mini" style="flex:1;text-align:center;cursor:pointer">Upload<input type="file" accept="image/*" data-k="file" data-i="${i}" style="display:none"></label>
        <button class="mini" data-k="dup" data-i="${i}">Duplicate</button>
      </div>
      ${s.file ? `<div style="margin-top:6px;color:#94a3b8;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.file.split("/").pop().slice(0, 34)}</div>` : ""}
    `;
    div.addEventListener("click",()=>{ state.selected = i; render(); });
    leftPanel.appendChild(div);
  });
  leftPanel.querySelectorAll("input[type=text], select").forEach(el=>{
    el.addEventListener("click", e=>e.stopPropagation());
    el.addEventListener("change", onEdit);
    el.addEventListener("input", onEdit);
  });
  leftPanel.querySelectorAll("input[type=file]").forEach(el=>el.addEventListener("change", onFile));
  leftPanel.querySelectorAll("button[data-k=remove]").forEach(el=>el.addEventListener("click", e=>{
    e.stopPropagation();
    const i = +el.dataset.i;
    if(state.screens.length <= 1) return alert("Keep at least 1 screen.");
    state.screens.splice(i, 1);
    if(state.selected >= state.screens.length) state.selected = state.screens.length - 1;
    save(); render();
  }));
  leftPanel.querySelectorAll("button[data-k=dup]").forEach(el=>el.addEventListener("click", e=>{
    e.stopPropagation();
    const i = +el.dataset.i;
    if(state.screens.length >= 10) return alert("Max 10 screens (store limit).");
    state.screens.splice(i + 1, 0, JSON.parse(JSON.stringify(state.screens[i])));
    state.selected = i + 1; save(); render();
  }));
}
function escapeHtmlAttr(s){ return s.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;"); }
function onEdit(e){
  const i = +e.target.dataset.i, k = e.target.dataset.k;
  if(k === "headline") state.screens[i].headline = e.target.value;
  if(k === "asset"){
    const ai = +e.target.value;
    state.screens[i].asset = ai;
    state.screens[i].file = VIDILOOP_ASSETS[ai].path;
  }
  save(); schedulePreview();
}
function onFile(e){
  const i = +e.target.dataset.i;
  const f = e.target.files[0]; if(!f) return;
  const url = URL.createObjectURL(f);
  state.screens[i].file = url; state.screens[i].asset = -1;
  save(); render();
}

// brand listeners
brandName.addEventListener("input", e=>{
  state.brand.name = e.target.value || "App";
  document.getElementById("previewTitle").textContent = `Preview — ${state.brand.name} · ${state.platform}`;
  save(); schedulePreview();
});
function syncPrimary(v){
  v = normHex(v, state.brand.primary);
  state.brand.primary = v; brandPrimary.value = v; brandPrimaryText.value = v;
  document.documentElement.style.setProperty("--primary", v); save(); schedulePreview();
}
brandPrimary.addEventListener("input", e=>syncPrimary(e.target.value));
brandPrimaryText.addEventListener("change", e=>syncPrimary(e.target.value));
brandBg.addEventListener("input", e=>{
  const v = normHex(e.target.value, state.brand.bg);
  state.brand.bg = v; brandBg.value = v; brandBgText.value = v;
  applyBg(v); save(); schedulePreview();
});
brandBgText.addEventListener("change", e=>{
  const v = normHex(e.target.value, state.brand.bg);
  state.brand.bg = v; brandBg.value = v; brandBgText.value = v;
  applyBg(v); save(); schedulePreview();
});
function applyBg(v){
  document.documentElement.style.setProperty("--bg", v);
  document.body.style.background = v;
  document.querySelector(".header").style.background = v;
}
brandFont.addEventListener("change", e=>{ state.brand.font = e.target.value; save(); renderStripOnly(); });
deviceFrame.addEventListener("change", e=>{ state.brand.frame = e.target.value; save(); renderStripOnly(); });
const headlineSize = document.getElementById("headlineSize");
const headlineSizeVal = document.getElementById("headlineSizeVal");
const headlineWeight = document.getElementById("headlineWeight");
const headlineColor = document.getElementById("headlineColor");
const headlineColorText = document.getElementById("headlineColorText");
const headlineAlign = document.getElementById("headlineAlign");
function syncHeadlineSize(v){ state.brand.headlineSize = parseInt(v, 10); headlineSizeVal.textContent = state.brand.headlineSize; schedulePreview(); }
headlineSize.addEventListener("input", e=>syncHeadlineSize(e.target.value));
headlineSize.addEventListener("change", ()=>save());
headlineWeight.addEventListener("change", e=>{ state.brand.headlineWeight = e.target.value; save(); renderStripOnly(); });
function syncHeadlineColor(v){
  v = normHex(v, state.brand.headlineColor);
  state.brand.headlineColor = v; headlineColor.value = v; headlineColorText.value = v;
  save(); schedulePreview();
}
headlineColor.addEventListener("input", e=>syncHeadlineColor(e.target.value));
headlineColorText.addEventListener("change", e=>syncHeadlineColor(e.target.value));
headlineAlign.addEventListener("change", e=>{ state.brand.headlineAlign = e.target.value; save(); renderStripOnly(); });
document.getElementById("btnAddScreen").addEventListener("click",()=>{
  if(state.screens.length >= 10) return alert("Max 10 screens.");
  state.screens.push({ headline: "New screen", file: "", asset: -1 });
  state.selected = state.screens.length - 1; save(); render();
});
document.getElementById("btnResetBrand").addEventListener("click",()=>{
  const preset = presetFor(state.appId);
  state.brand = coerceBrand(null, preset);
  syncBrandUI(); save(); renderStripOnly();
});
appSelect.addEventListener("change", e=>{
  const v = e.target.value;
  save();
  if(v === "custom"){
    const name = prompt("App name?", "My App");
    if(!name){ appSelect.value = state.appId; return; }
    const primary = normHex(prompt("Primary hex (#7c5cff)?", "#7c5cff"), "#7c5cff");
    state.appId = "custom";
    if(state.apps[state.appId]){
      const st = state.apps[state.appId]; state.brand = st.brand; state.screens = st.screens;
    } else {
      state.brand = { name, primary, bg: "#0b0914", font: "Hanken Grotesk", frame: "island", headlineSize: 50, headlineWeight: "700", headlineColor: "#0f172a", headlineAlign: "center" };
      state.screens = [{ headline: `Welcome to ${name}`, file: "", asset: -1 }];
    }
  } else {
    if(state.apps[v]){
      state.appId = v; const st = state.apps[v]; state.brand = st.brand; state.screens = st.screens;
    } else {
      state.appId = v;
      const p = presetFor(v);
      state.brand = coerceBrand(null, p);
      state.screens = screensFor(v);
    }
  }
  state.selected = 0; syncBrandUI(); buildSizeBtns(); save(); render();
});
platformSelect.addEventListener("change", e=>{ state.platform = e.target.value; buildSizeBtns(); save(); renderStripOnly(); });

// ---- preview ----
let previewQueued = false;
function schedulePreview(){
  if(previewQueued) return;
  previewQueued = true;
  requestAnimationFrame(()=>{ previewQueued = false; renderStripOnly(); });
}
async function renderStripOnly(){
  const size = parseSize(state.exportSize) || [1320, 2868];
  const [W, H] = size;
  const previewW = H < W ? 340 : 190;
  const previewH = Math.round(previewW * H / W);
  const ps = 0.25, pw = Math.max(1, Math.round(W * ps)), ph = Math.max(1, Math.round(H * ps));
  strip.innerHTML = "";
  for(let i = 0; i < state.screens.length; i++){
    const s = state.screens[i];
    const wrap = document.createElement("div"); wrap.className = "screen-wrap";
    const frame = document.createElement("div");
    frame.className = "screen-frame" + (i === state.selected ? " selected" : "");
    frame.style.width = previewW + "px"; frame.style.height = previewH + "px";
    const c = document.createElement("canvas");
    c.width = pw; c.height = ph; c.style.width = "100%"; c.style.height = "100%";
    frame.appendChild(c);
    const zb = document.createElement("button"); zb.className = "zoom"; zb.type = "button";
    zb.setAttribute("aria-label", `Enlarge screen ${i + 1}: ${s.headline || "Untitled"}`);
    zb.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14M7 5v4M5 7h4"/></svg>';
    zb.addEventListener("click", ev=>{ ev.stopPropagation(); openLightbox(i); });
    frame.appendChild(zb);
    wrap.appendChild(frame);
    const lab = document.createElement("div"); lab.className = "lab";
    lab.textContent = (i + 1) + " · " + (s.headline || "Untitled"); wrap.appendChild(lab);
    frame.addEventListener("click",()=>{ state.selected = i; render(); });
    strip.appendChild(wrap);
    draw(c, s.headline || "Untitled", s.file, pw, ph, state.brand);
  }
  document.getElementById("previewSub").textContent = `${state.brand.bg} page · white cards with ${state.brand.primary} stroke · ${state.brand.font}. Tap a card to edit, magnifier to enlarge. ${state.screens.length} screens.`;
}
async function render(){ buildLeft(); await renderStripOnly(); }

// ---- exports ----
async function exportOne(index, W, H){
  index = Math.max(0, Math.min(index, state.screens.length - 1));
  const s = state.screens[index];
  const c = document.createElement("canvas");
  await draw(c, s.headline, s.file, W, H, state.brand);
  const a = document.createElement("a");
  a.download = `${String(index + 1).padStart(2, "0")}_${slugFor(s.headline)}_${W}x${H}.png`;
  a.href = URL.createObjectURL(await canvasBytes(c).then(d=>new Blob([d], { type: "image/png" })));
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 60000);
}
async function exportAll(W, H){
  const files = [];
  const btns = [document.getElementById("btnExportAll"), document.getElementById("btnExportAll2")];
  const labels = btns.map(b=>b && b.textContent);
  try{
    for(let i = 0; i < state.screens.length; i++){
      btns.forEach(b=>{ if(b) b.textContent = `Zipping ${i + 1}/${state.screens.length}…`; });
      const s = state.screens[i];
      const c = document.createElement("canvas");
      await draw(c, s.headline, s.file, W, H, state.brand);
      files.push({ name: `${String(i + 1).padStart(2, "0")}_${slugFor(s.headline)}_${W}x${H}.png`, data: await canvasBytes(c) });
    }
    const a = document.createElement("a");
    a.download = `${(state.brand.name || "app").toLowerCase().replace(/[^a-z0-9]+/g, "-")}_${W}x${H}.zip`;
    a.href = URL.createObjectURL(zipStore(files)); a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 60000);
  }finally{
    btns.forEach((b, i)=>{ if(b) b.textContent = labels[i]; });
  }
}
document.getElementById("btnExportAll").addEventListener("click", async ()=>{
  const [W, H] = parseSize(state.exportSize); await exportAll(W, H);
  if(state.platform === "both"){
    const other = PLATFORM_SIZES.android[0].value; const [w2, h2] = parseSize(other);
    await exportAll(w2, h2);
  }
});
document.getElementById("btnExportAll2").addEventListener("click",()=>{
  const [W, H] = parseSize(state.exportSize); exportAll(W, H);
});
document.getElementById("btnExportSelected").addEventListener("click",()=>{
  const [W, H] = parseSize(state.exportSize); exportOne(state.selected, W, H);
});
document.getElementById("btnExportOther").addEventListener("click",()=>{
  const list = state.platform === "ios" ? PLATFORM_SIZES.android : PLATFORM_SIZES.ios;
  const [W, H] = parseSize(list[0].value); exportAll(W, H);
});
document.getElementById("btnSave").addEventListener("click",()=>{
  save();
  const b = document.getElementById("btnSave"), t = b.textContent;
  b.textContent = "Saved ✓"; setTimeout(()=>b.textContent = t, 1100);
});
document.getElementById("btnResetAll").addEventListener("click",()=>{
  if(!confirm("Reset studio? Clears saved brands, screens, and uploads, then reloads fresh presets.")) return;
  reset();
  location.reload();
});

// ---- lightbox ----
const lightbox = document.getElementById("lightbox");
const lbCanvas = document.getElementById("lbCanvas");
let lbReturnFocus = null;
async function openLightbox(i){
  state.selected = Math.max(0, Math.min(i, state.screens.length - 1));
  const [W, H] = parseSize(state.exportSize);
  await draw(lbCanvas, state.screens[state.selected].headline || "Untitled", state.screens[state.selected].file, W, H, state.brand);
  document.getElementById("lbCap").textContent = (state.selected + 1) + " · " + (state.screens[state.selected].headline || "Untitled");
  document.getElementById("lbSize").textContent = state.exportSize.replace("x", " × ");
  lbReturnFocus = document.activeElement;
  lightbox.hidden = false;
  document.body.style.overflow = "hidden";
  document.getElementById("lbClose").focus();
  renderStripOnly();
}
function closeLightbox(){
  lightbox.hidden = true;
  document.body.style.overflow = "";
  if(lbReturnFocus && lbReturnFocus.focus) lbReturnFocus.focus();
}
async function stepLightbox(d){
  state.selected = (state.selected + d + state.screens.length) % state.screens.length;
  await openLightbox(state.selected);
}
document.querySelector(".lb-backdrop").addEventListener("click", closeLightbox);
document.getElementById("lbClose").addEventListener("click", closeLightbox);
document.getElementById("lbPrev").addEventListener("click", ()=>stepLightbox(-1));
document.getElementById("lbNext").addEventListener("click", ()=>stepLightbox(1));
document.getElementById("btnEnlarge").addEventListener("click", ()=>openLightbox(state.selected));
document.addEventListener("keydown", e=>{
  const tag = (document.activeElement && document.activeElement.tagName) || "";
  const typing = /INPUT|SELECT|TEXTAREA/.test(tag);
  if(!lightbox.hidden){
    if(e.key === "Escape") closeLightbox();
    else if(e.key === "ArrowLeft") stepLightbox(-1);
    else if(e.key === "ArrowRight") stepLightbox(1);
    else if(e.key === "Tab"){
      const ids = ["lbClose", "lbPrev", "lbNext"].map(id=>document.getElementById(id));
      const first = ids[0], last = ids[ids.length - 1];
      if(e.shiftKey && document.activeElement === first){ last.focus(); e.preventDefault(); }
      else if(!e.shiftKey && document.activeElement === last){ first.focus(); e.preventDefault(); }
    }
    return;
  }
  if(typing) return;
  if((e.key >= "1" && e.key <= "9") || e.key === "0"){
    const i = e.key === "0" ? 9 : +e.key - 1;
    if(i < state.screens.length){ state.selected = i; render(); }
  } else if(e.key === "e" || e.key === "E"){ openLightbox(state.selected); }
});
render();
