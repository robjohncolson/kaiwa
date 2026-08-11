export const FIELD_DECISION_START = "worked";

const FIELD_DECISIONS = Object.freeze({
  worked: {
    prompt: "Did the conversation work without a rescue?",
    yes: { outcome: "worked" },
    no: { next: "phone_sheet" }
  },
  phone_sheet: {
    prompt: "Did you use the phone sheet?",
    yes: { outcome: "phone_sheet" },
    no: { next: "aborted" }
  },
  aborted: {
    prompt: "Did you abort safely?",
    yes: { outcome: "aborted" },
    no: { outcome: "failed" }
  }
});

export function fieldDecision(step = FIELD_DECISION_START) {
  const decision = FIELD_DECISIONS[step];
  if (!decision) throw new TypeError(`Unknown field decision: ${step}`);
  return decision;
}

export function answerFieldDecision(step, answer) {
  if (typeof answer !== "boolean") throw new TypeError("A field decision must be yes or no.");
  return fieldDecision(step)[answer ? "yes" : "no"];
}

export function cycleIndex(index, length) {
  if (!Number.isInteger(length) || length < 1) throw new TypeError("A wizard list cannot be empty.");
  return (Number(index) + 1 + length) % length;
}

export function actionPair(...actions) {
  const visible = actions.filter(Boolean);
  if (visible.length > 2) throw new TypeError("A wizard screen can expose at most two actions.");
  return visible;
}

export function candidateAnswer({ options, index, rejectedCorrect = false, accepted }) {
  if (!Array.isArray(options) || options.length < 2) {
    throw new TypeError("A candidate question needs at least two options.");
  }
  const option = options[index];
  if (!option) throw new TypeError("Candidate index is out of range.");
  if (accepted) return { complete: true, correct: Boolean(option.correct) && !rejectedCorrect };
  const missedCorrect = rejectedCorrect || Boolean(option.correct);
  if (index >= options.length - 1) return { complete: true, correct: false, rejectedCorrect: missedCorrect };
  return { complete: false, nextIndex: index + 1, rejectedCorrect: missedCorrect };
}
