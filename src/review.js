// B9 — the PS's "form filling". DEV 2 OWNS THIS FILE.
//
// After validation passes, every field that will appear on the form is shown back to the
// user in their own language, as printed on their documents. They confirm or correct each
// one before any PDF exists. The bot never submits.
//
// Correction protocol is numeric ("3 Patil") so it works identically in any language and
// needs no NLP — which also means a voice transcript can drive it (B10).

import { t } from './i18n/index.js';

/** Fields that land on the form and are therefore correctable. */
export const REVIEW_FIELDS = [
  { id: 'name',    path: ['identity', 'full_name'],                 label: 'f_name' },
  { id: 'dob',     path: ['identity', 'date_of_birth'],             label: 'f_dob' },
  { id: 'address', path: ['identity', 'address'],                   label: 'f_address' },
  { id: 'income',  path: ['income', 'certified_annual_income'],     label: 'f_income' },
  { id: 'survey',  path: ['land', 'survey_number'],                 label: 'f_survey' },
  { id: 'purpose', path: ['purpose'],                               label: 'f_purpose' },
];

function readPath(profile, path) {
  return path.reduce((o, k) => (o == null ? undefined : o[k]), profile);
}

function writePath(profile, path, value) {
  const last = path[path.length - 1];
  const parent = path.slice(0, -1).reduce((o, k) => (o[k] ??= {}), profile);
  parent[last] = value;
}

/**
 * Numbered summary of everything going on the form.
 * Values are shown exactly as printed on the documents (ADR-8) so the user can
 * compare against the paper in their hand.
 */
export function buildReviewSummary(profile, lang) {
  const lines = REVIEW_FIELDS.map((f, i) => {
    const value = readPath(profile, f.path);
    return `${i + 1}. ${t(lang, f.label)}: ${value ?? '—'}`;
  });

  return [
    t(lang, 'review_header'),
    '',
    ...lines,
    '',
    t(lang, 'review_hint'),
  ].join('\n');
}

const CONFIRM_WORDS = [
  'yes', 'ok', 'okay', 'correct', 'right', 'confirm', 'y',
  'हो', 'होय', 'बरोबर', 'ठीक', 'हाँ', 'सही',
];

/**
 * Interpret a reply during the REVIEW stage.
 * @returns {{action:'confirm'}
 *          |{action:'corrected', field:object, value:string}
 *          |{action:'unparsed'}}
 */
export function applyReviewReply(profile, raw) {
  const text = String(raw || '').trim();
  if (!text) return { action: 'unparsed' };

  if (CONFIRM_WORDS.includes(text.toLowerCase())) return { action: 'confirm' };

  // "3 Ramesh Shankar Patil"  ->  set field 3
  const m = text.match(/^(\d+)[.)\s:-]+(.+)$/s);
  if (!m) return { action: 'unparsed' };

  const index = Number(m[1]) - 1;
  const value = m[2].trim();
  const field = REVIEW_FIELDS[index];
  if (!field || !value) return { action: 'unparsed' };

  writePath(profile, field.path, value);
  return { action: 'corrected', field, value };
}
