// B9 — the PS's "form filling". DEV 2 OWNS THIS FILE.
//
// After validation passes, every field that will appear on the form is shown back to the
// user in their own language, as printed on their documents. They confirm or correct each
// one before any PDF exists. The bot never submits.
//
// Correction protocol is numeric ("3 Patil") so it works identically in any language and
// needs no NLP — which also means a voice transcript can drive it (B10).

import { t } from './i18n/index.js';

/**
 * Fields that land on the form and are therefore correctable.
 * `latinPath` marks a field whose form value is the Roman-script variant: the user is
 * shown BOTH (printed, so they can check it against the paper in their hand; and Latin,
 * because that is what actually goes on the form). A correction overwrites both, since
 * a value the user typed is authoritative over any machine transliteration (ADR-8).
 */
export const REVIEW_FIELDS = [
  { id: 'name',    path: ['identity', 'full_name'],                 label: 'f_name',
    latinPath: ['identity', 'full_name_latin'] },
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
    const printed = readPath(profile, f.path);
    const roman = f.latinPath ? readPath(profile, f.latinPath) : null;

    // Show both only when they actually differ — otherwise it is noise.
    const shown = roman && roman !== printed
      ? `${printed ?? '—'} (${roman})`
      : (printed ?? roman ?? '—');

    return `${i + 1}. ${t(lang, f.label)}: ${shown}`;
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
/**
 * Whisper punctuates its transcripts, so a spoken "okay" arrives as "Okay." and a
 * dictated name as "Ramesh Patil." Trailing sentence punctuation must be removed before
 * anything is compared or stored — otherwise confirmation silently fails and a full stop
 * ends up on a government form.
 * Devanagari danda (।) included; voice notes in Marathi transcribe with it.
 */
function stripTrailingPunctuation(s) {
  return String(s).replace(/[.!?।॥,;:\s]+$/u, '').trim();
}

export function applyReviewReply(profile, raw) {
  const text = String(raw || '').trim();
  if (!text) return { action: 'unparsed' };

  const bare = stripTrailingPunctuation(text).toLowerCase();
  if (CONFIRM_WORDS.includes(bare)) return { action: 'confirm' };

  // "3 Ramesh Shankar Patil"  ->  set field 3
  const m = text.match(/^(\d+)[.)\s:-]+(.+)$/s);
  if (!m) return { action: 'unparsed' };

  const index = Number(m[1]) - 1;
  const value = stripTrailingPunctuation(m[2]);
  const field = REVIEW_FIELDS[index];
  if (!field || !value) return { action: 'unparsed' };

  writePath(profile, field.path, value);
  // A value the user typed outranks any machine transliteration, so it becomes the
  // form value too. Otherwise they could "fix" a name and still submit the old spelling.
  if (field.latinPath) writePath(profile, field.latinPath, value);

  return { action: 'corrected', field, value };
}
