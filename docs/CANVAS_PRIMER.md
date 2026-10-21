# Canvas Primer — the renderer you own (phone-friendly)

For: a backend-leaning engineer returning to frontend. Goal: be in tune with
the AppCaptures studio renderer, not Canvas in general.

Your renderer lives in [app/js/render.js](/Users/ploonu/code/appcaptures/app/js/render.js)
(202 lines, zero dependencies). It draws everything: portrait screenshot
cards, landscape marketing headers, and the ZIP writer for Export All.

## 1. The one mental model

Canvas is an immediate-mode bitmap. There are no nodes, no CSS, no reflow.
You issue draw calls, pixels change, old state is gone. Every resize or brand
tweak = wipe and redraw from scratch.

That is why our functions take `(canvas, headline, src, W, H, brand)` and
start with:

```js
canvas.width = W; canvas.height = H;   // also WIPES the canvas
ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);  // no alpha, store-safe
```

Setting `width`/`height` resets state. Apple rejects transparency, so we
always start opaque white. That first `fillRect` is a store requirement,
not a style choice.

## 2. Coordinates are just numbers (no CSS)

Everything is proportional to `W` (portrait) or `H` (landscape):

- Portrait card: `phoneW = W * 0.775`, `phoneH = phoneW * 2.16`
- Headline size: `fontSize = W * (brand.headlineSize / 1320)` — the slider
  value (32–72, default 50) is calibrated at 1320px wide, then scales.
- Border, radius, shadow, insets: all `W * ratio`, rounded with `Math.round`.

Why ratios, not pixels? One code path must hit 1320×2868, 1290×2796,
1080×1920, Duo 1398×2034, and any Custom WxH. Ratios keep every size exact:
`canvas.width = W` guarantees output pixels, no CSS scaling involved.

Dispatch is one line — wide means header, tall means card:

```js
export function draw(canvas, headline, src, W, H, brand){
  return W > H ? drawHeader(...) : drawCard(...);
}
```

## 3. Text: font strings + measure, not DOM

Canvas text has no wrapping. We wrap by hand (`wrapHeadline`): split words,
`ctx.measureText(test).width`, break at `maxWidth`, cap at 2 lines (card)
or 3 (header). Card centers (`W/2` or `W*0.07` for left-align), header pins
left at `W*0.07` and vertically centers the block.

The font string order matters: `weight size family`:

```js
ctx.font = `${weight} ${fontSize}px ${brand.font}, Inter, sans-serif`;
```

Gotcha from your era: web fonts load async. If a custom font is not ready
when we draw, canvas silently falls back. Preview looks fine later, export
already baked the fallback. Fix (open): `document.fonts.ready` before export.

## 4. Images: load, cover-fit, clip

`loadImage(src)` caches by URL in a `Map` so 10 exports of one screenshot
decode once. `img.crossOrigin = "anonymous"` keeps the canvas *clean*:
without CORS headers, drawing one remote image *taints* the canvas and
`toBlob` throws. Uploads (same-origin blob:) are safe.

`paintCover` is CSS `object-fit: cover` by hand: compare aspect ratios,
scale the long side, center the overflow, paint bg underneath first so
letterbox zones never show transparency.

Phones are rounded clips: `roundRect(...) → ctx.clip() → drawImage →
ctx.restore()`. The Dynamic Island / notch is just a second filled rounded
rect on top (`brand.frame === "island" | "notch"`). No image assets needed.

Empty-headline guard: `headline || "Untitled"` so exports never bake blank
text. Filenames come from `slugFor()` (shared with export).

## 5. Preview vs export (the blur trap)

The on-screen preview is a small canvas scaled by CSS. The export is a
full-size canvas (`canvas.width = W`). Same draw calls, different backing
store — always judge sharpness from a downloaded PNG at 100%, never from
the preview.

Memory note: a 1320×2868 canvas is ~15MB raw; Both-platforms export draws
sequentially (`await`, no overlap) deliberately, so 10 screens never hold
10 bitmaps at once.

## 6. ZIP: stored, not compressed

`zipStore(files)` hand-writes a ZIP with method 0 (stored). PNGs already
compress, so deflate gains ~nothing and costs a dependency. CRC32 + little-
endian headers by hand, filenames UTF-8 (`0x0800` flag). `canvasBytes(c)`
goes `toBlob("image/png") → ArrayBuffer → Uint8Array` per screen.

## 7. Recipes (where to cut code)

| Change | File / spot |
|---|---|
| Headline slider range | `app/index.html` slider + `presets.js` default 50 |
| New store size | `presets.js` sizes list (renderer needs nothing) |
| New device frame | `render.js` island/notch branch + `models.js` guard |
| Brand fields | `models.js` coerce + `store.js` persist |
| Export filename | `slugFor()` in studio logic |
| Metering/paywall | `POST /api/exports` in `worker.js` (dormant) |

Module map: `presets.js` data → `models.js` guards → `render.js` pixels →
`store.js` persistence → `ui.js` DOM → `main.js` entry. Brand flows as a
function param, never a global.

## 8. AI-era workflow (how to stay in tune)

Let AI write draw calls, but verify with numbers, not eyes:

1. `node tests/studio-logic.mjs` — extracts the real guards and asserts.
2. Check exact pixels: open a PNG, confirm `W×H` matches the size button.
3. Grep for magic numbers — new constants belong in `presets.js`, not inline.
4. One draw path: if portrait and landscape diverge, fix the shared helper.

Red flags in AI-proposed canvas code: `ctx.scale(devicePixelRatio)` on the
*export* canvas (breaks exact pixels — DPR belongs on preview only),
`shadowBlur` without rounding (slow on big canvases), uncached `new Image`
per export, `fillText` without `measureText` wrapping, remote images without
`crossOrigin` + try/catch fallback.

## 9. Glossary (30 seconds)

- **backing store**: the real pixel buffer (`width`/`height` attrs).
- **tainted canvas**: remote pixels without CORS — export blocked.
- **cover-fit**: scale to fill, crop overflow (`paintCover`).
- **clip**: mask later draws follow (`roundRect` + `clip`).
- **stored ZIP**: method 0, no recompression, fast for PNGs.
