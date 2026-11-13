// Phase 14 (R3, R6, R1): PDF work with pdf.js, in an offscreen document so the pdf.js worker
// and <canvas> run at the extension's own origin on any portal page.
import * as pdfjsLib from './vendor/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdf.worker.min.mjs');

const fromB64 = (b64) => Uint8Array.from(atob(String(b64).replace(/^data:[^,]+,/, '')), (c) => c.charCodeAt(0));
const toB64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); };
const open = (b64) => pdfjsLib.getDocument({ data: fromB64(b64) }).promise;

async function renderPage(pdf, n, scale, type, quality) {
  const page = await pdf.getPage(n);
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = Math.ceil(vp.width);
  c.height = Math.ceil(vp.height);
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  return c.toDataURL(type, quality);
}

const OPS = {
  /** PDF -> plain text, pages separated by a blank line. */
  async text({ b64 }) {
    const pdf = await open(b64);
    const out = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const tc = await (await pdf.getPage(i)).getTextContent();
      out.push(tc.items.map((x) => x.str).join(' '));
    }
    return { text: out.join('\n\n') };
  },
  /** PDF -> one image data URL per page (type image/png or image/jpeg). */
  async images({ b64, type, maxPages }) {
    const pdf = await open(b64);
    const n = Math.min(pdf.numPages, maxPages || pdf.numPages);
    const pages = [];
    for (let i = 1; i <= n; i++) pages.push(await renderPage(pdf, i, 2, type, 0.92));
    return { pages };
  },
  /**
   * Text -> PDF (R3, "pdf to text and vice versa"). Drawn on a canvas so Devanagari renders with
   * the system font (pdf-lib's standard fonts cannot encode it), then assembled as A4 pages.
   */
  async textToPdf({ text }) {
    const { PDFDocument } = window.PDFLib;
    const W = 1240, H = 1754, M = 100, LH = 34;          // A4 at 150 dpi
    const font = '22px "Nirmala UI", "Noto Sans Devanagari", sans-serif';
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.font = font;
    const lines = [];
    for (const para of String(text).replace(/\r/g, '').split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        const tryLine = line ? `${line} ${word}` : word;
        if (g.measureText(tryLine).width > W - 2 * M && line) { lines.push(line); line = word; }
        else line = tryLine;
      }
      lines.push(line);
    }
    const perPage = Math.floor((H - 2 * M) / LH);
    const doc = await PDFDocument.create();
    for (let start = 0; start < Math.max(lines.length, 1); start += perPage) {
      g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#000'; g.font = font; g.textBaseline = 'top';
      lines.slice(start, start + perPage).forEach((l, i) => g.fillText(l, M, M + i * LH));
      const img = await doc.embedJpg(fromB64(c.toDataURL('image/jpeg', 0.92)));
      const p = doc.addPage([595.28, 841.89]);
      p.drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
    }
    return { pdf: toB64(await doc.save()) };
  },
  /** PDF -> smaller PDF: pages re-rendered as JPEG, stepping scale and quality down to the budget. */
  async compress({ b64, budgetKB }) {
    const pdf = await open(b64);
    const { PDFDocument } = window.PDFLib;
    const steps = [[1.5, 0.8], [1.2, 0.7], [1.0, 0.6], [0.8, 0.5], [0.6, 0.4]];
    for (let s = 0; s < steps.length; s++) {
      const [scale, q] = steps[s];
      const doc = await PDFDocument.create();
      for (let i = 1; i <= pdf.numPages; i++) {
        const img = await doc.embedJpg(fromB64(await renderPage(pdf, i, scale, 'image/jpeg', q)));
        const p = doc.addPage([img.width, img.height]);
        p.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      }
      const bytes = await doc.save();
      if (bytes.length <= budgetKB * 1024 || s === steps.length - 1) {
        return { pdf: toB64(bytes), kb: Math.round(bytes.length / 1024) };
      }
    }
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'PDF_OFFSCREEN' || !OPS[msg.op]) return false;
  (async () => {
    try { sendResponse({ ok: true, ...(await OPS[msg.op](msg.args || {})) }); }
    catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
  })();
  return true;
});
