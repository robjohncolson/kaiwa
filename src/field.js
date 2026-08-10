export const FIELD_OUTCOMES = Object.freeze(["worked", "phone_sheet", "aborted", "failed"]);

const MULTIPLIERS = Object.freeze({
  worked: 0.9,
  phone_sheet: 1.5,
  aborted: 2,
  failed: 2.5
});

export function recordFieldOutcome(fieldState, { scenarioId, outcome, at = Date.now() }) {
  if (!scenarioId || !FIELD_OUTCOMES.includes(outcome)) {
    throw new TypeError("Field evidence needs a scenario and known outcome.");
  }
  const event = { id: `field-${at}-${scenarioId}`, scenarioId, outcome, at };
  return {
    events: [...(fieldState?.events ?? []), event].slice(-100)
  };
}

export function latestFieldOutcome(fieldState, scenarioId = null) {
  return [...(fieldState?.events ?? [])]
    .reverse()
    .find((event) => !scenarioId || event.scenarioId === scenarioId) ?? null;
}

export function fieldMultiplier(fieldState, scenarioId, now = Date.now()) {
  const event = latestFieldOutcome(fieldState, scenarioId);
  if (!event) return 1;
  const ageMs = Math.max(0, now - event.at);
  if (ageMs > 7 * 24 * 60 * 60 * 1000) return 1;
  const strength = ageMs <= 72 * 60 * 60 * 1000 ? 1 : 0.5;
  return 1 + ((MULTIPLIERS[event.outcome] ?? 1) - 1) * strength;
}

export function fieldCounts(fieldState, scenarioId = null) {
  return (fieldState?.events ?? [])
    .filter((event) => !scenarioId || event.scenarioId === scenarioId)
    .reduce((counts, event) => ({ ...counts, [event.outcome]: counts[event.outcome] + 1 }), {
      worked: 0,
      phone_sheet: 0,
      aborted: 0,
      failed: 0
    });
}
