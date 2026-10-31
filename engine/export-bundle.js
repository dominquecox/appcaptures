/**
 * @ploonu/export-bundle - Multi-store asset ZIP bundler for AppCaptures.
 *
 * Builds structured store asset ZIP bundles for Apple App Store and Google Play:
 * - ios/6.9-inch/, ios/6.7-inch/, ios/6.1-inch/
 * - android/phone/, android/tablet/, android/feature_graphic_1024x500.png
 * - copy/listing.json, copy/listing.txt
 * - manifest.json
 *
 * Implements pure JS stored ZIP generation and clean 24-bit RGB PNG generation
 * with watermark indicators on free tiers.
 */

import zlib from "node:zlib";

// CRC32 Lookup Table
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

/**
 * Creates a valid 24-bit RGB PNG with specified dimensions.
 * Conforms to Apple and Google Play Console requirements (no alpha channel).
 * If watermarked is true, includes AppCaptures watermark metadata and indicator.
 */
export function createPng(width, height, options = {}) {
  const { watermarked = false, label = "" } = options;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk (13 bytes): width, height, bitDepth 8, colorType 2 (RGB, no alpha)
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB 24-bit (no alpha)
  ihdr[10] = 0; // deflate compression
  ihdr[11] = 0; // adaptive filter
  ihdr[12] = 0; // non-interlaced

  const chunks = [
    sig,
    makePngChunk("IHDR", ihdr),
  ];

  if (watermarked) {
    chunks.push(makePngChunk("tEXt", Buffer.from("Watermark\0AppCaptures Free Tier - appcaptures.com", "utf8")));
    chunks.push(makePngChunk("tEXt", Buffer.from("Software\0AppCaptures (Watermarked Free Tier)", "utf8")));
  } else {
    chunks.push(makePngChunk("tEXt", Buffer.from("Software\0AppCaptures Pro - appcaptures.com", "utf8")));
  }

  if (label) {
    chunks.push(makePngChunk("tEXt", Buffer.from(`Comment\0${label}`, "utf8")));
  }

  // Scanline data: 1 filter byte (0 = None) + width * 3 bytes (RGB)
  // Use a nice neutral background color: RGB(248, 250, 252) #f8fafc
  const scanline = Buffer.alloc(1 + width * 3);
  scanline[0] = 0; // Filter byte: None
  for (let x = 0; x < width; x++) {
    const idx = 1 + x * 3;
    scanline[idx] = 248;     // R
    scanline[idx + 1] = 250; // G
    scanline[idx + 2] = 252; // B
  }

  // Repeat scanline for all rows
  const rawData = Buffer.concat(Array(height).fill(scanline));
  const compressed = zlib.deflateSync(rawData);

  chunks.push(makePngChunk("IDAT", compressed));
  chunks.push(makePngChunk("IEND", Buffer.alloc(0)));

  return Buffer.concat(chunks);
}

/**
 * Pure JS stored ZIP archive builder.
 * Accepts files: Array<{ name: string, data: Uint8Array|Buffer|string }>
 * Returns complete ZIP binary as Uint8Array.
 */
export function zipSync(files) {
  const te = new TextEncoder();
  const chunks = [];
  const cd = [];
  let offset = 0;

  const w32 = (v) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v, true);
    chunks.push(b);
  };
  const w16 = (v) => {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, v, true);
    chunks.push(b);
  };

  const d = new Date();
  const mtime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const mdate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();

  for (const f of files) {
    const nameBytes = te.encode(f.name);
    const dataBytes = typeof f.data === "string"
      ? te.encode(f.data)
      : (Buffer.isBuffer(f.data) ? new Uint8Array(f.data.buffer, f.data.byteOffset, f.data.byteLength) : f.data);
    const crc = crc32(dataBytes);
    const localHeaderOffset = offset;

    // Local file header: 30 bytes + name length + data length
    w32(0x04034b50); // signature
    w16(20);         // version needed: 2.0
    w16(0x0800);     // general purpose flag: UTF-8
    w16(0);          // compression method: 0 (stored)
    w16(mtime);      // last mod time
    w16(mdate);      // last mod date
    w32(crc);        // crc32
    w32(dataBytes.length); // compressed size
    w32(dataBytes.length); // uncompressed size
    w16(nameBytes.length); // file name length
    w16(0);          // extra field length
    chunks.push(nameBytes);
    chunks.push(dataBytes);

    offset += 30 + nameBytes.length + dataBytes.length;
    cd.push({ nameBytes, crc, len: dataBytes.length, offset: localHeaderOffset });
  }

  const cdOffset = offset;
  let cdSize = 0;

  // Central Directory Headers: 46 bytes + name length per file
  for (const e of cd) {
    w32(0x02014b50); // signature
    w16(20);         // version made by
    w16(20);         // version needed
    w16(0x0800);     // flags: UTF-8
    w16(0);          // compression method: stored
    w16(mtime);      // last mod time
    w16(mdate);      // last mod date
    w32(e.crc);      // crc32
    w32(e.len);      // compressed size
    w32(e.len);      // uncompressed size
    w16(e.nameBytes.length); // file name length
    w16(0);          // extra field length
    w16(0);          // comment length
    w16(0);          // disk number start
    w16(0);          // internal attributes
    w32(0);          // external attributes
    w32(e.offset);   // relative offset of local header
    chunks.push(e.nameBytes);
    cdSize += 46 + e.nameBytes.length;
  }

  // End of Central Directory Record: 22 bytes
  w32(0x06054b50); // signature
  w16(0);          // disk number
  w16(0);          // start disk
  w16(cd.length);  // entries on disk
  w16(cd.length);  // total entries
  w32(cdSize);     // size of central directory
  w32(cdOffset);   // offset of central directory
  w16(0);          // comment length

  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let pos = 0;
  for (const c of chunks) {
    result.set(c, pos);
    pos += c.length;
  }
  return result;
}

/**
 * Parses a ZIP buffer and returns a map of filename -> entry info.
 */
export function readZip(buf) {
  const u8 = Buffer.isBuffer(buf) ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) : buf;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const le32 = (o) => dv.getUint32(o, true);
  const le16 = (o) => dv.getUint16(o, true);

  // Find End of Central Directory
  let eocd = u8.length - 22;
  while (eocd >= 0 && le32(eocd) !== 0x06054b50) {
    eocd--;
  }
  if (eocd < 0) throw new Error("Invalid ZIP archive: EOCD not found");

  const totalEntries = le16(eocd + 10);
  let p = le32(eocd + 16);
  const entries = new Map();

  for (let i = 0; i < totalEntries; i++) {
    if (le32(p) !== 0x02014b50) throw new Error(`Invalid Central Directory Header at offset ${p}`);
    const crc = le32(p + 16);
    const compressedLen = le32(p + 20);
    const uncompressedLen = le32(p + 24);
    const nameLen = le16(p + 28);
    const extraLen = le16(p + 30);
    const commentLen = le16(p + 32);
    const localHeaderOffset = le32(p + 42);

    const name = Buffer.from(u8.slice(p + 46, p + 46 + nameLen)).toString("utf8");

    // Read data from local header
    const localNameLen = le16(localHeaderOffset + 26);
    const localExtraLen = le16(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const data = u8.slice(dataStart, dataStart + uncompressedLen);

    entries.set(name, {
      name,
      crc,
      len: uncompressedLen,
      data,
    });

    p += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

/**
 * Builds a complete per-store ZIP bundle containing structured directories:
 * - ios/6.9-inch/, ios/6.7-inch/, ios/6.1-inch/
 * - android/phone/, android/tablet/, android/feature_graphic_1024x500.png
 * - copy/listing.json, copy/listing.txt
 * - manifest.json
 *
 * @param {object} params
 * @param {object} params.project - Project object ({ id, name, ... })
 * @param {Array} params.screens - Array of screen objects
 * @param {object} [params.listing] - Listing metadata
 * @param {boolean} [params.watermarked=false] - Free vs paid watermarking flag
 * @param {string} [params.store="both"] - "both" | "apple" | "ios" | "google_play" | "android"
 * @param {boolean} [params.includeCopy=true] - Whether to include copy/ folder
 * @returns {Uint8Array} Complete ZIP file bytes
 */
export function buildStoreZipBundle({
  project = {},
  screens = [],
  listing = null,
  watermarked = false,
  store = "both",
  includeCopy = true,
} = {}) {
  const proj = project || {};
  const projId = proj.id || "proj_default";
  const projName = proj.name || "AppCaptures";
  const isWatermarked = Boolean(watermarked);
  const storeNormalized = String(store || "both").toLowerCase();

  const includeIos = storeNormalized === "both" || storeNormalized === "ios" || storeNormalized === "apple";
  const includeAndroid = storeNormalized === "both" || storeNormalized === "android" || storeNormalized === "google_play";

  // Normalize screens array
  const screenList = Array.isArray(screens) && screens.length > 0
    ? screens
    : [{ id: "screen-01", ord: 0, headline: projName, subhead: "" }];

  // Normalize listing fields
  let listingFields = {};
  if (listing && typeof listing === "object") {
    if (typeof listing.fields_json === "string") {
      try {
        listingFields = JSON.parse(listing.fields_json);
      } catch {
        listingFields = {};
      }
    } else if (listing.fields && typeof listing.fields === "object") {
      listingFields = { ...listing.fields };
    } else {
      listingFields = { ...listing };
    }
  }

  const normalizedListing = {
    title: listingFields.title || projName,
    subtitle: listingFields.subtitle || `High-converting screenshots for ${projName}`,
    description: listingFields.description || `Created with AppCaptures. Professional App Store & Google Play screenshots designed to boost conversion rates and installs.`,
    keywords: listingFields.keywords || "app,screenshots,app store,google play,appcaptures",
    promoText: listingFields.promoText || `Try ${projName} today!`,
  };

  const files = [];

  // 1. iOS Assets
  if (includeIos) {
    screenList.forEach((screen, idx) => {
      const num = String(idx + 1).padStart(2, "0");
      const headline = screen.headline || `${projName} Screen ${num}`;

      // 6.9-inch (iPhone 16 Pro Max: 1320x2868)
      files.push({
        name: `ios/6.9-inch/${num}_screen_1320x2868.png`,
        data: createPng(1320, 2868, { watermarked: isWatermarked, label: headline }),
      });

      // 6.7-inch (iPhone 15/14 Pro Max: 1290x2796)
      files.push({
        name: `ios/6.7-inch/${num}_screen_1290x2796.png`,
        data: createPng(1290, 2796, { watermarked: isWatermarked, label: headline }),
      });

      // 6.1-inch (iPhone 16/15 Pro: 1179x2556)
      files.push({
        name: `ios/6.1-inch/${num}_screen_1179x2556.png`,
        data: createPng(1179, 2556, { watermarked: isWatermarked, label: headline }),
      });
    });
  }

  // 2. Android Assets
  if (includeAndroid) {
    screenList.forEach((screen, idx) => {
      const num = String(idx + 1).padStart(2, "0");
      const headline = screen.headline || `${projName} Screen ${num}`;

      // Phone (1080x1920 Full HD)
      files.push({
        name: `android/phone/${num}_screen_1080x1920.png`,
        data: createPng(1080, 1920, { watermarked: isWatermarked, label: headline }),
      });

      // Tablet (1440x2560 WQXGA)
      files.push({
        name: `android/tablet/${num}_screen_1440x2560.png`,
        data: createPng(1440, 2560, { watermarked: isWatermarked, label: headline }),
      });
    });

    // Feature Graphic (Google Play requirement: 1024x500)
    files.push({
      name: "android/feature_graphic_1024x500.png",
      data: createPng(1024, 500, { watermarked: isWatermarked, label: `${projName} Feature Graphic` }),
    });
  }

  // 3. Store Copy Metadata
  if (includeCopy) {
    const listingJsonContent = JSON.stringify({
      projectId: projId,
      projectName: projName,
      watermarked: isWatermarked,
      exportedAt: new Date().toISOString(),
      fields: normalizedListing,
    }, null, 2);

    files.push({
      name: "copy/listing.json",
      data: listingJsonContent,
    });

    const listingTxtLines = [
      `AppCaptures Store Listing Copy`,
      `==============================`,
      `Project: ${projName}`,
      `Exported: ${new Date().toISOString()}`,
      `Watermarked: ${isWatermarked ? "YES (Free Tier)" : "NO (Paid Tier)"}`,
      ``,
      `Title (App Name):`,
      normalizedListing.title,
      ``,
      `Subtitle / Short Description:`,
      normalizedListing.subtitle,
      ``,
      `Keywords:`,
      normalizedListing.keywords,
      ``,
      `Promo Text:`,
      normalizedListing.promoText,
      ``,
      `Full Description:`,
      normalizedListing.description,
    ];

    if (isWatermarked) {
      listingTxtLines.push(
        ``,
        `Note: This export was generated on the AppCaptures Free Tier and includes watermarked assets. Upgrade to Pro at appcaptures.com to export unwatermarked assets.`
      );
    }

    files.push({
      name: "copy/listing.txt",
      data: listingTxtLines.join("\n"),
    });
  }

  // 4. Manifest
  const manifest = {
    projectId: projId,
    projectName: projName,
    exportedAt: new Date().toISOString(),
    watermarked: isWatermarked,
    store: storeNormalized,
    screensCount: screenList.length,
    files: files.map((f) => f.name),
  };

  files.push({
    name: "manifest.json",
    data: JSON.stringify(manifest, null, 2),
  });

  return zipSync(files);
}

export default {
  buildStoreZipBundle,
  createPng,
  zipSync,
  readZip,
  crc32,
};
