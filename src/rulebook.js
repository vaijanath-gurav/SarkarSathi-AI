// DEV 4 OWNS THIS FILE.
// Pure functions. No AI, no network. Testable right now with `npm run test:rules`.
// This is the heart of the demo: PS 19's "automated pre-submission validation".

const EWS_INCOME_CEILING = 800000;      // ₹8 lakh/yr
const INCOME_CERT_MAX_AGE_MONTHS = 12;
const LAND_RECORD_MAX_AGE_MONTHS = 6;
const LAND_AREA_MAX_HECTARES = 2.0234;   // 5 acres, central EWS criterion

/** "४५/२" -> "45/2". Devanagari digits are U+0966..U+096F. */
export function toAsciiDigits(s) {
  return String(s).replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966));
}

/**
 * Land area in hectares, or null if unreadable.
 * Accepts plain hectares ("1.21") and the 7/12 H.R.SqM form ("0.81.00" = 0 ha 81 are 0 m²).
 */
export function parseHectares(v) {
  if (v == null || v === 'NULL') return null;
  const s = toAsciiDigits(v).trim();
  const hrs = s.match(/^(\d+)\.(\d{1,2})\.(\d{1,2})$/);
  if (hrs) return Number(hrs[1]) + Number(hrs[2]) / 100 + Number(hrs[3]) / 10000;
  if (!/\d/.test(s)) return null;
  const n = Number(s.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

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

/**
 * ADR-8: match on the Roman-script form so a Latin Aadhaar and a Devanagari 7/12
 * compare meaningfully. Without this, cross-script documents score ~0% similarity
 * and the rulebook falsely rejects a legitimate applicant.
 * Falls back to the printed form when no Latin variant was extracted.
 */
export function matchName(obj, field) {
  return obj?.[`${field}_latin`] || obj?.[field] || '';
}

export function matchNameList(obj, field) {
  const latin = obj?.[`${field}_latin`];
  if (Array.isArray(latin) && latin.length) return latin;
  return Array.isArray(obj?.[field]) ? obj[field] : [];
}

export function monthsSince(dateStr, now = new Date()) {
  if (!dateStr || dateStr === 'NULL') return null;
  const d = new Date(toAsciiDigits(dateStr));
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
  if (missing.length) return { ok: false, errors, missing, notices: [] };

  // --- quality gate first: no point validating an unreadable scan ---
  if (identity.image_quality_flag === true) {
    errors.push({ key: 'blurry_retry', params: {} });
    return { ok: false, errors, missing, notices: [] };
  }

  // --- cross-document name match (the money shot on stage) ---
  // Compared in Roman script; reported in the script printed on the user's documents.
  const idName = matchName(identity, 'full_name');
  const owners = matchNameList(land, 'owner_names');
  if (!owners.some((o) => namesMatch(idName, o))) {
    errors.push({
      key: 'name_mismatch',
      params: {
        a: identity.full_name || idName,
        b: (land.owner_names || [])[0] || owners[0] || '—',
      },
    });
  }

  // --- identity vs income certificate ---
  if (!namesMatch(idName, matchName(income, 'applicant_name'))) {
    errors.push({
      key: 'income_name_mismatch',
      params: { a: identity.full_name || idName, b: income.applicant_name },
    });
  }

  // --- Phase 9: fields the operator types from the paper 7/12 ---
  // Exempt from the unreadable checks below; the operator is told instead.
  const notices = [];
  const operatorFields = Array.isArray(land.needs_operator) ? land.needs_operator : [];
  if (operatorFields.length) notices.push({ key: 'land_operator_entry', params: {} });

  // --- recency ---
  const incomeAge = monthsSince(income.issue_date, now);
  if (incomeAge === null) {
    errors.push({ key: 'income_date_unreadable', params: {} });
  } else if (incomeAge > INCOME_CERT_MAX_AGE_MONTHS) {
    errors.push({ key: 'income_stale', params: { d: income.issue_date } });
  }

  const landAge = monthsSince(land.record_print_date, now);
  if (landAge === null) {
    if (!operatorFields.includes('record_print_date')) {
      errors.push({ key: 'land_date_unreadable', params: {} });
    }
  } else if (landAge > LAND_RECORD_MAX_AGE_MONTHS) {
    errors.push({ key: 'land_stale', params: { d: land.record_print_date } });
  }

  // --- eligibility threshold ---
  const amount = Number(String(income.certified_annual_income).replace(/[^\d.]/g, ''));
  if (!Number.isFinite(amount) || amount === 0) {
    errors.push({ key: 'income_unreadable', params: {} });
  } else if (amount > EWS_INCOME_CEILING) {
    errors.push({ key: 'income_too_high', params: { n: amount.toLocaleString('en-IN') } });
  }

  // --- land size: central EWS criterion, < 5 acres ---
  const hectares = parseHectares(land.total_area_hectares);
  if (hectares === null) {
    if (!operatorFields.includes('total_area_hectares')) {
      errors.push({ key: 'land_area_unreadable', params: {} });
    }
  } else if (hectares >= LAND_AREA_MAX_HECTARES) {
    errors.push({ key: 'land_too_large', params: { n: hectares.toFixed(2) } });
  }

  // --- format: BUILD_SPEC §5.1 check 6 ---
  const pin = toAsciiDigits(identity.pin_code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(pin)) {
    errors.push({ key: 'pin_invalid', params: { p: identity.pin_code ?? '—' } });
  }
  const survey = land.survey_number;
  const surveyEmpty = survey == null || survey === 'NULL' || String(survey).trim() === '';
  if (surveyEmpty && !operatorFields.includes('survey_number')) {
    errors.push({ key: 'survey_missing', params: {} });
  }

  // --- field present on no document ---
  if (!profile.purpose) missing.push('purpose');

  return { ok: errors.length === 0 && missing.length === 0, errors, missing, notices };
}

/**
 * Phase 14 (R1, R8): validate ONE document on its own — the upload-capture check.
 * The same BUILD_SPEC §5.1 rules as validateEWS, applied to what this one document can be
 * judged on, plus a same-person check against the client's other documents when known.
 * Judges only; produces no data for filling.
 * @returns {{ok:boolean, errors:Array, notices:Array}}
 */
export function validateDocument(docType, doc, { profile = {}, now = new Date() } = {}) {
  const errors = [];
  const notices = [];
  const nm = (v) => (v && v !== 'NULL' ? v : '');
  if (!doc) return { ok: false, errors: [{ key: 'extract_failed', params: {} }], notices };

  if (docType === 'identity') {
    if (doc.image_quality_flag === true) {
      errors.push({ key: 'blurry_retry', params: {} });
      return { ok: false, errors, notices };
    }
    const idName = nm(matchName(doc, 'full_name'));
    if (!idName) errors.push({ key: 'name_unreadable', params: {} });
    const pin = toAsciiDigits(doc.pin_code ?? '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(pin)) errors.push({ key: 'pin_invalid', params: { p: doc.pin_code ?? '—' } });
    if (idName && profile.land) {
      const owners = matchNameList(profile.land, 'owner_names');
      if (owners.length && !owners.some((o) => namesMatch(idName, o))) {
        errors.push({ key: 'name_mismatch', params: { a: doc.full_name || idName, b: (profile.land.owner_names || [])[0] || owners[0] } });
      }
    }
    const incName = profile.income ? nm(matchName(profile.income, 'applicant_name')) : '';
    if (idName && incName && !namesMatch(idName, incName)) {
      errors.push({ key: 'income_name_mismatch', params: { a: doc.full_name || idName, b: profile.income.applicant_name } });
    }
  }

  if (docType === 'income') {
    const incName = nm(matchName(doc, 'applicant_name'));
    if (!incName) errors.push({ key: 'name_unreadable', params: {} });
    const age = monthsSince(doc.issue_date, now);
    if (age === null) errors.push({ key: 'income_date_unreadable', params: {} });
    else if (age > INCOME_CERT_MAX_AGE_MONTHS) errors.push({ key: 'income_stale', params: { d: doc.issue_date } });
    const amount = Number(String(doc.certified_annual_income).replace(/[^\d.]/g, ''));
    if (!Number.isFinite(amount) || amount === 0) errors.push({ key: 'income_unreadable', params: {} });
    else if (amount > EWS_INCOME_CEILING) errors.push({ key: 'income_too_high', params: { n: amount.toLocaleString('en-IN') } });
    const idName = profile.identity ? nm(matchName(profile.identity, 'full_name')) : '';
    if (idName && incName && !namesMatch(idName, incName)) {
      errors.push({ key: 'income_name_mismatch', params: { a: profile.identity.full_name || idName, b: doc.applicant_name } });
    }
  }

  if (docType === 'land') {
    const op = Array.isArray(doc.needs_operator) ? doc.needs_operator : [];
    if (op.length) notices.push({ key: 'land_operator_entry', params: {} });
    const owners = matchNameList(doc, 'owner_names').filter((o) => nm(o));
    if (!owners.length) errors.push({ key: 'name_unreadable', params: {} });
    const age = monthsSince(doc.record_print_date, now);
    if (age === null) {
      if (!op.includes('record_print_date')) errors.push({ key: 'land_date_unreadable', params: {} });
    } else if (age > LAND_RECORD_MAX_AGE_MONTHS) {
      errors.push({ key: 'land_stale', params: { d: doc.record_print_date } });
    }
    const ha = parseHectares(doc.total_area_hectares);
    if (ha === null) {
      if (!op.includes('total_area_hectares')) errors.push({ key: 'land_area_unreadable', params: {} });
    } else if (ha >= LAND_AREA_MAX_HECTARES) {
      errors.push({ key: 'land_too_large', params: { n: ha.toFixed(2) } });
    }
    const s = doc.survey_number;
    if ((s == null || s === 'NULL' || String(s).trim() === '') && !op.includes('survey_number')) {
      errors.push({ key: 'survey_missing', params: {} });
    }
    const idName = profile.identity ? nm(matchName(profile.identity, 'full_name')) : '';
    if (idName && owners.length && !owners.some((o) => namesMatch(idName, o))) {
      errors.push({ key: 'name_mismatch', params: { a: profile.identity.full_name || idName, b: (doc.owner_names || [])[0] || owners[0] } });
    }
  }

  return { ok: errors.length === 0, errors, notices };
}

/**
 * User requirement 2026-11-14: compare an uploaded document's name with the NAME box on the
 * form being filled. Documents are never compared with each other here.
 * form = { name, landHolder } (strings typed on the form; either may be empty).
 * Script: a Devanagari form name is compared with the document's printed name; otherwise with
 * the Latin name. 7/12 owners are compared with landHolder if filled, else with name.
 */
const devaScript = (s) => /[ऀ-ॿ]/.test(String(s || ''));

/** Candidate names printed on a document, in the script matching `script` (the form name). */
export function docNames(docType, doc, script) {
  if (!doc) return [];
  const deva = devaScript(script);
  const one = (field) => (deva ? doc[field] : (doc[`${field}_latin`] || doc[field])) || '';
  const many = (field) => {
    const l = deva ? doc[field] : (doc[`${field}_latin`] || doc[field]);
    return Array.isArray(l) ? l : [];
  };
  let names = [];
  if (docType === 'identity') names = [one('full_name')];
  else if (docType === 'income') names = [one('applicant_name'), ...many('other_names')];
  else if (docType === 'land') names = many('owner_names');
  return names.filter((x) => x && x !== 'NULL');
}

export function checkAgainstForm(docType, doc, form = {}) {
  const errors = [];
  if (!doc) return errors;
  const formName = String(form.name || '').trim();
  const target = docType === 'land' ? (String(form.landHolder || '').trim() || formName) : formName;
  if (!target) return errors;
  const names = docNames(docType, doc, target);
  if (names.length && !names.some((n) => namesMatch(n, target))) {
    errors.push({ key: 'form_name_mismatch', params: { d: `doc_${docType}`, a: names[0], b: target } });
  }
  return errors;
}

/**
 * Batch name check across all uploads on one form. uploads = [{ key, docType, doc }].
 * The NAME box may have been copied from the first uploaded document, so the form never decides
 * a dispute between documents: only documents vote, and a tie gives no verdict.
 */
export function resolveNames(uploads = [], form = {}) {
  const formName = String(form.name || '').trim();
  const landHolder = String(form.landHolder || '').trim();
  const perDoc = {};
  const notices = [];
  const clusters = [];
  for (const u of uploads) {
    if (u.docType === 'land' && landHolder) {
      const ln = docNames('land', u.doc, landHolder);
      if (ln.length && !ln.some((n) => namesMatch(n, landHolder))) {
        notices.push({ key: 'name_conflict_single', params: { d: `doc_${u.docType}`, a: ln[0], b: landHolder } });
      }
      continue;
    }
    const names = docNames(u.docType, u.doc, formName);
    if (!names.length) continue;
    const m = { u, names };
    const c = clusters.find((cl) => cl.names.some((a) => names.some((b) => namesMatch(a, b))));
    if (c) { c.members.push(m); c.names.push(...names); }
    else clusters.push({ members: [m], names: [...names], display: names[0] });
  }
  const suspect = (c) => ({ key: 'form_name_suspect', params: { docs: c.members.map((m) => `doc_${m.u.docType}`), a: c.display, b: formName } });
  const formMatches = (c) => c.names.some((n) => namesMatch(n, formName));
  if (clusters.length === 1) {
    const c = clusters[0];
    if (formName && !formMatches(c)) {
      if (c.members.length >= 2) notices.push(suspect(c));
      else notices.push({ key: 'name_conflict_single', params: { d: `doc_${c.members[0].u.docType}`, a: c.members[0].names[0], b: formName } });
    }
  } else if (clusters.length >= 2) {
    const sorted = [...clusters].sort((x, y) => y.members.length - x.members.length);
    const [big, second] = sorted;
    if (big.members.length > second.members.length) {
      for (const c of sorted.slice(1)) {
        for (const m of c.members) {
          perDoc[m.u.key] = [{ key: 'name_odd_doc', params: { d: `doc_${m.u.docType}`, a: m.names[0], b: big.display } }];
        }
      }
      if (formName && !formMatches(big)) notices.push(suspect(big));
    } else {
      notices.push({ key: 'name_conflict', params: { entries: clusters.flatMap((c) => c.members).map((m) => ({ d: `doc_${m.u.docType}`, a: m.names[0] })) } });
    }
  }
  return { perDoc, notices };
}
