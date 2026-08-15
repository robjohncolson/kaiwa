import { probabilityKnown } from "./mastery.js";
import { validateSpeechReading } from "./listening.js";

const HAN = /\p{Script=Han}/u;

export function readingIsReady(readings, skillState) {
  return probabilityKnown(skillState) >= (readings.furiganaThreshold ?? 0.75)
    && (skillState?.readingCheckpointStreak ?? 0) >= (readings.furiganaMinStreak ?? 2)
    && (skillState?.observations?.card?.correct ?? 0) >= (readings.furiganaMinCardCorrect ?? 2)
    && Number.isFinite(skillState?.lastSpacedCardCorrectAt)
    && skillState?.lastCardOutcome === "correct"
    && (!Number.isFinite(skillState?.lastRoleplaySuccessAt)
      || skillState.lastCardObservedAt > skillState.lastRoleplaySuccessAt);
}

export function readingSkillId(entry) {
  return `reading.${entry.id}`;
}

export function readingCharacterSkillId(entry, index) {
  return `reading-character.${entry.id}.${index}`;
}

export function listeningSkillId(entry) {
  return `listening.${entry.id}`;
}

export function wordFormSkillId(entry) {
  return `word-form.${entry.id}`;
}

export function wordMeaningSkillId(entry) {
  return `word-meaning.${entry.id}`;
}

export function wordRecallSkillId(entry) {
  return `word-recall.${entry.id}`;
}

export function wordFacetSkillIds(entry) {
  return [
    readingSkillId(entry),
    listeningSkillId(entry),
    wordFormSkillId(entry),
    wordMeaningSkillId(entry),
    wordRecallSkillId(entry)
  ];
}

export function kanjiCharacters(value) {
  return [...String(value ?? "")].filter((character) => HAN.test(character));
}

export function itemTestsReading(item) {
  return item?.mode === "reading" || item?.testsReading === true;
}

export function augmentTreeWithReadings(tree, readings) {
  const existing = new Set(tree.nodes.map((node) => node.id));
  const generated = [];
  const decompositions = [...(tree.decompositions ?? [])];
  const addNode = (id, label, kind) => {
    if (existing.has(id)) return;
    existing.add(id);
    generated.push({ id, label, kind });
  };
  const addDecomposition = (from, to) => {
    if (!decompositions.some((edge) => edge.from === from && edge.to === to)) {
      decompositions.push({ from, to });
    }
  };
  for (const entry of readings.entries) {
    const readingId = readingSkillId(entry);
    const listeningId = listeningSkillId(entry);
    const formId = wordFormSkillId(entry);
    const meaningId = wordMeaningSkillId(entry);
    const recallId = wordRecallSkillId(entry);
    addNode(readingId, `${entry.term} · ${entry.reading}`, "reading");
    addNode(listeningId, `${entry.reading} heard → ${entry.meaning}`, "listening");
    addNode(formId, `${entry.reading} → ${entry.term}`, "written-form");
    addNode(meaningId, `${entry.term} · ${entry.meaning}`, "meaning");
    addNode(recallId, `${entry.meaning} → ${entry.term}`, "recall");
    addDecomposition(readingId, recallId);
    addDecomposition(readingId, listeningId);
    addDecomposition(meaningId, listeningId);
    addDecomposition(formId, recallId);
    addDecomposition(meaningId, recallId);
    const characters = kanjiCharacters(entry.term);
    if (characters.length < 2) continue;
    characters.forEach((character, index) => {
      const characterId = readingCharacterSkillId(entry, index);
      addNode(characterId, `${character} in ${entry.term}`, "kanji");
      addDecomposition(characterId, readingId);
      addDecomposition(characterId, formId);
    });
  }

  return {
    ...tree,
    nodes: [...tree.nodes, ...generated],
    decompositions
  };
}

function hash(value) {
  return [...value].reduce((total, character) => total + character.codePointAt(0), 0);
}

export function validateOptionSet(options, label = "Generated card") {
  if (!Array.isArray(options) || options.length !== 3) {
    throw new TypeError(`${label} must have exactly three options.`);
  }
  if (options.filter((option) => option.correct === true).length !== 1) {
    throw new TypeError(`${label} must have exactly one correct option.`);
  }
  if (new Set(options.map((option) => option.id)).size !== options.length
    || new Set(options.map((option) => option.label)).size !== options.length) {
    throw new TypeError(`${label} options must have unique IDs and labels.`);
  }
  return options;
}

function distractorReadings(entry, readings, salt = 0) {
  if (entry.distractors != null) {
    if (!Array.isArray(entry.distractors)
      || entry.distractors.length !== 2
      || new Set(entry.distractors).size !== 2
      || entry.distractors.includes(entry.reading)) {
      throw new TypeError(`Reading distractors for ${entry.id} must be distinct from the answer.`);
    }
    return entry.distractors;
  }
  const candidates = [...new Set(readings.entries
    .filter((candidate) => candidate.reading !== entry.reading)
    .map((candidate) => candidate.reading))];
  if (candidates.length < 2) throw new TypeError(`Not enough reading distractors for ${entry.id}.`);
  const start = hash(`${entry.id}.${salt}`) % candidates.length;
  return [candidates[start], candidates[(start + Math.max(1, Math.floor(candidates.length / 2))) % candidates.length]];
}

function orderedOptions(entry, readings, salt = 0) {
  const values = [entry.reading, ...distractorReadings(entry, readings, salt)];
  const shift = hash(`${entry.id}.${salt}`) % values.length;
  const options = values.map((_, index) => values[(index + shift) % values.length]).map((reading) => ({
    id: `${entry.id}.reading.${reading}`,
    label: reading,
    correct: reading === entry.reading
  }));
  return validateOptionSet(options, `Reading card ${entry.id}`);
}

export function createReadingItems(readings, contentPack) {
  const scenarios = new Map(contentPack.scenarios.map((scenario) => [scenario.id, scenario]));
  return readings.entries.map((entry) => {
    const scenario = scenarios.get(entry.scenarioId) ?? contentPack.scenarios[0];
    return {
      id: `reading-card.${entry.id}`,
      skillId: readingSkillId(entry),
      mode: "reading",
      facet: "sound",
      wordId: entry.id,
      testsReading: true,
      breakdownLeaf: kanjiCharacters(entry.term).length < 2,
      priority: entry.priority ?? 0.9,
      prompt: entry.term,
      instruction: "Read the large word without furigana. Is the hiragana below its pronunciation?",
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

function facetDistractors(entry, readings, labelFor, facet, salt = 0) {
  const correctLabel = labelFor(entry);
  const seenLabels = new Set([correctLabel]);
  const selected = [];
  const pools = [
    readings.entries.filter((candidate) => candidate.id !== entry.id && candidate.scenarioId === entry.scenarioId),
    readings.entries.filter((candidate) => candidate.id !== entry.id && candidate.scenarioId !== entry.scenarioId)
  ];
  for (const pool of pools) {
    const start = pool.length > 0 ? hash(`${entry.id}.${facet}.${pool.length}.${salt}`) % pool.length : 0;
    for (let offset = 0; offset < pool.length && selected.length < 2; offset += 1) {
      const candidate = pool[(start + offset) % pool.length];
      const label = labelFor(candidate);
      if (seenLabels.has(label)) continue;
      seenLabels.add(label);
      selected.push(candidate);
    }
    if (selected.length === 2) break;
  }
  return selected;
}

function facetOptions(entry, readings, { facet, labelFor, diagnosticFor, salt = 0 }) {
  const candidates = [entry, ...facetDistractors(entry, readings, labelFor, facet, salt)];
  if (candidates.length !== 3) throw new TypeError(`Not enough distinct ${facet} distractors for ${entry.id}.`);
  const shift = hash(`${facet}.${entry.id}.${salt}`) % candidates.length;
  const options = candidates.map((_, index) => candidates[(index + shift) % candidates.length]).map((candidate) => ({
    id: `${entry.id}.${facet}.${candidate.id}`,
    label: labelFor(candidate),
    correct: candidate.id === entry.id,
    ...(candidate.id === entry.id ? {} : { diagnosticSkillIds: diagnosticFor(candidate) })
  }));
  return validateOptionSet(options, `${facet} card ${entry.id}`);
}

export function createWordFacetItems(readings, contentPack) {
  const scenarios = new Map(contentPack.scenarios.map((scenario) => [scenario.id, scenario]));
  return readings.entries.flatMap((entry) => {
    validateSpeechReading(entry.reading, `Reading entry ${entry.id}`);
    const scenario = scenarios.get(entry.scenarioId) ?? contentPack.scenarios[0];
    const shared = {
      wordId: entry.id,
      scenarioId: scenario.id,
      scenarioTitle: scenario.title,
      scenarioPurpose: scenario.purpose
    };
    return [
      {
        ...shared,
        id: `listening-card.${entry.id}`,
        skillId: listeningSkillId(entry),
        mode: "listening",
        facet: "listening-comprehension",
        priority: (entry.priority ?? 0.9) * 1.06,
        prompt: entry.term,
        instruction: "Hear the word first, then choose its meaning. Furigana appears after the attempt or whenever you ask for text help.",
        speech: { reading: entry.reading },
        options: facetOptions(entry, readings, {
          facet: "listening-comprehension",
          labelFor: (candidate) => candidate.meaning,
          diagnosticFor: (candidate) => [wordMeaningSkillId(candidate)]
        }),
        answer: {
          ja: entry.term,
          reading: entry.reading,
          meaning: entry.meaning,
          note: "This listening BKT is separate from reading the written word. Replays are free; revealing text makes the attempt assisted and neutral."
        },
        zoom: {
          context: entry.context ?? `${entry.term}（${entry.reading}）`,
          breakdown: `Heard ${entry.reading} → ${entry.meaning}`
        }
      },
      {
        ...shared,
        id: `word-form-card.${entry.id}`,
        skillId: wordFormSkillId(entry),
        mode: "word-form",
        facet: "written-form",
        priority: (entry.priority ?? 0.9) * 0.8,
        prompt: entry.reading,
        instruction: "Choose the complete Japanese written form for this reading.",
        options: facetOptions(entry, readings, {
          facet: "written-form",
          labelFor: (candidate) => candidate.term,
          diagnosticFor: (candidate) => [readingSkillId(candidate)]
        }),
        answer: {
          ja: entry.term,
          reading: entry.reading,
          meaning: entry.meaning,
          note: "This written-form BKT is independent from recognizing the pronunciation."
        },
        zoom: {
          context: entry.context ?? `${entry.term}（${entry.reading}）`,
          breakdown: `Reading ${entry.reading} → written form ${entry.term}`
        }
      },
      {
        ...shared,
        id: `word-meaning-card.${entry.id}`,
        skillId: wordMeaningSkillId(entry),
        mode: "word-meaning",
        facet: "meaning-recognition",
        priority: (entry.priority ?? 0.9) * 0.86,
        prompt: entry.term,
        instruction: "Choose the meaning of this Japanese word in the trip context.",
        options: facetOptions(entry, readings, {
          facet: "meaning-recognition",
          labelFor: (candidate) => candidate.meaning,
          diagnosticFor: (candidate) => [wordMeaningSkillId(candidate)]
        }),
        answer: {
          ja: entry.term,
          reading: entry.reading,
          meaning: entry.meaning,
          note: "This meaning BKT is independent from reading the written form aloud."
        },
        zoom: {
          context: entry.context ?? `${entry.term}（${entry.reading}）`,
          breakdown: `${entry.term} → ${entry.meaning}`
        }
      },
      {
        ...shared,
        id: `word-recall-card.${entry.id}`,
        skillId: wordRecallSkillId(entry),
        mode: "word-recall",
        facet: "meaning-recall",
        priority: (entry.priority ?? 0.9) * 0.74,
        prompt: entry.meaning,
        instruction: "Recall the Japanese word, then decide whether the candidate matches.",
        options: facetOptions(entry, readings, {
          facet: "meaning-recall",
          labelFor: (candidate) => candidate.term,
          diagnosticFor: (candidate) => [wordMeaningSkillId(candidate)]
        }),
        answer: {
          ja: entry.term,
          reading: entry.reading,
          meaning: entry.meaning,
          note: "Recall combines meaning, sound, and written-form evidence without changing their separate BKT states."
        },
        zoom: {
          context: entry.context ?? `${entry.term}（${entry.reading}）`,
          breakdown: `${entry.meaning} → ${entry.term}（${entry.reading}）`
        }
      }
    ];
  });
}

function maskKanji(term, targetIndex) {
  let kanjiIndex = 0;
  return [...term].map((character) => {
    if (!HAN.test(character)) return character;
    const masked = kanjiIndex === targetIndex ? "□" : character;
    kanjiIndex += 1;
    return masked;
  }).join("");
}

function characterOptions(entry, index, readings, salt = 0) {
  const correct = kanjiCharacters(entry.term)[index];
  const pool = [...new Set([
    ...kanjiCharacters(entry.term),
    ...readings.entries.flatMap((candidate) => kanjiCharacters(candidate.term))
  ])].filter((character) => character !== correct);
  if (pool.length < 2) throw new TypeError(`Not enough kanji distractors for ${entry.id}.`);
  const start = hash(`${entry.id}.${index}.${salt}`) % pool.length;
  const values = [correct, pool[start], pool[(start + Math.max(1, Math.floor(pool.length / 2))) % pool.length]];
  const shift = hash(`${index}.${entry.id}.${salt}`) % values.length;
  const options = values.map((_, optionIndex) => values[(optionIndex + shift) % values.length]).map((character) => ({
    id: `${entry.id}.character.${index}.${character}`,
    label: character,
    correct: character === correct
  }));
  return validateOptionSet(options, `Kanji card ${entry.id}.${index}`);
}

export function generatedOptionsForAttempt(item, readings, attempt = 0) {
  if (!item?.wordId) return item.options;
  const entry = readings.entries.find((candidate) => candidate.id === item.wordId);
  if (!entry) throw new TypeError(`Unknown generated-card word ${item.wordId}.`);
  const salt = Math.max(0, Number.isInteger(attempt) ? attempt : 0);
  if (item.mode === "reading") return orderedOptions(entry, readings, salt);
  if (item.mode === "listening") {
    return facetOptions(entry, readings, {
      facet: "listening-comprehension",
      labelFor: (candidate) => candidate.meaning,
      diagnosticFor: (candidate) => [wordMeaningSkillId(candidate)],
      salt
    });
  }
  if (item.mode === "word-form") {
    return facetOptions(entry, readings, {
      facet: "written-form",
      labelFor: (candidate) => candidate.term,
      diagnosticFor: (candidate) => [readingSkillId(candidate)],
      salt
    });
  }
  if (item.mode === "word-meaning") {
    return facetOptions(entry, readings, {
      facet: "meaning-recognition",
      labelFor: (candidate) => candidate.meaning,
      diagnosticFor: (candidate) => [wordMeaningSkillId(candidate)],
      salt
    });
  }
  if (item.mode === "word-recall") {
    return facetOptions(entry, readings, {
      facet: "meaning-recall",
      labelFor: (candidate) => candidate.term,
      diagnosticFor: (candidate) => [wordMeaningSkillId(candidate)],
      salt
    });
  }
  if (item.mode === "kanji") {
    const index = Number(item.id.split(".").at(-1));
    return characterOptions(entry, index, readings, salt);
  }
  return item.options;
}

export function createReadingCharacterItems(readings, contentPack) {
  const scenarios = new Map(contentPack.scenarios.map((scenario) => [scenario.id, scenario]));
  return readings.entries.flatMap((entry) => {
    const characters = kanjiCharacters(entry.term);
    if (characters.length < 2) return [];
    if (entry.kanjiParts && (
      entry.kanjiParts.length !== characters.length
      || entry.kanjiParts.some((part, index) => part.character !== characters[index] || !part.sound)
    )) {
      throw new TypeError(`Invalid kanjiParts for reading entry ${entry.id}.`);
    }
    const scenario = scenarios.get(entry.scenarioId) ?? contentPack.scenarios[0];
    return characters.map((character, index) => {
      const authored = entry.kanjiParts?.[index];
      const sound = authored?.character === character ? authored.sound : null;
      return {
        id: `reading-character-card.${entry.id}.${index}`,
        skillId: readingCharacterSkillId(entry, index),
        mode: "kanji",
        facet: "kanji-position",
        wordId: entry.id,
        remediationOnly: true,
        breakdownLeaf: true,
        priority: entry.priority ?? 0.9,
        prompt: `${entry.reading} → ${maskKanji(entry.term, index)}`,
        instruction: `Choose kanji ${index + 1} of ${characters.length} to rebuild the written word.`,
        options: characterOptions(entry, index, readings),
        answer: {
          ja: entry.term,
          reading: entry.reading,
          meaning: sound
            ? `${character} is kanji ${index + 1} of ${characters.length}; in this specific word it aligns with ${sound}.`
            : `${character} is kanji ${index + 1} of ${characters.length} in the complete word ${entry.term}.`,
          note: sound
            ? `Treat ${character} → ${sound} as a context cue for ${entry.term}, not a universal reading of ${character}.`
            : `This checks the written shape and position. Keep ${entry.reading} attached to the complete word rather than guessing a standalone reading.`
        },
        zoom: {
          context: `${entry.term}（${entry.reading}）`,
          breakdown: `${maskKanji(entry.term, index)} → ${entry.term}`
        },
        scenarioId: scenario.id,
        scenarioTitle: scenario.title,
        scenarioPurpose: scenario.purpose
      };
    });
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
