import { probabilityKnown } from "./mastery.js";

const HAN = /\p{Script=Han}/u;

export function readingIsReady(readings, skillState) {
  return probabilityKnown(skillState) >= (readings.furiganaThreshold ?? 0.75)
    && (skillState?.readingCheckpointStreak ?? 0) >= (readings.furiganaMinStreak ?? 2);
}

export function readingSkillId(entry) {
  return `reading.${entry.id}`;
}

export function augmentTreeWithReadings(tree, readings) {
  const existing = new Set(tree.nodes.map((node) => node.id));
  const generated = [];
  for (const entry of readings.entries) {
    const id = readingSkillId(entry);
    if (existing.has(id)) continue;
    existing.add(id);
    generated.push({ id, label: `${entry.term} · ${entry.reading}`, kind: "reading" });
  }

  return {
    ...tree,
    nodes: [...tree.nodes, ...generated]
  };
}

function hash(value) {
  return [...value].reduce((total, character) => total + character.codePointAt(0), 0);
}

function distractorReadings(entry, readings) {
  if (entry.distractors?.length === 2) return entry.distractors;
  const candidates = [...new Set(readings.entries
    .filter((candidate) => candidate.reading !== entry.reading)
    .map((candidate) => candidate.reading))];
  const start = hash(entry.id) % candidates.length;
  return [candidates[start], candidates[(start + Math.max(1, Math.floor(candidates.length / 2))) % candidates.length]];
}

function orderedOptions(entry, readings) {
  const values = [entry.reading, ...distractorReadings(entry, readings)];
  const shift = hash(entry.id) % values.length;
  return values.map((_, index) => values[(index + shift) % values.length]).map((reading, index) => ({
    id: `${entry.id}.${index}`,
    label: reading,
    correct: reading === entry.reading
  }));
}

export function createReadingItems(readings, contentPack) {
  const scenarios = new Map(contentPack.scenarios.map((scenario) => [scenario.id, scenario]));
  return readings.entries.map((entry) => {
    const scenario = scenarios.get(entry.scenarioId) ?? contentPack.scenarios[0];
    return {
      id: `reading-card.${entry.id}`,
      skillId: readingSkillId(entry),
      mode: "reading",
      priority: entry.priority ?? 0.9,
      prompt: entry.term,
      instruction: "Read this without furigana.",
      options: orderedOptions(entry, readings),
      answer: {
        ja: entry.term,
        reading: entry.reading,
        meaning: entry.meaning,
        note: "This reading has its own BKT state; phrase-card success does not inflate it."
      },
      zoom: {
        context: entry.context ?? entry.term,
        breakdown: entry.note ?? `Read ${entry.term} as ${entry.reading} in this trip context.`
      },
      scenarioId: scenario.id,
      scenarioTitle: scenario.title,
      scenarioPurpose: scenario.purpose
    };
  });
}

export function sortedReadings(readings) {
  return [...readings.entries].sort((a, b) => b.term.length - a.term.length || a.id.localeCompare(b.id));
}

export function tokenizeReadings(value, readings) {
  const entries = sortedReadings(readings);
  const segments = [];
  let plain = "";
  let index = 0;

  function flushPlain() {
    if (!plain) return;
    segments.push({ text: plain, entry: null });
    plain = "";
  }

  while (index < value.length) {
    const match = entries.find((entry) => value.startsWith(entry.term, index));
    if (match) {
      flushPlain();
      segments.push({ text: match.term, entry: match });
      index += match.term.length;
      continue;
    }
    const character = String.fromCodePoint(value.codePointAt(index));
    plain += character;
    index += character.length;
  }
  flushPlain();
  return segments;
}

export function uncoveredKanji(value, readings) {
  return tokenizeReadings(value, readings)
    .filter((segment) => !segment.entry && HAN.test(segment.text))
    .map((segment) => segment.text)
    .join("");
}

export function readingEntriesIn(value, readings) {
  const seen = new Set();
  return tokenizeReadings(value, readings)
    .filter((segment) => segment.entry)
    .map((segment) => segment.entry)
    .filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    });
}
