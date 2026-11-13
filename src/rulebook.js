// DEV 4 OWNS THIS FILE.
// Pure functions. No AI, no network. Testable right now with `npm run test:rules`.
// This is the heart of the demo: PS 19's "automated pre-submission validation".

const EWS_INCOME_CEILING = 800000;      // ₹8 lakh/yr
const INCOME_CERT_MAX_AGE_MONTHS = 12;
const LAND_RECORD_MAX_AGE_MONTHS = 6;

const HONORIFICS = /\b(shri|smt|mr|mrs|ms|kum|dr|late)\b\.?/gi;

/** Case-fold, strip honorifics, collapse whitespace and punctuation. */
export function normaliseName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(HONORIFICS, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

function similarity(p, q) {
  if (p === q) return 1;
  if (!p.length || !q.length) return 0;
  return 1 - levenshtein(p, q) / Math.max(p.length, q.length);
}

/**
 * Exact equality fails on transliteration variance between documents and makes a
 * correct demo look broken. But whole-string similarity is too forgiving the other
 * way: "Ramesh Shankar Patil" vs "Ramesh Shankar Pawar" scores 0.86 because the
 * first two names carry it, and a genuine surname mismatch slips through.
 *
 * So compare token by token, and require the given name AND the surname to match.
 * A missing middle name is tolerated; a different surname is not.
 */
export function namesMatch(a, b, threshold = 0.75) {
  const x = normaliseName(a).split(' ').filter(Boolean);
  const y = normaliseName(b).split(' ').filter(Boolean);
  if (!x.length || !y.length) return false;

  if (similarity(x[0], y[0]) < threshold) return false;
  if (similarity(x[x.length - 1], y[y.length - 1]) < threshold) return false;
  return true;
}

export function monthsSince(dateStr, now = new Date()) {
  if (!dateStr || dateStr === 'NULL') return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return (now.getFullYear() - d.getFullYear()) * 12
    + (now.getMonth() - d.getMonth())
    - (now.getDate() < d.getDate() ? 1 : 0);
}

/**
 * @param {{identity?:object, income?:object, land?:object, purpose?:string}} profile
 * @returns {{ok:boolean, errors:Array, missing:Array}}
 *   errors  -> validation failures (messageKey + params for i18n)
 *   missing -> documents or fields not supplied yet
 */
export function validateEWS(profile, now = new Date()) {
  const errors = [];
  const missing = [];
  const { identity, income, land } = profile;

  if (!identity) missing.push('identity');
  if (!income) missing.push('income');
  if (!land) missing.push('land');
  if (missing.length) return { ok: false, errors, missing };

  // --- quality gate first: no point validating an unreadable scan ---
  if (identity.image_quality_flag === true) {
    errors.push({ key: 'blurry_retry', params: {} });
    return { ok: false, errors, missing };
  }

  // --- cross-document name match (the money shot on stage) ---
  const owners = Array.isArray(land.owner_names) ? land.owner_names : [];
  if (!owners.some((o) => namesMatch(identity.full_name, o))) {
    errors.push({
      key: 'name_mismatch',
      params: { a: identity.full_name, b: owners[0] || '—' },
    });
  }

  // --- identity vs income certificate ---
  if (!namesMatch(identity.full_name, income.applicant_name)) {
    errors.push({
      key: 'income_name_mismatch',
      params: { a: identity.full_name, b: income.applicant_name },
    });
  }

  // --- recency ---
  const incomeAge = monthsSince(income.issue_date, now);
  if (incomeAge === null) {
    errors.push({ key: 'income_date_unreadable', params: {} });
  } else if (incomeAge > INCOME_CERT_MAX_AGE_MONTHS) {
    errors.push({ key: 'income_stale', params: { d: income.issue_date } });
  }

  const landAge = monthsSince(land.record_print_date, now);
  if (landAge !== null && landAge > LAND_RECORD_MAX_AGE_MONTHS) {
    errors.push({ key: 'land_stale', params: { d: land.record_print_date } });
  }

  // --- eligibility threshold ---
  const amount = Number(String(income.certified_annual_income).replace(/[^\d.]/g, ''));
  if (!Number.isFinite(amount) || amount === 0) {
    errors.push({ key: 'income_unreadable', params: {} });
  } else if (amount > EWS_INCOME_CEILING) {
    errors.push({ key: 'income_too_high', params: { n: amount.toLocaleString('en-IN') } });
  }

  // --- field present on no document ---
  if (!profile.purpose) missing.push('purpose');

  return { ok: errors.length === 0 && missing.length === 0, errors, missing };
}
