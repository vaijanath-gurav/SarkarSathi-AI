// DEV 1 OWNS THIS FILE.
// Everyone else: leave USE_MOCK=true in .env and this returns fixtures instantly.
// Dev 1 swaps nothing — just flip USE_MOCK=false once `ollama pull` finishes.

import fs from 'node:fs/promises';
import path from 'node:path';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const VLM_MODEL = process.env.VLM_MODEL || 'qwen2-vl:7b';
const USE_MOCK = process.env.USE_MOCK !== 'false';

export const SYSTEM_PROMPT = `You are a highly secure, deterministic Government Document OCR Data Extraction Engine. Your sole function is to analyze the provided image, extract the required fields, and output them STRICTLY as a valid JSON object.

CRITICAL CONSTRAINTS:
1. NO CONVERSATION: Do not output any conversational text, greetings, explanations, or markdown formatting outside of the raw JSON block.
2. ZERO HALLUCINATION: Do not infer, guess, or calculate any missing information. If a requested field is blurry, cropped, or not present in the image, you must output the exact string "NULL" for that key.
3. NO DATE MATH: Never compute ages, durations, validity or expiry. Transcribe dates exactly as printed and nothing more.
4. EXACT SPELLING: Transcribe names and addresses exactly as they appear in the image, preserving all regional spellings and typos.
5. REDACTION COMPLIANCE: Never output a full 12-digit government ID number. Output only the digits explicitly requested by the schema.`;

export const SCHEMAS = {
  identity: `Analyze the attached identity document. Map the visible text to the following JSON schema exactly. Return ONLY the JSON.
{
  "document_type": "IDENTITY_CARD",
  "full_name": "String - The exact full name of the individual",
  "date_of_birth": "String - Format strictly as YYYY-MM-DD. If only birth year is visible, output YYYY",
  "gender": "String - MALE, FEMALE, or OTHER",
  "address": "String - The complete printed address, combining all lines",
  "pin_code": "String - The 6-digit postal code if visible",
  "id_number_last_four": "String - Only the final 4 digits of the ID number",
  "image_quality_flag": "Boolean - Set to true if the image is too blurry to read critical fields"
}`,

  income: `Analyze the attached state-issued Income Certificate. Map the visible text to the following JSON schema exactly. Return ONLY the JSON.
{
  "document_type": "INCOME_CERTIFICATE",
  "applicant_name": "String - The name of the person whose income is being certified",
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
  "owner_names": ["String - Array of all individual occupant/owner names listed in the ownership column. Extract every name."],
  "record_print_date": "String - The print/issue date stamped on the extract, formatted YYYY-MM-DD. Output NULL if no date is printed."
}`,
};

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

/**
 * The one function the whole pipeline depends on.
 * @param {Buffer} imageBuffer
 * @param {'identity'|'income'|'land'} docType
 */
export async function extractDocument(imageBuffer, docType) {
  if (!SCHEMAS[docType]) throw new Error(`Unknown docType: ${docType}`);

  if (USE_MOCK) {
    const file = path.join(process.cwd(), 'fixtures', `${docType}.json`);
    return JSON.parse(await fs.readFile(file, 'utf8'));
  }

  // One retry. Models fail to close JSON often enough that this is worth it.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = await callOllama(imageBuffer, docType);
      return maskIdNumbers(sanitiseJson(raw));
    } catch (err) {
      console.warn(`[extract] attempt ${attempt} failed for ${docType}: ${err.message}`);
      if (attempt === 2) throw err;
    }
  }
}
