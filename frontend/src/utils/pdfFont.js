/**
 * pdfFont.js — Embeds a Unicode-capable font (Roboto) into jsPDF so that the
 * Indian Rupee glyph (₹, U+20B9) and other non-Latin1 characters render
 * natively in generated PDFs. jsPDF's built-in helvetica/times/courier fonts
 * use WinAnsi encoding which does NOT include ₹.
 *
 * Strategy: fetch Roboto-Regular & Roboto-Bold TTF from jsDelivr's google/fonts
 * mirror, base64-encode, register via addFileToVFS + addFont. Cached at module
 * level so it's a one-time cost per page session.
 */

const FONT_URLS = {
  regular: 'https://cdn.jsdelivr.net/gh/googlefonts/roboto-2@main/src/hinted/Roboto-Regular.ttf',
  bold: 'https://cdn.jsdelivr.net/gh/googlefonts/roboto-2@main/src/hinted/Roboto-Bold.ttf'
};

export const PDF_UNICODE_FONT = 'Roboto';

let cachedFonts = null;
let inflight = null;

async function fetchAsBase64(url) {
  const resp = await fetch(url, { mode: 'cors' });
  if (!resp.ok) throw new Error(`Font fetch failed (${resp.status}): ${url}`);
  const buf = await resp.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // Chunked to avoid call-stack blowup on large buffers
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function fetchAllFonts() {
  if (cachedFonts) return cachedFonts;
  if (inflight) return inflight;
  inflight = (async () => {
    const [regular, bold] = await Promise.all([
      fetchAsBase64(FONT_URLS.regular),
      fetchAsBase64(FONT_URLS.bold)
    ]);
    cachedFonts = { regular, bold };
    return cachedFonts;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/**
 * Register Roboto Regular + Bold on the given jsPDF document and set Roboto
 * as the active font. Falls back to helvetica (built-in) if the network
 * fetch fails — this guarantees PDF generation never breaks offline.
 *
 * @param {jsPDF} doc
 * @returns {Promise<string>} the font family name to use ('Roboto' on success, 'helvetica' on fallback)
 */
export async function loadUnicodeFont(doc) {
  try {
    const fonts = await fetchAllFonts();
    doc.addFileToVFS('Roboto-Regular.ttf', fonts.regular);
    doc.addFont('Roboto-Regular.ttf', PDF_UNICODE_FONT, 'normal');
    doc.addFileToVFS('Roboto-Bold.ttf', fonts.bold);
    doc.addFont('Roboto-Bold.ttf', PDF_UNICODE_FONT, 'bold');
    doc.setFont(PDF_UNICODE_FONT, 'normal');
    return PDF_UNICODE_FONT;
  } catch (e) {
    // Network failed (offline, blocked CDN). Use built-in helvetica so the
    // PDF still generates — currency just falls back to plain digits.
    // eslint-disable-next-line no-console
    console.warn('Unicode font load failed, falling back to helvetica:', e?.message || e);
    doc.setFont('helvetica', 'normal');
    return 'helvetica';
  }
}

// ═══════════ Tamil support (Iter 46 Change 3) ═══════════
// Roboto has no Tamil glyphs — a `language === 'ta'` Terms & Conditions
// template rendered with it shows blank boxes. Noto Sans Tamil is loaded
// on-demand, only when a terms template actually needs it.
const TAMIL_FONT_URLS = {
  regular: 'https://cdn.jsdelivr.net/gh/openmaptiles/fonts@master/noto-sans/NotoSansTamil-Regular.ttf',
  bold: 'https://cdn.jsdelivr.net/gh/openmaptiles/fonts@master/noto-sans/NotoSansTamil-Bold.ttf'
};
export const PDF_TAMIL_FONT = 'NotoTamil';

let cachedTamilFonts = null;
let tamilInflight = null;

async function fetchAllTamilFonts() {
  if (cachedTamilFonts) return cachedTamilFonts;
  if (tamilInflight) return tamilInflight;
  tamilInflight = (async () => {
    const [regular, bold] = await Promise.all([
      fetchAsBase64(TAMIL_FONT_URLS.regular),
      fetchAsBase64(TAMIL_FONT_URLS.bold)
    ]);
    cachedTamilFonts = { regular, bold };
    return cachedTamilFonts;
  })();
  try {
    return await tamilInflight;
  } finally {
    tamilInflight = null;
  }
}

/** Detect Tamil-script characters (U+0B80–U+0BFF) in a string. */
export function isTamilText(str) {
  return /[\u0B80-\u0BFF]/.test(str || '');
}

/** Register Noto Sans Tamil on the given doc. Returns the font name, or null on failure. */
export async function loadTamilFont(doc) {
  try {
    const fonts = await fetchAllTamilFonts();
    doc.addFileToVFS('NotoSansTamil-Regular.ttf', fonts.regular);
    doc.addFont('NotoSansTamil-Regular.ttf', PDF_TAMIL_FONT, 'normal');
    doc.addFileToVFS('NotoSansTamil-Bold.ttf', fonts.bold);
    doc.addFont('NotoSansTamil-Bold.ttf', PDF_TAMIL_FONT, 'bold');
    return PDF_TAMIL_FONT;
  } catch (e) {
    console.warn('Tamil font load failed, falling back:', e?.message || e);
    return null;
  }
}

/**
 * Pick the right font to render a Terms & Conditions block: switches to
 * Noto Sans Tamil when the template's language is 'ta' (or its content
 * contains Tamil glyphs), otherwise keeps the document's existing font.
 * @param {jsPDF} doc
 * @param {{language?: string, content?: string}} terms
 * @param {string} fallbackFont
 */
export async function loadTermsFont(doc, terms, fallbackFont) {
  if (terms && (terms.language === 'ta' || isTamilText(terms.content))) {
    const tamil = await loadTamilFont(doc);
    if (tamil) return tamil;
  }
  return fallbackFont;
}
