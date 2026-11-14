// D3/D4: enrolment is a watched directory, not an upload UI.
// Document type comes from the folder name, so no classification step is needed.
// Extraction is cached beside the source file, so selecting a client is instant.

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { extractDocument } from './extractor.js';

export const MASTER = process.env.MASTER_DIR || path.join(process.cwd(), 'MASTER');

/** Exact folder names are a contract with the operator. Do not normalise. */
export const FOLDERS = {
  'ADHAAR': 'identity',
  'INCOME CERTIFICATE': 'income',
  'LAND RECORDS': 'land',
};

export const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

export async function ensureFolders() {
  for (const folder of Object.keys(FOLDERS)) {
    await fs.mkdir(path.join(MASTER, folder), { recursive: true });
  }
}

async function listSources(folder) {
  const dir = path.join(MASTER, folder);
  let entries = [];
  try { entries = await fs.readdir(dir); } catch { return []; }
  return entries
    .filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()))
    .map((f) => ({ file: f, key: path.basename(f, path.extname(f)), dir }));
}

/** Cached extraction. Returns null if extraction has not happened yet. */
async function readCache(dir, key) {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, `${key}.json`), 'utf8'));
  } catch {
    return null;
  }
}

/** Extract one source file and cache the result. Safe to call repeatedly. */
export async function extractAndCache(dir, file, key, docType) {
  const cached = await readCache(dir, key);
  if (cached) return cached;

  const buffer = await fs.readFile(path.join(dir, file));
  const data = await extractDocument(buffer, docType);
  await fs.writeFile(path.join(dir, `${key}.json`), JSON.stringify(data, null, 2), 'utf8');
  return data;
}

/** All known clients and which of their three documents are extracted. */
export async function listClients() {
  const clients = new Map();

  for (const [folder, docType] of Object.entries(FOLDERS)) {
    for (const { file, key, dir } of await listSources(folder)) {
      if (!clients.has(key)) {
        clients.set(key, { name: key, documents: { identity: false, income: false, land: false } });
      }
      clients.get(key).documents[docType] = Boolean(await readCache(dir, key));
    }
  }

  return [...clients.values()].map((c) => ({
    ...c,
    ready: c.documents.identity && c.documents.income && c.documents.land,
  }));
}

/** The canonical profile for one client, built from cached extractions. */
export async function getProfile(key) {
  const profile = { identity: null, income: null, land: null, purpose: null };

  for (const [folder, docType] of Object.entries(FOLDERS)) {
    const dir = path.join(MASTER, folder);
    profile[docType] = await readCache(dir, key);
  }

  let overrides = {};
  try { overrides = JSON.parse(await fs.readFile(overridesFile(key), 'utf8')) || {}; } catch { overrides = {}; }
  for (const [dotted, value] of Object.entries(overrides)) {
    const [doc, field] = dotted.split('.');
    if (profile[doc] && typeof profile[doc] === 'object') {
      profile[doc] = { ...profile[doc], [field]: value };
      if (Array.isArray(profile[doc].needs_operator)) {
        profile[doc].needs_operator = profile[doc].needs_operator.filter((f) => f !== field);
      }
    }
  }
  return profile;
}

/**
 * Extract anything not yet cached. Called once at startup so the demo never waits.
 * Failures are logged and skipped: one unreadable file must not stop the rest.
 */
export async function warmAll() {
  await ensureFolders();
  let done = 0, failed = 0;

  for (const [folder, docType] of Object.entries(FOLDERS)) {
    for (const { file, key, dir } of await listSources(folder)) {
      try {
        const before = await readCache(dir, key);
        await extractAndCache(dir, file, key, docType);
        if (!before) done++;
      } catch (err) {
        failed++;
        console.error(`[clients] ${folder}/${file}: ${err.message}`);
      }
    }
  }
  if (done || failed) console.log(`[clients] extracted ${done}, failed ${failed}`);
}

/**
 * Phase 14 (D3, PS "automated"): watch MASTER/ so a document dropped into a folder is read
 * without a restart. Debounced; never two scans at once. Only image files trigger a scan,
 * so writing a .json cache does not trigger another.
 */
export function watchMaster() {
  let timer = null;
  let running = false;
  let again = false;
  const scan = async () => {
    if (running) { again = true; return; }
    running = true;
    try { await warmAll(); } catch (e) { console.error('[watch]', e.message); }
    running = false;
    if (again) { again = false; scan(); }
  };
  try {
    fsSync.watch(MASTER, { recursive: true }, (_event, file) => {
      if (!file || !IMAGE_EXT.has(path.extname(String(file)).toLowerCase())) return;
      clearTimeout(timer);
      timer = setTimeout(scan, 1500);
    });
    console.log(`[clients] watching ${MASTER}`);
  } catch (e) {
    console.error('[clients] watch unavailable:', e.message);
  }
}

const OVERRIDE_PATHS = ['land.survey_number', 'land.total_area_hectares', 'land.record_print_date'];

export function overridesFile(key) {
  return path.join(MASTER, `${key}.overrides.json`);
}

/** Operator-typed values for fields the model cannot read. Empty value clears the override. */
export async function setOverride(key, dotted, value) {
  if (!/^[\w .-]{1,80}$/.test(String(key))) throw new Error('bad client');
  if (!OVERRIDE_PATHS.includes(dotted)) throw new Error('path not allowed');
  value = String(value ?? '').trim().slice(0, 100);
  let obj = {};
  try { obj = JSON.parse(await fs.readFile(overridesFile(key), 'utf8')) || {}; } catch { obj = {}; }
  if (value === '') delete obj[dotted]; else obj[dotted] = value;
  await fs.mkdir(MASTER, { recursive: true });
  await fs.writeFile(overridesFile(key), JSON.stringify(obj, null, 2), 'utf8');
}
