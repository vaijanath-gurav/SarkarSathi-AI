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

  const curated = loadForms().find((f) => url && f.urlPattern && url.includes(f.urlPattern));

  for (const field of fields) {
    // 1. Curated mapping for this form, keyed by the field's id or name.
    if (curated) {
      const dotted = curated.fields?.[`#${field.id}`] ?? curated.fields?.[field.name];
      if (dotted) {
        const v = read(profile, dotted);
        if (v != null && v !== 'NULL' && v !== '') { values[field.ref] = String(v); continue; }
      }
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
