// In-memory only. No database for a 24-hour build.

const sessions = new Map();
const processedMessageIds = new Set();

export const STAGES = {
  LANGUAGE: 'LANGUAGE',
  IDENTITY: 'IDENTITY',
  INCOME: 'INCOME',
  LAND: 'LAND',
  PURPOSE: 'PURPOSE',
  REVIEW: 'REVIEW',
  DONE: 'DONE',
};

export function getSession(phone) {
  if (!sessions.has(phone)) {
    sessions.set(phone, {
      phone,
      language: 'en',
      stage: STAGES.LANGUAGE,
      profile: { identity: null, income: null, land: null, purpose: null },
    });
  }
  return sessions.get(phone);
}

export function resetSession(phone) {
  sessions.delete(phone);
  return getSession(phone);
}

/** Meta retries aggressively. Without this one photo gets processed three times. */
export function alreadyProcessed(messageId) {
  if (processedMessageIds.has(messageId)) return true;
  processedMessageIds.add(messageId);
  if (processedMessageIds.size > 1000) {
    processedMessageIds.delete(processedMessageIds.values().next().value);
  }
  return false;
}
