// D3/D4: enrolment is a watched directory, not an upload UI.
// Document type comes from the folder name, so no classification step is needed.
// Extraction is cached beside the source file, so selecting a client is instant.

import fs from 'node:fs/promises';
import path from 'node:path';
import { extractDocument } from './extractor.js';

const MASTER = process.env.MASTER_DIR || path.join(process.cwd(), 'MASTER');

/** Exact folder names are a contract with the operator. Do not normalise. */
export const FOLDERS = {
  'ADHAAR': 'identity',
  'INCOME CERTIFICATE': 'income',
  'LAND RECORDS': 'land',
};

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

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
