// D8: curated mappings first, keyword matching as fallback.
// Deterministic throughout - no model is involved in deciding what goes in a field.
// Same principle as the rulebook: this must behave identically every time.

import fs from 'node:fs';
import path from 'node:path';

/** Read a value out of the profile by dotted path, e.g. "identity.full_name_latin". */
function read(profile, dotted) {
  return dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), profile);
}

/** Curated per-form mappings live in forms/*.json and win over keyword matching. */
function loadForms() {
  const dir = path.join(process.cwd(), 'forms');
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  } catch {
    return [];
  }
}

/** Phase 10: urlPattern may be a string or an array of strings. */
export function findCurated(url) {
  return loadForms().find((f) => url && [].concat(f.urlPattern || []).some((p) => url.includes(p)));
}

/**
 * Phase 10: optional transform after "|" in a curated path.
 *   devanagari - keep only if the value is Devanagari (Marathi fields must hold Marathi)
 *   dmy        - YYYY-MM-DD -> DD/MM/YYYY; anything else -> null
 */
function readCurated(profile, spec) {
  const [dotted, transform] = String(spec).split('|');
  const v = read(profile, dotted);
  if (v == null || v === 'NULL' || v === '') return null;
  const s = String(v);
  if (transform === 'devanagari') return /^[ऀ-ॿ\s.]+$/.test(s) ? s : null;
  if (transform === 'dmy') {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
  }
  return s;
}

const GENDER_TEXT = {
  MALE: ['M', 'Male', 'पुरुष'],
  FEMALE: ['F', 'Female', 'स्त्री', 'महिला'],
  OTHER: ['T', 'Other', 'इतर', 'तृतीयपंथी'],
};

/**
 * Keyword table. Order matters: the FIRST entry whose keyword appears in the field's
 * text wins, so put more specific keywords above more general ones.
 * Values are dotted profile paths, or a function for derived values.
 */
const KEYWORDS = [
  { words: ['जन्म', 'dob', 'birth', 'janma'],            path: 'identity.date_of_birth' },
  { words: ['मोबाईल', 'मोबाइल', 'mobile', 'phone'],       path: null },
  { words: ['पिन', 'pincode', 'pin code', 'pin'],         path: 'identity.pin_code' },
  { words: ['तहसील', 'तालुका', 'taluka', 'tehsil'],        derive: 'taluka' },
  { words: ['जिल्हा', 'जिला', 'district', 'dist'],          derive: 'district' },
  { words: ['गाव', 'गाँव', 'village'],                     path: 'land.village_name' },
  { words: ['सर्व्हे', 'सर्वे', 'गट', 'survey', 'gat'],      path: 'land.survey_number' },
  { words: ['क्षेत्र', 'area', 'hectare'],                  path: 'land.total_area_hectares' },
  { words: ['उत्पन्न', 'आय', 'income', 'salary'],          path: 'income.certified_annual_income' },
  { words: ['पत्ता', 'पता', 'address', 'rahanar'],         path: 'identity.address' },
  { words: ['कारण', 'उद्देश', 'purpose', 'reason'],        path: 'purpose' },
  { words: ['नाव', 'नाम', 'name', 'applicant'],           path: 'identity.full_name_latin' },
  { words: ['दिनांक', 'दिनाक', 'date', 'tarikh'], derive: 'today' },
];

/** "Kandhar, Nanded" -> { taluka: "Kandhar", district: "Nanded" } */
function splitTalukaDistrict(profile) {
  const raw = String(read(profile, 'land.taluka_and_district') || '');
  const [taluka, district] = raw.split(/[,/]/).map((s) => s.trim());
  return {
    taluka: taluka || '',
    district: district || '',
    today: new Date().toISOString().slice(0, 10),
  };
}

function fieldText(field) {
  return [field.label, field.name, field.id, field.placeholder]
    .filter(Boolean).join(' ').toLowerCase();
}

/**
 * @returns {Object<string,string>} ref -> value, omitting anything with no match
 *   or no data. A field we cannot fill is left alone, never filled with a guess.
 */
export function matchFields({ profile, url, fields }) {
  const values = {};
  const derived = splitTalukaDistrict(profile);

  const curated = findCurated(url);

  for (const field of fields) {
    // 1. Curated mapping for this form, keyed by the field's id or name.
    if (curated) {
      // Phase 10: operator fields are never filled from documents.
      if ((curated.operator || []).includes(`#${field.id}`)) continue;
      const dotted = curated.fields?.[`#${field.id}`] ?? curated.fields?.[field.name];
      if (dotted) {
        const v = readCurated(profile, dotted);
        if (v != null) { values[field.ref] = v; continue; }
      }
      // Phase 10: on a curated page, keyword guessing can put data in the wrong field.
      if (curated.keywordFallback === false) continue;
    }

    // 2. Keyword fallback.
    const text = fieldText(field);
    if (!text) continue;

    const hit = KEYWORDS.find((k) => k.words.some((w) => text.includes(w)));
    if (!hit) continue;

    const value = hit.derive ? derived[hit.derive] : (hit.path ? read(profile, hit.path) : null);
    if (value != null && value !== 'NULL' && value !== '') values[field.ref] = String(value);
  }

  return values;
}

/**
 * Phase 9/10: refs of form fields the operator must type. The extension leaves these empty
 * and outlines them amber. Two sources:
 *   - the curated form's "operator" list (always), and
 *   - fields mapped to land.<k> where k is in profile.land.needs_operator.
 */
export function operatorRefs({ profile, url, fields }) {
  const pending = new Set((profile?.land?.needs_operator || []).map((k) => `land.${k}`));
  const curated = findCurated(url);
  const always = new Set(curated?.operator || []);
  const refs = [];

  for (const field of fields) {
    if (always.has(`#${field.id}`)) { refs.push(field.ref); continue; }
    if (!pending.size) continue;
    let dotted = curated ? (curated.fields?.[`#${field.id}`] ?? curated.fields?.[field.name]) : undefined;
    if (dotted) dotted = String(dotted).split('|')[0];
    if (!dotted && !(curated && curated.keywordFallback === false)) {
      const text = fieldText(field);
      const hit = text ? KEYWORDS.find((k) => k.words.some((w) => text.includes(w))) : null;
      dotted = hit ? hit.path : null;
    }
    if (dotted && pending.has(dotted)) refs.push(field.ref);
  }
  return refs;
}

/**
 * Phase 10: dropdown chains for the curated form. The extension picks each option by its
 * visible text (extension/pick.js), in order, waiting for dependent lists to load.
 * @returns {Array<Array<{id, mode, candidates?, source?}>>}
 */
export function selectChains({ profile, url }) {
  const curated = findCurated(url);
  if (!curated || !Array.isArray(curated.selectChains)) return [];
  return curated.selectChains.map((chain) => chain.map(({ id, path: p, mode }) => {
    const v = read(profile, p);
    if (mode === 'gender') {
      return { id, mode: 'oneOf', candidates: GENDER_TEXT[String(v || '').toUpperCase()] || [] };
    }
    return { id, mode: 'within', source: v == null || v === 'NULL' ? '' : String(v) };
  }));
}

/** Phase 10: check figures shown as placeholders in operator fields. ref -> value. */
export function hintRefs({ profile, url, fields }) {
  const curated = findCurated(url);
  if (!curated?.hints) return {};
  const out = {};
  for (const field of fields) {
    const p = curated.hints[`#${field.id}`];
    if (!p) continue;
    const v = read(profile, p);
    if (v != null && v !== 'NULL' && v !== '') out[field.ref] = String(v);
  }
  return out;
}

/**
 * Phase 14 (ADR-8): refs of filled fields whose value may be a machine transliteration rather
 * than text printed on the document. The extension fills them but outlines them dashed amber
 * with a "check against the document" hint.
 *   curated.verify       - always flagged
 *   curated.verifyUnless - flagged unless the given profile path is exactly true
 */
export function verifyRefs({ profile, url, fields }) {
  const curated = findCurated(url);
  if (!curated) return [];
  const always = new Set(curated.verify || []);
  const unless = curated.verifyUnless || {};
  const refs = [];
  for (const field of fields) {
    const key = `#${field.id}`;
    if (always.has(key)) { refs.push(field.ref); continue; }
    if (unless[key] && read(profile, unless[key]) !== true) refs.push(field.ref);
  }
  return refs;
}
