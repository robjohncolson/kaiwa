import { probabilityKnown } from "./mastery.js";
import { getRoleplayConfig, requestRoleplay } from "./providers/llm.js";
import {
  augmentTreeWithReadings,
  readingEntriesIn,
  readingSkillId,
  tokenizeReadings
} from "./readings.js";
import { applyObservation, flattenItems, selectNextItem } from "./scheduler.js";
import { clearState, createInitialState, loadState, saveState } from "./store.js";

const dom = {
  loading: document.querySelector("#loading"),
  app: document.querySelector("#practice-app"),
  error: document.querySelector("#error"),
  placeholder: document.querySelector("#placeholder-warning"),
  progress: document.querySelector("#progress"),
  sheetOpen: document.querySelector("#sheet-open"),
  sheetDialog: document.querySelector("#phone-sheet"),
  sheetScenario: document.querySelector("#sheet-scenario"),
  sheetPurpose: document.querySelector("#sheet-purpose"),
  sheetLines: document.querySelector("#sheet-lines"),
  abortOpen: document.querySelector("#abort-open"),
  abortDialog: document.querySelector("#abort-dialog"),
  abortJapanese: document.querySelector("#abort-japanese"),
  abortMeaning: document.querySelector("#abort-meaning"),
  routeScenario: document.querySelector("#route-scenario"),
  routeMinutes: document.querySelector("#route-minutes"),
  routeApply: document.querySelector("#route-apply"),
  routeClear: document.querySelector("#route-clear"),
  routeSummary: document.querySelector("#route-summary"),
  scenario: document.querySelector("#scenario"),
  mode: document.querySelector("#mode"),
  purpose: document.querySelector("#purpose"),
  prompt: document.querySelector("#prompt"),
  instruction: document.querySelector("#instruction"),
  furiganaStatus: document.querySelector("#furigana-status"),
  furiganaHelp: document.querySelector("#furigana-help"),
  options: document.querySelector("#options"),
  reveal: document.querySelector("#reveal"),
  answer: document.querySelector("#answer"),
  japanese: document.querySelector("#japanese"),
  reading: document.querySelector("#reading"),
  meaning: document.querySelector("#meaning"),
  note: document.querySelector("#note"),
  wordZoom: document.querySelector("#word-zoom"),
  zoomContext: document.querySelector("#zoom-context"),
  zoomBreakdown: document.querySelector("#zoom-breakdown"),
  result: document.querySelector("#recognition-result"),
  nextCard: document.querySelector("#next-card"),
  evidence: document.querySelector("#evidence"),
  roleplayStatus: document.querySelector("#roleplay-status"),
  roleplayScenario: document.querySelector("#roleplay-scenario"),
  roleplayReset: document.querySelector("#roleplay-reset"),
  roleplayTranscript: document.querySelector("#roleplay-transcript"),
  roleplayLines: document.querySelector("#roleplay-lines"),
  roleplayInput: document.querySelector("#roleplay-input"),
  roleplaySend: document.querySelector("#roleplay-send"),
  roleplayError: document.querySelector("#roleplay-error"),
  roleplayObservation: document.querySelector("#roleplay-observation"),
  roleplayGuidance: document.querySelector("#roleplay-guidance"),
  roleplayOutcomes: document.querySelector("#roleplay-outcomes"),
  roleplayApply: document.querySelector("#roleplay-apply"),
  roleplayDiscard: document.querySelector("#roleplay-discard"),
  reset: document.querySelector("#reset"),
  toast: document.querySelector("#toast")
};

let content;
let tree;
let readings;
let items;
let readingSkillIds;
let state;
let currentItem;
let answered = false;
let roleplayAvailable = false;
let roleplayHistory = [];
let pendingRoleplayResult = null;
let forcedFurigana = new Set();

function showReadingFor(entry) {
  const skill = state.skills[readingSkillId(entry)];
  return !skill || probabilityKnown(skill) < readings.furiganaThreshold;
}

function renderJapanese(element, value, { alwaysShow = false, neverShow = false } = {}) {
  element.replaceChildren();
  for (const segment of tokenizeReadings(value, readings)) {
    if (!segment.entry) {
      element.append(document.createTextNode(segment.text));
      continue;
    }

    const ruby = document.createElement("ruby");
    const base = document.createElement("span");
    const reading = document.createElement("rt");
    base.textContent = segment.text;
    reading.textContent = segment.entry.reading;
    const visible = alwaysShow || (!neverShow && (
      forcedFurigana.has(segment.entry.id) || showReadingFor(segment.entry)
    ));
    ruby.classList.toggle("furigana-hidden", !visible);
    ruby.dataset.readingSkill = readingSkillId(segment.entry);
    reading.setAttribute("aria-hidden", String(!visible));
    ruby.append(base, reading);
    element.append(ruby);
  }
}

function renderRubyParts(element, parts) {
  element.replaceChildren();
  for (const part of parts) {
    if (!part.reading) {
      element.append(document.createTextNode(part.text));
      continue;
    }
    const ruby = document.createElement("ruby");
    const base = document.createElement("span");
    const reading = document.createElement("rt");
    base.textContent = part.text;
    reading.textContent = part.reading;
    ruby.append(base, reading);
    element.append(ruby);
  }
}

function scenarioById(id) {
  return content.scenarios.find((scenario) => scenario.id === id);
}

function renderPhoneSheet(scenarioId) {
  const scenario = scenarioById(scenarioId) ?? content.scenarios[0];
  dom.sheetScenario.value = scenario.id;
  dom.sheetPurpose.textContent = scenario.purpose;
  dom.sheetLines.replaceChildren();

  for (const line of scenario.allowedUserLines) {
    const card = document.createElement("article");
    card.className = line.skillId === scenario.abortSkillId
      ? "sheet-line sheet-line-abort"
      : "sheet-line";

    const japanese = document.createElement("p");
    japanese.className = "sheet-japanese";
    japanese.lang = "ja";
    renderJapanese(japanese, line.ja, { alwaysShow: true });

    const meaning = document.createElement("p");
    meaning.className = "sheet-meaning";
    renderJapanese(meaning, line.meaning, { alwaysShow: true });

    card.append(japanese, meaning);
    dom.sheetLines.append(card);
  }
}

function populateSafetyTools() {
  for (const scenario of content.scenarios) {
    const option = document.createElement("option");
    option.value = scenario.id;
    option.textContent = scenario.title;
    dom.sheetScenario.append(option);
  }

  const abortLine = content.scenarios
    .flatMap((scenario) => scenario.allowedUserLines)
    .find((line) => line.skillId === "abort.wakarimasen");
  renderJapanese(dom.abortJapanese, abortLine.ja, { alwaysShow: true });
  dom.abortMeaning.textContent = abortLine.meaning;
  renderPhoneSheet(content.scenarios[0].id);
}

function appendTranscript(role, japanese, meaning = "", rubyParts = null) {
  const message = document.createElement("article");
  message.className = `transcript-message transcript-${role}`;

  const label = document.createElement("p");
  label.className = "transcript-label";
  label.textContent = role === "user" ? "You" : "Partner";
  const text = document.createElement("p");
  text.className = "transcript-japanese";
  text.lang = "ja";
  if (rubyParts) renderRubyParts(text, rubyParts);
  else renderJapanese(text, japanese, { alwaysShow: true });
  message.append(label, text);

  if (meaning) {
    const translation = document.createElement("p");
    translation.className = "transcript-meaning";
    renderJapanese(translation, meaning, { alwaysShow: true });
    message.append(translation);
  }
  dom.roleplayTranscript.append(message);
  message.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderRoleplayLines() {
  const scenario = scenarioById(dom.roleplayScenario.value);
  dom.roleplayLines.replaceChildren();
  for (const line of scenario.allowedUserLines) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = line.skillId === scenario.abortSkillId
      ? "line-chip line-chip-abort"
      : "line-chip";
    renderJapanese(button, line.ja, { alwaysShow: true });
    button.disabled = !roleplayAvailable;
    button.addEventListener("click", () => {
      dom.roleplayInput.value = line.ja;
      dom.roleplayInput.focus();
    });
    dom.roleplayLines.append(button);
  }
}

function resetRoleplay() {
  roleplayHistory = [];
  pendingRoleplayResult = null;
  dom.roleplayTranscript.replaceChildren();
  dom.roleplayObservation.hidden = true;
  dom.roleplayError.hidden = true;
  dom.roleplayInput.value = "";
  renderRoleplayLines();
}

function renderRoleplayObservation(result) {
  pendingRoleplayResult = result;
  dom.roleplayOutcomes.replaceChildren();
  for (const observation of result.observations) {
    const entry = document.createElement("li");
    entry.textContent = `${skillLabel(observation.skillId)}: ${observation.outcome.replace("_", " ")}`;
    entry.dataset.outcome = observation.outcome;
    dom.roleplayOutcomes.append(entry);
  }
  const guidance = [];
  if (result.shouldAbort) guidance.push("The sensor recommends using the abort line.");
  if (result.hint) guidance.push(result.hint);
  dom.roleplayGuidance.textContent = guidance.join(" ");
  dom.roleplayGuidance.hidden = guidance.length === 0;
  dom.roleplayObservation.hidden = false;
}

async function sendRoleplayTurn() {
  const userText = dom.roleplayInput.value.trim();
  if (!userText || !roleplayAvailable) return;

  const priorHistory = [...roleplayHistory];
  dom.roleplaySend.disabled = true;
  dom.roleplaySend.textContent = "Waiting for partner…";
  dom.roleplayError.hidden = true;
  dom.roleplayObservation.hidden = true;
  appendTranscript("user", userText);
  dom.roleplayInput.value = "";

  try {
    const result = await requestRoleplay({
      scenarioId: dom.roleplayScenario.value,
      history: priorHistory,
      userText
    });
    appendTranscript("assistant", result.staffReply.ja, result.staffReply.meaning, result.staffReply.parts);
    roleplayHistory = [
      ...priorHistory,
      { role: "user", content: userText },
      { role: "assistant", content: result.staffReply.ja }
    ].slice(-12);
    renderRoleplayObservation(result);
  } catch (error) {
    dom.roleplayError.textContent = error.message;
    dom.roleplayError.hidden = false;
  } finally {
    dom.roleplaySend.disabled = false;
    dom.roleplaySend.textContent = "Send practice turn";
  }
}

function applyRoleplayObservations() {
  if (!pendingRoleplayResult) return;
  let applied = 0;
  for (const observation of pendingRoleplayResult.observations) {
    if (observation.outcome === "not_tested") continue;
    state = applyObservation(state, {
      id: `roleplay.${observation.skillId}.${Date.now()}`,
      skillId: observation.skillId
    }, observation.outcome === "success", Date.now() + applied, { source: "roleplay" });
    applied += 1;
  }

  if (applied > 0) {
    saveState(state);
    renderCard();
    showToast(`${applied} roleplay ${applied === 1 ? "observation" : "observations"} applied`);
  } else {
    showToast("No tested outcomes to apply");
  }
  pendingRoleplayResult = null;
  dom.roleplayObservation.hidden = true;
}

async function setupRoleplay() {
  for (const scenario of content.scenarios) {
    const option = document.createElement("option");
    option.value = scenario.id;
    option.textContent = scenario.title;
    dom.roleplayScenario.append(option);
  }
  resetRoleplay();

  try {
    const config = await getRoleplayConfig();
    roleplayAvailable = config.available;
    dom.roleplayStatus.textContent = config.available ? `Ready · ${config.model}` : "Not configured";
    dom.roleplayStatus.classList.toggle("ready", config.available);
    dom.roleplayInput.disabled = !config.available;
    dom.roleplaySend.disabled = !config.available;
    if (!config.available) {
      dom.roleplayError.textContent = config.reason;
      dom.roleplayError.hidden = false;
    }
  } catch {
    roleplayAvailable = false;
    dom.roleplayStatus.textContent = "Proxy unavailable";
    dom.roleplayInput.disabled = true;
    dom.roleplaySend.disabled = true;
    dom.roleplayError.textContent = "Run the Node server to enable optional roleplay. Offline drills still work.";
    dom.roleplayError.hidden = false;
  }
  renderRoleplayLines();
}

function showToast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.add("visible");
  window.setTimeout(() => dom.toast.classList.remove("visible"), 1400);
}

function skillLabel(skillId) {
  return tree.nodes.find((node) => node.id === skillId)?.label ?? skillId;
}

function showAnswer(resultText = "") {
  answered = true;
  dom.answer.hidden = false;
  dom.reveal.hidden = true;
  dom.nextCard.hidden = false;
  dom.result.textContent = resultText;
}

function renderOptions(item) {
  dom.options.replaceChildren();

  for (const option of item.options) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "option-button";
    renderJapanese(button, option.label, {
      neverShow: item.mode === "reading" || item.mode === "focus"
    });
    button.dataset.correct = String(option.correct);
    button.addEventListener("click", () => {
      if (answered) return;
      state = applyObservation(state, item, option.correct);
      saveState(state);
      for (const sibling of dom.options.children) {
        sibling.disabled = true;
        if (sibling.dataset.correct === "true") sibling.classList.add("correct");
      }
      button.classList.add(option.correct ? "correct" : "incorrect");
      showAnswer(option.correct ? "Correct — BKT updated." : "Not this one — BKT recorded a miss.");
      renderEvidence();
      renderProgress();
    });
    dom.options.append(button);
  }
}

function renderPromptFurigana() {
  const isReadingTest = currentItem.mode === "reading" || currentItem.mode === "focus";
  renderJapanese(dom.prompt, currentItem.prompt, { neverShow: isReadingTest });
  const entries = readingEntriesIn(currentItem.prompt, readings);

  if (isReadingTest) {
    dom.furiganaStatus.textContent = "Reading test · furigana hidden until the answer";
    dom.furiganaHelp.hidden = true;
    return;
  }
  if (entries.length === 0) {
    dom.furiganaStatus.textContent = "No kanji reading in this prompt";
    dom.furiganaHelp.hidden = true;
    return;
  }

  const retired = entries.filter((entry) => !showReadingFor(entry) && !forcedFurigana.has(entry.id));
  const shown = entries.length - retired.length;
  dom.furiganaStatus.textContent = `${shown} supported · ${retired.length} retired by reading BKT`;
  dom.furiganaHelp.hidden = retired.length === 0;
  dom.furiganaHelp.textContent = `Show ${retired.length} retired ${retired.length === 1 ? "reading" : "readings"}`;
}

function showRetiredFurigana() {
  const entries = readingEntriesIn(currentItem.prompt, readings)
    .filter((entry) => !showReadingFor(entry) && !forcedFurigana.has(entry.id));
  if (entries.length === 0) return;

  const now = Date.now();
  for (const [index, entry] of entries.entries()) {
    state = applyObservation(state, {
      id: `hint.${entry.id}.${now}`,
      skillId: readingSkillId(entry),
      options: [{}, {}, {}]
    }, false, now + index, { source: "hint" });
    forcedFurigana.add(entry.id);
  }
  saveState(state);
  renderPromptFurigana();
  renderProgress();
  showToast(`${entries.length} reading ${entries.length === 1 ? "hint" : "hints"} recorded`);
}

function recordUnsure() {
  if (answered) return;
  state = applyObservation(state, currentItem, false);
  saveState(state);
  for (const button of dom.options.children) {
    button.disabled = true;
    if (button.dataset.correct === "true") button.classList.add("correct");
  }
  showAnswer("Shown as a miss — uncertainty is evidence too.");
  renderEvidence();
  renderProgress();
}

function renderEvidence() {
  const skill = state.skills[currentItem.skillId];
  const known = Math.round(probabilityKnown(skill) * 100);
  dom.evidence.textContent = `BKT estimate ${known}% known · ${skill.correct} correct / ${skill.incorrect} missed · ${skill.attempts} observations`;
}

function renderProgress() {
  const reviewLabel = state.totalReviews === 1 ? "review" : "reviews";
  const readingIds = [...readingSkillIds];
  const phraseIds = tree.nodes.map((node) => node.id).filter((id) => !readingSkillIds.has(id));
  const readingSeen = readingIds.filter((id) => state.skills[id]?.attempts > 0).length;
  const phraseSeen = phraseIds.filter((id) => state.skills[id]?.attempts > 0).length;
  dom.progress.textContent = `${state.totalReviews} ${reviewLabel} · phrases ${phraseSeen}/${phraseIds.length} · readings ${readingSeen}/${readingIds.length} · saved here`;
}

function renderRoute() {
  const routeScenario = scenarioById(state.route.scenarioId);
  if (!routeScenario || !state.route.eventAt) {
    dom.routeSummary.textContent = "No next-event boost set.";
    dom.routeClear.hidden = true;
    return;
  }

  const minutes = Math.round((state.route.eventAt - Date.now()) / 60000);
  dom.routeSummary.textContent = minutes > 0
    ? `Boosting ${routeScenario.title} — event in about ${minutes} min.`
    : `${routeScenario.title} event time passed — boost is inactive.`;
  dom.routeClear.hidden = false;
  dom.routeScenario.value = routeScenario.id;
}

function renderCard() {
  currentItem = selectNextItem(items, tree, state);
  if (!currentItem) {
    throw new Error("No practice item is available. Check the skill DAG and content pack.");
  }

  answered = false;
  forcedFurigana = new Set();
  dom.answer.hidden = true;
  dom.reveal.hidden = false;
  dom.nextCard.hidden = true;
  dom.result.textContent = "";
  dom.scenario.textContent = currentItem.scenarioTitle;
  dom.mode.textContent = {
    meaning: "Japanese → meaning",
    reply: "Staff → reply",
    focus: "Word zoom",
    reading: "Kanji → reading"
  }[currentItem.mode] ?? "Recognition";
  dom.purpose.textContent = currentItem.scenarioPurpose;
  dom.prompt.lang = "ja";
  dom.prompt.classList.add("japanese-prompt");
  dom.prompt.classList.toggle("focus-prompt", ["focus", "reading"].includes(currentItem.mode));
  dom.instruction.textContent = currentItem.instruction ?? "Choose the best answer.";
  renderPromptFurigana();
  renderJapanese(dom.japanese, currentItem.answer.ja, { alwaysShow: true });
  dom.reading.textContent = currentItem.answer.reading ?? "";
  dom.reading.hidden = !currentItem.answer.reading
    || currentItem.answer.reading === currentItem.answer.ja;
  renderJapanese(dom.meaning, currentItem.answer.meaning, { alwaysShow: true });
  renderJapanese(dom.note, currentItem.answer.note ?? "", { alwaysShow: true });
  dom.wordZoom.hidden = !currentItem.zoom;
  renderJapanese(dom.zoomContext, currentItem.zoom?.context ?? "", { alwaysShow: true });
  renderJapanese(dom.zoomBreakdown, currentItem.zoom?.breakdown ?? "", { alwaysShow: true });
  renderOptions(currentItem);
  renderEvidence();
  renderProgress();
  renderRoute();
}

function populateRouteScenarios() {
  for (const scenario of content.scenarios.filter((entry) => entry.id !== "essentials")) {
    const option = document.createElement("option");
    option.value = scenario.id;
    option.textContent = scenario.title;
    dom.routeScenario.append(option);
  }
}

function bindEvents() {
  dom.sheetOpen.addEventListener("click", () => {
    renderPhoneSheet(currentItem?.scenarioId);
    dom.sheetDialog.showModal();
  });
  dom.sheetScenario.addEventListener("change", () => {
    renderPhoneSheet(dom.sheetScenario.value);
  });
  dom.abortOpen.addEventListener("click", () => dom.abortDialog.showModal());
  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelector(`#${button.dataset.closeDialog}`).close();
    });
  });
  dom.roleplayScenario.addEventListener("change", resetRoleplay);
  dom.roleplayReset.addEventListener("click", resetRoleplay);
  dom.roleplaySend.addEventListener("click", sendRoleplayTurn);
  dom.roleplayInput.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") sendRoleplayTurn();
  });
  dom.roleplayApply.addEventListener("click", applyRoleplayObservations);
  dom.roleplayDiscard.addEventListener("click", () => {
    pendingRoleplayResult = null;
    dom.roleplayObservation.hidden = true;
    showToast("Sensor observation discarded");
  });
  dom.reveal.addEventListener("click", recordUnsure);
  dom.furiganaHelp.addEventListener("click", showRetiredFurigana);
  dom.nextCard.addEventListener("click", renderCard);
  dom.routeApply.addEventListener("click", () => {
    const minutes = Number(dom.routeMinutes.value);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
      showToast("Use 1–1440 minutes");
      return;
    }
    state = {
      ...state,
      route: {
        scenarioId: dom.routeScenario.value,
        eventAt: Date.now() + minutes * 60000
      }
    };
    saveState(state);
    renderCard();
  });
  dom.routeClear.addEventListener("click", () => {
    state = { ...state, route: { scenarioId: null, eventAt: null } };
    saveState(state);
    renderCard();
  });
  dom.reset.addEventListener("click", () => {
    if (!window.confirm("Reset all Kaiwa practice progress on this device?")) return;
    clearState();
    state = createInitialState(tree);
    saveState(state);
    renderCard();
    showToast("Progress reset");
  });
}

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`);
  return response.json();
}

async function start() {
  try {
    [content, tree, readings] = await Promise.all([
      loadJson("./data/scenarios.json"),
      loadJson("./data/tree.json"),
      loadJson("./data/readings.json")
    ]);
    tree = augmentTreeWithReadings(tree, readings);
    readingSkillIds = new Set(readings.entries.map(readingSkillId));
    items = flattenItems(content, readings);
    state = loadState(tree);

    const name = content.placeholders.nameKatakana;
    dom.placeholder.textContent = `${name.value} is an unconfirmed placeholder. Replace it with the exact reservation name.`;
    dom.placeholder.hidden = name.confirmed;

    populateRouteScenarios();
    populateSafetyTools();
    bindEvents();
    renderCard();
    dom.loading.hidden = true;
    dom.app.hidden = false;
    setupRoleplay();
  } catch (error) {
    console.error(error);
    dom.loading.hidden = true;
    dom.error.hidden = false;
    dom.error.textContent = `${error.message} Run Kaiwa through the documented local server, not file://.`;
  }
}

start();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.info("Offline install is unavailable in this browser context.", error);
    });
  });
}
