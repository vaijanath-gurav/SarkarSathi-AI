// B10 - Node client for the local speech-to-text service.  DEV 2 OWNS THIS FILE.
//
// Mirrors extractor.js: mockable, so the conversation flow can be built and tested
// before Whisper exists. Set USE_MOCK_STT=false once stt/server.py is running.

const STT_URL = process.env.STT_URL || 'http://localhost:5005';
const USE_MOCK_STT = process.env.USE_MOCK_STT !== 'false';

/** Whisper codes we have catalogs for. Anything else falls back to the session language. */
const SUPPORTED = new Set(['en', 'mr', 'hi']);

/**
 * @param {Buffer} audioBuffer  raw OGG/Opus straight from WhatsApp - no conversion needed
 * @returns {Promise<{text:string, language:string|null, confident:boolean}>}
 */
export async function transcribe(audioBuffer, language = null) {
  if (USE_MOCK_STT) {
    return { text: 'ok', language: language || 'mr', confident: true };
  }

  // ALWAYS pass the language the user picked. Auto-detect on a 3.5s Marathi clip
  // identified it as Tagalog at 0.33 confidence and produced Latin gibberish; the same
  // audio with language=mr transcribed correctly in 1.6s. We know the answer from the
  // language button, so never make the model guess.
  const url = language
    ? `${STT_URL}/transcribe?language=${encodeURIComponent(language)}`
    : `${STT_URL}/transcribe`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: audioBuffer,
  });
  if (!res.ok) throw new Error(`STT ${res.status}: ${await res.text()}`);

  const data = await res.json();
  return {
    text: (data.text || '').trim(),
    language: SUPPORTED.has(data.language) ? data.language : null,
    // Below ~0.6 Whisper is guessing, usually on very short clips. Don't switch
    // the user's language on a guess.
    confident: (data.language_probability ?? 0) >= 0.6,
    raw: data,
  };
}

export async function sttHealthy() {
  try {
    const res = await fetch(`${STT_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Spoken corrections arrive as prose, not as "1 Ramesh Patil". Map the common shapes
 * onto the numeric protocol the review stage already understands, so voice and text
 * share one code path.
 *
 * Deliberately keyword-based, not an LLM: it must behave identically every time, and
 * these are a handful of fixed phrases per language.
 */
const FIELD_WORDS = {
  1: ['name', 'नाव', 'नाम'],
  2: ['birth', 'dob', 'जन्म', 'जन्मतारीख'],
  3: ['address', 'पत्ता', 'पता'],
  4: ['income', 'salary', 'उत्पन्न', 'आय'],
  5: ['survey', 'gat', 'सर्व्हे', 'सर्वे', 'गट'],
  6: ['purpose', 'reason', 'कारण', 'उद्देश'],
};

/** Drops a leading "is" / "should be" / "आहे" / "है" so it never lands in the value. */
function stripConnector(s) {
  return String(s)
    .replace(/^[\s:,-]*(?:is|should\s+be|आहे|है)\b[\s:,-]*/i, '')
    .trim();
}

export function voiceToReviewReply(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const lower = t.toLowerCase();

  // Already in numeric form (user read the number aloud, or typed it).
  if (/^\d+[.)\s:-]+.+/s.test(t)) return t;

  // "number three is Patil" / "तीन नाव पाटील"
  // Matched case-insensitively against the ORIGINAL string so the captured value keeps
  // its casing — a name is about to go on a government form.
  const spoken = t.match(/\b(?:number\s+)?(one|two|three|four|five|six|\d)\b[\s,:-]+(.+)/is);
  if (spoken) {
    const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
    const n = words[spoken[1].toLowerCase()] ?? Number(spoken[1]);
    const value = stripConnector(spoken[2]);
    if (n >= 1 && n <= 6 && value) return `${n} ${value}`;
  }

  // "name is Ramesh Patil" / "नाव रमेश पाटील आहे"
  for (const [index, words] of Object.entries(FIELD_WORDS)) {
    for (const w of words) {
      const i = lower.indexOf(w);
      if (i === -1) continue;
      const after = stripConnector(t.slice(i + w.length));
      if (after) return `${index} ${after}`;
    }
  }

  return t; // let the review stage decide - it handles confirmations and unparsed input
}
