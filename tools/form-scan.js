// Form onboarding scanner: reads a saved portal page (Ctrl+S, HTML only) and drafts a mapping.
// Never emits value= attributes or typed text (saved pages hold personal data).
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const file = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!file) {
  console.error('Usage: node tools/form-scan.js <saved-page.html> [--out <dir>] [--name "<form name>"] [--url-pattern "<path fragment>"]');
  process.exit(1);
}
const html = fs.readFileSync(file, 'utf8');
const outDir = opt('--out') || 'forms/drafts';
const name = opt('--name') || path.basename(file).replace(/\.[^.]+$/, '');
const urlPattern = opt('--url-pattern') || '';
const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'form';

const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
const clean = (s) => decode(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const attrs = (tag) => {
  const a = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-\w:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    const k = m[1].toLowerCase();
    if (k === 'value') continue; // never read values
    a[k] = m[2] ?? m[3] ?? m[4] ?? true;
  }
  return a;
};

// Strip scripts/styles/comments so their contents are not scanned.
const src = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');

// Labels: for= map, plus ordered list with position for "nearest preceding".
const labels = [];
for (const m of src.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/gi)) {
  labels.push({ pos: m.index, end: m.index + m[0].length, forId: attrs(m[1]).for, text: clean(m[2]) });
}

const fields = [];
const re = /<(input|select|textarea)\b([^>]*)>/gi;
let m;
while ((m = re.exec(src))) {
  const tag = m[1].toLowerCase();
  const a = attrs(m[2]);
  const type = tag === 'input' ? String(a.type || 'text').toLowerCase() : tag;
  if (tag === 'input' && ['hidden', 'submit', 'button', 'image'].includes(type)) continue;
  let options = [], optCount = 0;
  if (tag === 'select') {
    const close = src.indexOf('</select', re.lastIndex);
    const body = src.slice(re.lastIndex, close < 0 ? undefined : close);
    const texts = [...body.matchAll(/<option\b[^>]*>([\s\S]*?)(?=<option\b|$)/gi)].map((o) => clean(o[1]));
    optCount = texts.length;
    options = texts.slice(0, 6);
  }
  let label = '';
  const byFor = a.id && labels.find((l) => l.forId === a.id);
  if (byFor) label = byFor.text;
  else {
    const prev = labels.filter((l) => l.end <= m.index).pop();
    if (prev) label = prev.text;
  }
  fields.push({
    id: a.id || '', name: a.name || '', tag, type, label,
    readonly: !!(a.readonly || a.disabled), optCount, options,
  });
}

const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
console.log(['#', 'tag/type', 'id', 'label', 'notes'].join(' | '));
fields.forEach((f, i) => {
  const notes = [];
  if (f.readonly) notes.push('RO');
  if (f.tag === 'select') notes.push(`${f.optCount} options: ${f.options.join(', ')}`);
  console.log([i + 1, f.tag === 'input' ? `input/${f.type}` : f.tag, f.id || `(name=${f.name})`, cut(f.label, 50), notes.join('; ')].join(' | '));
});

const draft = {
  name, urlPattern, keywordFallback: false, fields: {}, selectChains: [], operator: [], hints: {}, verify: [],
  _draft: true,
  _fields: fields.map((f) => ({ id: f.id, tag: f.tag, type: f.type, label: f.label, readonly: f.readonly, options: f.options })),
};
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${slug}.json`);
fs.writeFileSync(outFile, JSON.stringify(draft, null, 2) + '\n');
console.log(`\n${fields.length} fields. Draft written to ${outFile}`);
console.log('Move the finished mapping into forms/ only after urlPattern and fields are filled in. A draft in forms/ with an empty urlPattern would match every page.');
