// Canvas renderers: portrait screenshot card, landscape marketing header,
// stored-zip writer. Side-effect-free at import (DOM/canvas only via params).
const imageCache = new Map();

export function loadImage(src){
  if(!src) return Promise.reject("empty");
  if(imageCache.has(src)) return imageCache.get(src);
  const p = new Promise((res, rej)=>{
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = ()=>res(img); img.onerror = rej; img.src = src;
  });
  imageCache.set(src, p); return p;
}

// cover-fit an image into x,y,w,h over a bg fill
export function paintCover(ctx, img, x, y, w, h, bg){
  const pr = w / h, ir = img.width / img.height;
  let dw, dh, dx, dy;
  if(ir > pr){ dh = h; dw = dh * ir; dx = x + (w - dw) / 2; dy = y; }
  else { dw = w; dh = dw / ir; dx = x; dy = y + (h - dh) / 2; }
  ctx.fillStyle = bg; ctx.fillRect(x, y, w, h);
  ctx.drawImage(img, dx, dy, dw, dh);
}

export function roundRect(ctx, x, y, w, h, r){
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function brandStroke(brand){
  const hex = brand.primary.replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},0.32)`;
}

function wrapHeadline(ctx, headline, maxWidth, maxLines){
  const words = headline.trim().split(/\s+/);
  const lines = []; let line = "";
  for(const w of words){
    const test = line ? line + " " + w : w;
    if(ctx.measureText(test).width > maxWidth && line){ lines.push(line); line = w; }
    else line = test;
  }
  if(line) lines.push(line);
  return lines.slice(0, maxLines);
}

export async function drawCard(canvas, headline, src, W, H, brand){
  headline = headline || "Untitled";
  const ctx = canvas.getContext("2d");
  canvas.width = W; canvas.height = H;
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
  const border = Math.round(W * 0.012), radius = Math.round(W * 0.045);
  roundRect(ctx, border, border, W - border * 2, H - border * 2, radius);
  ctx.strokeStyle = brandStroke(brand); ctx.lineWidth = Math.round(W * 0.008); ctx.stroke();
  ctx.fillStyle = "#ffffff"; ctx.fill();
  const headlineY = Math.round(H * 0.07), maxWidth = W * 0.86;
  const fontSize = Math.round(W * (brand.headlineSize / 1320));
  ctx.fillStyle = brand.headlineColor || "#0f172a";
  ctx.textAlign = brand.headlineAlign || "center";
  ctx.textBaseline = "middle";
  ctx.font = `${brand.headlineWeight || "700"} ${fontSize}px ${brand.font}, Inter, sans-serif`;
  const lines = wrapHeadline(ctx, headline, maxWidth, 2);
  const lineHeight = fontSize * 1.15;
  let y = headlineY + lineHeight / 2;
  if(lines.length === 2) y -= lineHeight * 0.15;
  const tx = brand.headlineAlign === "left" ? Math.round(W * 0.07) : W / 2;
  lines.forEach(l=>{ ctx.fillText(l, tx, y); y += lineHeight; });
  const phoneW = Math.round(W * 0.775), phoneH = Math.round(phoneW * 2.16);
  const phoneX = Math.round((W - phoneW) / 2), phoneY = Math.round(H * 0.168);
  const phoneR = Math.round(W * 0.055);
  ctx.save();
  ctx.shadowColor = "rgba(15,23,42,0.14)"; ctx.shadowBlur = Math.round(W * 0.06); ctx.shadowOffsetY = Math.round(W * 0.03);
  roundRect(ctx, phoneX, phoneY, phoneW, phoneH, phoneR);
  ctx.fillStyle = "#f8fafc"; ctx.fill(); ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = Math.max(1, Math.round(W * 0.002)); ctx.stroke(); ctx.restore();
  const inset = Math.round(W * 0.012);
  ctx.save();
  roundRect(ctx, phoneX + inset, phoneY + inset, phoneW - inset * 2, phoneH - inset * 2, phoneR - Math.round(W * 0.02));
  ctx.clip();
  try{
    const img = await loadImage(src);
    paintCover(ctx, img, phoneX + inset, phoneY + inset, phoneW - inset * 2, phoneH - inset * 2, brand.bg);
  }catch(e){
    ctx.fillStyle = brand.bg; ctx.fillRect(phoneX + inset, phoneY + inset, phoneW - inset * 2, phoneH - inset * 2);
    ctx.fillStyle = "#9ca3af"; ctx.font = `600 ${Math.round(W * 0.022)}px Inter`; ctx.textAlign = "center";
    ctx.fillText("Upload a screenshot", W / 2, phoneY + phoneH / 2);
  }
  ctx.restore();
  if(brand.frame === "island"){
    const diW = Math.round(phoneW * 0.24), diH = Math.round(W * 0.028);
    roundRect(ctx, phoneX + (phoneW - diW) / 2, phoneY + Math.round(W * 0.018), diW, diH, diH / 2);
    ctx.fillStyle = brand.bg; ctx.fill();
  } else if(brand.frame === "notch"){
    const nw = Math.round(phoneW * 0.42), nh = Math.round(W * 0.04);
    roundRect(ctx, phoneX + (phoneW - nw) / 2, phoneY, nw, nh, nh / 2);
    ctx.fillStyle = brand.bg; ctx.fill();
  }
}

export async function drawHeader(canvas, headline, src, W, H, brand){
  headline = headline || "Untitled";
  const ctx = canvas.getContext("2d");
  canvas.width = W; canvas.height = H;
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
  const border = Math.max(2, Math.round(H * 0.02)), radius = Math.round(H * 0.09);
  roundRect(ctx, border, border, W - border * 2, H - border * 2, radius);
  ctx.strokeStyle = brandStroke(brand); ctx.lineWidth = Math.max(2, Math.round(H * 0.014)); ctx.stroke();
  ctx.fillStyle = "#ffffff"; ctx.fill();
  const fontSize = Math.round(W * (brand.headlineSize / 1320));
  ctx.fillStyle = brand.headlineColor || "#0f172a"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.font = `${brand.headlineWeight || "700"} ${fontSize}px ${brand.font}, Inter, sans-serif`;
  const lines = wrapHeadline(ctx, headline, W * 0.36, 3);
  const lineHeight = fontSize * 1.15, tx = Math.round(W * 0.07);
  let y = Math.round(H / 2 - ((lines.length - 1) * lineHeight) / 2);
  lines.forEach(l=>{ ctx.fillText(l, tx, y); y += lineHeight; });
  const phoneH = Math.round(H * 0.74), phoneW = Math.round(phoneH / 2.16);
  const phoneX = Math.round(W * 0.93 - phoneW), phoneY = Math.round((H - phoneH) / 2);
  const phoneR = Math.round(H * 0.09);
  ctx.save();
  ctx.shadowColor = "rgba(15,23,42,0.14)"; ctx.shadowBlur = Math.round(H * 0.1); ctx.shadowOffsetY = Math.round(H * 0.05);
  roundRect(ctx, phoneX, phoneY, phoneW, phoneH, phoneR);
  ctx.fillStyle = "#f8fafc"; ctx.fill(); ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = Math.max(1, Math.round(H * 0.004)); ctx.stroke(); ctx.restore();
  const inset = Math.max(2, Math.round(H * 0.02));
  ctx.save();
  roundRect(ctx, phoneX + inset, phoneY + inset, phoneW - inset * 2, phoneH - inset * 2, Math.max(1, phoneR - inset * 2));
  ctx.clip();
  try{
    const img = await loadImage(src);
    paintCover(ctx, img, phoneX + inset, phoneY + inset, phoneW - inset * 2, phoneH - inset * 2, brand.bg);
  }catch(e){
    ctx.fillStyle = brand.bg; ctx.fillRect(phoneX + inset, phoneY + inset, phoneW - inset * 2, phoneH - inset * 2);
    ctx.fillStyle = "#9ca3af"; ctx.font = `600 ${Math.round(H * 0.04)}px Inter`; ctx.textAlign = "center";
    ctx.fillText("Upload a screenshot", phoneX + phoneW / 2, phoneY + phoneH / 2);
  }
  ctx.restore();
  if(brand.frame === "island"){
    const diW = Math.round(phoneW * 0.24), diH = Math.round(H * 0.05);
    roundRect(ctx, phoneX + (phoneW - diW) / 2, phoneY + Math.round(H * 0.03), diW, diH, diH / 2);
    ctx.fillStyle = brand.bg; ctx.fill();
  } else if(brand.frame === "notch"){
    const nw = Math.round(phoneW * 0.42), nh = Math.round(H * 0.07);
    roundRect(ctx, phoneX + (phoneW - nw) / 2, phoneY, nw, nh, nh / 2);
    ctx.fillStyle = brand.bg; ctx.fill();
  }
}

// portrait screenshot card vs landscape marketing header
export function draw(canvas, headline, src, W, H, brand){
  return W > H
    ? drawHeader(canvas, headline, src, W, H, brand)
    : drawCard(canvas, headline, src, W, H, brand);
}

// minimal stored (uncompressed) zip writer — PNGs already compress, so
// method 0 keeps it dependency-free and fast. Little-endian by spec.
const CRC_T = (()=>{
  const t = new Uint32Array(256);
  for(let n = 0; n < 256; n++){ let c = n; for(let k = 0; k < 8; k++){ c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); } t[n] = c >>> 0; }
  return t;
})();

export function crc32(u8){
  let c = 0xFFFFFFFF;
  for(let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

export function zipStore(files){
  const te = new TextEncoder(), out = [];
  let off = 0; const cd = [];
  const w32 = v=>{ const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); out.push(b); };
  const w16 = v=>{ const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); out.push(b); };
  const d = new Date();
  const mtime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const mdate = ((d.getFullYear() - 1980) << 25) | ((d.getMonth() + 1) << 21) | (d.getDate() << 16);
  for(const f of files){
    const name = te.encode(f.name), crc = crc32(f.data), lh = off;
    w32(0x04034b50); w16(20); w16(0x0800); w16(0); w16(mtime); w16(mdate);
    w32(crc); w32(f.data.length); w32(f.data.length);
    w16(name.length); w16(0); out.push(name); out.push(f.data);
    off += 30 + name.length + f.data.length;
    cd.push({ name, crc, len: f.data.length, off: lh });
  }
  const cdOff = off; let cdSize = 0;
  for(const e of cd){
    w32(0x02014b50); w16(20); w16(20); w16(0x0800); w16(0); w16(mtime); w16(mdate);
    w32(e.crc); w32(e.len); w32(e.len); w16(e.name.length);
    w16(0); w16(0); w16(0); w16(0); w32(0);
    w32(e.off); out.push(e.name);
    cdSize += 46 + e.name.length;
  }
  w32(0x06054b50); w16(0); w16(0); w16(cd.length); w16(cd.length);
  w32(cdSize); w32(cdOff); w16(0);
  return new Blob(out, { type: "application/zip" });
}

export function canvasBytes(c){
  return new Promise(res=>c.toBlob(b=>b.arrayBuffer().then(ab=>res(new Uint8Array(ab))), "image/png"));
}
