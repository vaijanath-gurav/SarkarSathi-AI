// API keys and per-key daily usage counters (demo revenue layer). Files live in KEYS_DIR
// (default ./keys): keys.json = { key: { name, created } }, usage.json = { key: { date: { type: n } } }.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Rates (rupees per event) agreed for the demo. One fill already triggers a validation,
// so validations are not charged separately. Every other usage type is included at 0.
export const RATES = { document: 2, fill: 10 };

const dirOf =() => path.resolve(process.env.KEYS_DIR || path.join(process.cwd(), 'keys'));
const states = new Map(); // dir -> { usage, queue, keys, keysAt }

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}
function state() {
  const dir = dirOf();
  let s = states.get(dir);
  if (!s) {
    fs.mkdirSync(dir, { recursive: true });
    s = { usage: readJson(path.join(dir, 'usage.json')), queue: Promise.resolve(), keys: null, keysAt: 0 };
    states.set(dir, s);
  }
  return { dir, s };
}

export function createKey(name) {
  const { dir, s } = state();
  const keys = readJson(path.join(dir, 'keys.json'));
  const key = 'csc_' + crypto.randomBytes(16).toString('hex');
  keys[key] = { name: String(name), created: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, 'keys.json'), JSON.stringify(keys, null, 2));
  s.keys = null; // force a reload on the next lookup
  return key;
}

/** Record for a key, or null. keys.json is re-read at most once per second. */
export function lookupKey(key) {
  const { dir, s } = state();
  if (!s.keys || Date.now() - s.keysAt > 1000) {
    s.keys = readJson(path.join(dir, 'keys.json'));
    s.keysAt = Date.now();
  }
  return typeof key === 'string' && Object.hasOwn(s.keys, key) ? s.keys[key] : null;
}

const today = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** Increment a counter and flush usage.json; writes are serialised through a queue. */
export function count(key, type) {
  const { dir, s } = state();
  const day = (s.usage[key] ||= {});
  const counts = (day[today()] ||= {});
  counts[type] = (counts[type] || 0) + 1;
  const snapshot = JSON.stringify(s.usage, null, 2);
  s.queue = s.queue
    .then(() => fs.promises.writeFile(path.join(dir, 'usage.json'), snapshot))
    .catch((e) => console.error('[keys/usage]', e));
  return s.queue;
}

/** Every key and date, newest date first. */
export function usage() {
  const { dir, s } = state();
  const keys = readJson(path.join(dir, 'keys.json'));
  const rows = [];
  for (const [key, days] of Object.entries(s.usage)) {
    for (const [date, counts] of Object.entries(days)) {
      rows.push({ key, name: keys[key]?.name || '(unknown)', date, counts: { ...counts }, total: Object.values(counts).reduce((a, b) => a + b, 0) });
    }
  }
  return rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.name.localeCompare(b.name)));
}

/** One key's own counts: today and the current local month, by type. */
export function myUsage(key) {
  const { dir, s } = state();
  const keys = readJson(path.join(dir, 'keys.json'));
  const day = today();
  const month = day.slice(0, 7);
  const out = { name: keys[key]?.name || '', today: {}, todayTotal: 0, month: {}, monthTotal: 0, todayAmount: 0, monthAmount: 0, rates: RATES };
  for (const [date, counts] of Object.entries(s.usage[key] || {})) {
    for (const [type, n] of Object.entries(counts)) {
      const amt = n * (RATES[type] || 0);
      if (date === day) { out.today[type] = (out.today[type] || 0) + n; out.todayTotal += n; out.todayAmount += amt; }
      if (date.startsWith(month)) { out.month[type] = (out.month[type] || 0) + n; out.monthTotal += n; out.monthAmount += amt; }
    }
  }
  return out;
}
