// DEV 1 OWNS THIS FILE.
// Everyone else: leave USE_MOCK=true in .env and this returns fixtures instantly.
// Dev 1 swaps nothing — just flip USE_MOCK=false once `ollama pull` finishes.

import fs from 'node:fs/promises';
import path from 'node:path';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
// Must match ADR-3 in BUILD_SPEC.md. Not qwen2-vl: that is a generation behind and
// markedly worse on Devanagari. Not the 8b: it will not fit 6GB VRAM.
const VLM_MODEL = process.env.VLM_MODEL || 'qwen3-vl:4b-instruct';
const USE_MOCK = process.env.USE_MOCK !== 'false';

export const SYSTEM_PROMPT = `You are a highly secure, deterministic Government Document OCR Data Extraction Engine. Your sole function is to analyze the provided image, extract the required fields, and output them STRICTLY as a valid JSON object.

CRITICAL CONSTRAINTS:
1. NO CONVERSATION: Do not output any conversational text, greetings, explanations, or markdown formatting outside of the raw JSON block.
2. ZERO HALLUCINATION: Do not infer, guess, or calculate any missing information. If a requested field is blurry, cropped, or not present in the image, you must output the exact string "NULL" for that key.
3. NO DATE MATH: Never compute ages, durations, validity or expiry. Transcribe dates exactly as printed and nothing more.
4. EXACT SPELLING: Transcribe names and addresses exactly as they appear in the image, preserving all regional spellings and typos.
5. REDACTION COMPLIANCE: Never output a full 12-digit government ID number. Output only the digits explicitly requested by the schema.
6. TRANSLITERATION: Converting a visible name into Roman script is permitted and required. Inventing a name that is not visible is not.
7. VALUES ONLY: Never include a field's printed label in its value. If the document shows "Address: 12 Main Street", output "12 Main Street", not "Address: 12 Main Street". The same applies to every field.
8. SCRIPT FIDELITY: Transcribe in the exact script printed on the document. Devanagari, Gurmukhi, Gujarati, Tamil and other Indic scripts are NOT interchangeable. Never convert between them. Only the *_latin fields may be transliterated.`;

export const SCHEMAS = {
  identity: `Analyze the attached identity document. Map the visible text to the following JSON schema exactly. Return ONLY the JSON.
{
  "document_type": "IDENTITY_CARD",
  "full_name": "String - The full name EXACTLY as printed, in the script printed on the document",
  "full_name_latin": "String - The same name in Roman script. If the document prints an English version, copy that EXACTLY. Otherwise transliterate it.",
  "full_name_latin_printed": "Boolean - true if that Roman-script name is printed on the document, false if you transliterated it",
  "date_of_birth": "String - Format strictly as YYYY-MM-DD. If only birth year is visible, output YYYY",
  "gender": "String - MALE, FEMALE, or OTHER",
  "address": "String - The complete printed address, combining all lines. Do NOT include the word 'Address' or any other field label.",
  "pin_code": "String - The 6-digit postal code if visible",
  "id_number_last_four": "String - Only the final 4 digits of the ID number",
  "image_quality_flag": "Boolean - Set to true if the image is too blurry to read critical fields"
}`,

  income: `Analyze the attached state-issued Income Certificate. Map the visible text to the following JSON schema exactly. Return ONLY the JSON.
{
  "document_type": "INCOME_CERTIFICATE",
  "applicant_name": "String - The name EXACTLY as printed, in the script printed on the document",
  "applicant_name_latin": "String - The same name in Roman script. If an English version is printed, copy it EXACTLY. Otherwise transliterate.",
  "certified_annual_income": "String - The total annual income amount in numbers (e.g., 120000)",
  "issuing_authority": "String - The designation of the officer who issued the certificate",
  "issue_date": "String - The exact date the certificate was issued, formatted as YYYY-MM-DD",
  "certificate_number": "String - The unique application or certificate registration number"
}`,

  land: `Analyze the attached agricultural land record (7/12 extract). This document may contain complex tables and regional languages. Map the visible text to the following JSON schema exactly. Return ONLY the JSON.
{
  "document_type": "LAND_RECORD",
  "village_name": "String - The name of the village/village panchayat",
  "taluka_and_district": "String - The sub-district (Taluka) and District names",
  "survey_number": "String - The Survey Number / Gat Number / Khata Number",
  "total_area_hectares": "String - The total land area listed, usually in Hectares or Acres",
  "owner_names": ["String - Array of all occupant/owner names in the ownership column, EXACTLY as printed. Extract every name."],
  "owner_names_latin": ["String - The same names in Roman script, in the same order."],
  "record_print_date": "String - The print/issue date stamped on the extract, formatted YYYY-MM-DD. Output NULL if no date is printed."
}`,
};

// Phase 9: a 7/12 is read in two passes. Measured on a SAMPLE 7/12: the strict JSON prompt
// returned NULL for every field on a full page, while a plain transcription prompt read the
// village, taluka, district and every owner correctly. Pass 1 transcribes the image as plain
// text; pass 2 structures that text with the normal system prompt and schema, with no image.
export const LAND_TRANSCRIBE_PROMPT = `Transcribe this land record (7/12 extract) as plain text. Copy text exactly as printed, in the script printed. Keep Devanagari digits as printed. Output these lines, one per item:
गाव (village): ...
तालुका (taluka): ...
जिल्हा (district): ...
गट क्रमांक / survey number: ...
Owner table rows (one line each): खाते क्र | भोगवटादाराचे नाव | क्षेत्र | आकार
Total area (एकूण क्षेत्र): ...
Every date printed anywhere on the page: ...
Write NULL for anything you cannot read.`;

const LAND_SCHEMA_INTRO = 'Analyze the attached agricultural land record (7/12 extract). This document may contain complex tables and regional languages. ';

export function landStructurePrompt(transcript) {
  return `The following is a plain-text transcription of a land record (7/12 extract). Use ONLY this text as the source.\n\n---\n${transcript}\n---\n\n${SCHEMAS.land.replace(LAND_SCHEMA_INTRO, '')}`;
}

// Phase 9: the model misreads Devanagari digits (४ read as ८; ४५/२ returned as 842),
// confidently and even at 2x resolution. Numbers on a 7/12 are therefore never taken from
// the model: they are blanked and listed in needs_operator, and the operator types them
// from the paper extract. A wrong survey number on a government form is the exact silent
// failure this product exists to prevent.
export const LAND_OPERATOR_FIELDS = ['survey_number', 'total_area_hectares', 'record_print_date'];

export function applyOperatorFields(land) {
  const out = { ...land };
  for (const k of LAND_OPERATOR_FIELDS) out[k] = null;
  out.needs_operator = [...LAND_OPERATOR_FIELDS];
  return out;
}

/**
 * Strips markdown fences and anything outside the outermost JSON object.
 * VLMs wrap JSON in ``` about a third of the time no matter what you tell them.
 */
export function sanitiseJson(raw) {
  let t = String(raw).trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in model output');
  }
  return JSON.parse(t.slice(start, end + 1));
}

/** Defence in depth: never trust the model to redact. */
export function maskIdNumbers(obj) {
  const json = JSON.stringify(obj).replace(/\b\d{12}\b/g, (m) => `XXXX-XXXX-${m.slice(-4)}`);
  return JSON.parse(json);
}

async function callOllama(imageBuffer, docType) {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: VLM_MODEL,
      system: SYSTEM_PROMPT,
      prompt: SCHEMAS[docType],
      images: [imageBuffer.toString('base64')],
      stream: false,
      options: { temperature: 0 }, // determinism matters more than fluency here
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.response;
}

async function ollamaGenerate(body, extraOptions = {}) {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: VLM_MODEL,
      stream: false,
      options: { temperature: 0, ...extraOptions },
      ...body,
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.response;
}

async function callOllamaLand(imageBuffer) {
  // num_predict caps pass 1: on one test the model looped on a single line 68 times.
  const transcript = await ollamaGenerate(
    { prompt: LAND_TRANSCRIBE_PROMPT, images: [imageBuffer.toString('base64')] },
    { num_predict: 600 },
  );
  return ollamaGenerate({ system: SYSTEM_PROMPT, prompt: landStructurePrompt(transcript) });
}

/**
 * The one function the whole pipeline depends on.
 * @param {Buffer} imageBuffer
 * @param {'identity'|'income'|'land'} docType
 */
export async function extractDocument(imageBuffer, docType) {
  if (!SCHEMAS[docType]) throw new Error(`Unknown docType: ${docType}`);

  if (USE_MOCK) {
    // MOCK_IDENTITY / MOCK_INCOME / MOCK_LAND override which fixture is returned,
    // so a simulated run can feed the planted-mismatch record. Default is the
    // fixture named after the document type.
    const override = process.env[`MOCK_${docType.toUpperCase()}`];
    const basename = override || docType;
    const file = path.join(process.cwd(), 'fixtures', `${basename}.json`);
    return JSON.parse(await fs.readFile(file, 'utf8'));
  }

  // One retry. Models fail to close JSON often enough that this is worth it.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = docType === 'land'
        ? await callOllamaLand(imageBuffer)
        : await callOllama(imageBuffer, docType);
      const data = maskIdNumbers(sanitiseJson(raw));
      return docType === 'land' ? applyOperatorFields(data) : data;
    } catch (err) {
      console.warn(`[extract] attempt ${attempt} failed for ${docType}: ${err.message}`);
      if (attempt === 2) throw err;
    }
  }
}

/**
 * Phase 14 (R1): which document is this? Used by upload capture when the upload slot's
 * label does not say. Returns 'identity' | 'income' | 'land' | null. Mock mode: null.
 */
export async function classifyDocument(imageBuffer) {
  if (USE_MOCK) return null;
  const raw = await ollamaGenerate(
    {
      prompt: 'Which document is this image? Answer with exactly one word: AADHAAR, INCOME, LAND or OTHER. LAND means a 7/12 extract (सातबारा) or another land record. INCOME means an income certificate (उत्पन्नाचा दाखला / आय प्रमाण पत्र).',
      images: [imageBuffer.toString('base64')],
    },
    { num_predict: 5 },
  );
  const w = String(raw).toUpperCase();
  if (w.includes('AADHAAR')) return 'identity';
  if (w.includes('INCOME')) return 'income';
  if (w.includes('LAND')) return 'land';
  return null;
}
