import { probabilityKnown, skillIsReady } from "./mastery.js";
import { buildSkillMap, practiceTargetFor } from "./map.js";
import {
  advanceMissionRun,
  answerMissionStep,
  createMissionRun,
  gradeProductionStep,
  missionById,
  missionLineIndex,
  recordMissionCompletion,
  revealProductionAnswer,
  revealMissionHint,
  validateMissionPack
} from "./mission.js";
import { fieldCounts, latestFieldOutcome, recordFieldOutcome } from "./field.js";
import { ABORT_TARGET_MS, applyProductionObservation, productionIsReady } from "./production.js";
import {
  archiveCompletedRepair,
  beginRepairRevisit,
  buildRepairSession,
  completeRepairRound,
  currentRepairCard,
  recordRepairCard,
  repairHandledFieldEvent,
  REPAIRABLE_FIELD_OUTCOMES
} from "./repair.js";
import { getRoleplayConfig, requestRoleplay } from "./providers/llm.js";
import {
  augmentTreeWithReadings,
  readingIsReady,
  readingEntriesIn,
  readingSkillId,
  tokenizeReadings
} from "./readings.js";
import { applyObservation, flattenItems, selectNextItem } from "./scheduler.js";
import {
  archiveCompletedSession,
  buildGuidedSession,
  completeGuidedSession,
  currentSessionCard,
  recordSessionCard,
  summarizeGuidedSession
} from "./session.js";
import {
  clearState,
  createInitialState,
  createProgressBackup,
  loadState,
  restoreProgressBackup,
  saveState
} from "./store.js";

const dom = {
  loading: document.querySelector("#loading"),
  app: document.querySelector("#practice-app"),
  error: document.querySelector("#error"),
  placeholder: document.querySelector("#placeholder-warning"),
  progress: document.querySelector("#progress"),
  focusBanner: document.querySelector("#focus-banner"),
  focusSummary: document.querySelector("#focus-summary"),
  focusClear: document.querySelector("#focus-clear"),
  mapOpen: document.querySelector("#map-open"),
  mapDialog: document.querySelector("#skill-map-dialog"),
  mapNext: document.querySelector("#map-next"),
  mapClearFocus: document.querySelector("#map-clear-focus"),
  mapDetail: document.querySelector("#map-detail"),
  mapIslands: document.querySelector("#map-islands"),
  sessionOpen: document.querySelector("#session-open"),
  sessionSummary: document.querySelector("#session-summary"),
  sessionDialog: document.querySelector("#session-dialog"),
  sessionTitle: document.querySelector("#session-title"),
  sessionSetup: document.querySelector("#session-setup"),
  sessionPlan: document.querySelector("#session-plan"),
  sessionStart: document.querySelector("#session-start"),
  sessionActive: document.querySelector("#session-active"),
  sessionProgress: document.querySelector("#session-progress"),
  sessionStagePhrases: document.querySelector("#session-stage-phrases"),
  sessionStageReadings: document.querySelector("#session-stage-readings"),
  sessionStageMission: document.querySelector("#session-stage-mission"),
  sessionContinue: document.querySelector("#session-continue"),
  sessionEnd: document.querySelector("#session-end"),
  sessionComplete: document.querySelector("#session-complete"),
  sessionOutcome: document.querySelector("#session-outcome"),
  sessionCompleteTitle: document.querySelector("#session-complete-title"),
  sessionCompleteMetrics: document.querySelector("#session-complete-metrics"),
  sessionResults: document.querySelector("#session-results"),
  sessionAgain: document.querySelector("#session-again"),
  missionOpen: document.querySelector("#mission-open"),
  missionSummary: document.querySelector("#mission-summary"),
  missionDialog: document.querySelector("#mission-dialog"),
  missionTitle: document.querySelector("#mission-title"),
  missionSetup: document.querySelector("#mission-setup"),
  missionSelect: document.querySelector("#mission-select"),
  missionPurpose: document.querySelector("#mission-purpose"),
  missionHistory: document.querySelector("#mission-history"),
  missionMode: document.querySelector("#mission-mode"),
  missionChallenge: document.querySelector("#mission-challenge"),
  missionStart: document.querySelector("#mission-start"),
  missionRun: document.querySelector("#mission-run"),
  missionProgress: document.querySelector("#mission-progress"),
  missionKind: document.querySelector("#mission-kind"),
  missionInstruction: document.querySelector("#mission-instruction"),
  missionPrompt: document.querySelector("#mission-prompt"),
  missionFuriganaStatus: document.querySelector("#mission-furigana-status"),
  missionPromptMeaning: document.querySelector("#mission-prompt-meaning"),
  missionHint: document.querySelector("#mission-hint"),
  missionTimer: document.querySelector("#mission-timer"),
  missionProductionReveal: document.querySelector("#mission-production-reveal"),
  missionOptions: document.querySelector("#mission-options"),
  missionFeedback: document.querySelector("#mission-feedback"),
  missionFeedbackTitle: document.querySelector("#mission-feedback-title"),
  missionCorrectLine: document.querySelector("#mission-correct-line"),
  missionCorrectMeaning: document.querySelector("#mission-correct-meaning"),
  missionProductionGrades: document.querySelector("#mission-production-grades"),
  missionAdvance: document.querySelector("#mission-advance"),
  missionEnd: document.querySelector("#mission-end"),
  missionComplete: document.querySelector("#mission-complete"),
  missionOutcome: document.querySelector("#mission-outcome"),
  missionCompleteTitle: document.querySelector("#mission-complete-title"),
  missionCompleteSummary: document.querySelector("#mission-complete-summary"),
  missionSkillResults: document.querySelector("#mission-skill-results"),
  missionCompleteMetrics: document.querySelector("#mission-complete-metrics"),
  missionPracticeWeakest: document.querySelector("#mission-practice-weakest"),
  missionAgain: document.querySelector("#mission-again"),
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
  fieldScenario: document.querySelector("#field-scenario"),
  fieldSummary: document.querySelector("#field-summary"),
  repairLauncher: document.querySelector("#repair-launcher"),
  repairLaunchTitle: document.querySelector("#repair-launch-title"),
  repairSummary: document.querySelector("#repair-summary"),
  repairOpen: document.querySelector("#repair-open"),
  repairDialog: document.querySelector("#repair-dialog"),
  repairTitle: document.querySelector("#repair-title"),
  repairStatus: document.querySelector("#repair-status"),
  repairStageRecognition: document.querySelector("#repair-stage-recognition"),
  repairStageReading: document.querySelector("#repair-stage-reading"),
  repairStageProduction: document.querySelector("#repair-stage-production"),
  repairStageAbort: document.querySelector("#repair-stage-abort"),
  repairStageRevisit: document.querySelector("#repair-stage-revisit"),
  repairAction: document.querySelector("#repair-action"),
  repairEnd: document.querySelector("#repair-end"),
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
  progressExport: document.querySelector("#progress-export"),
  progressImportOpen: document.querySelector("#progress-import-open"),
  progressImport: document.querySelector("#progress-import"),
  reset: document.querySelector("#reset"),
  toast: document.querySelector("#toast")
};

let content;
let tree;
let readings;
let missionPack;
let missionLines;
let items;
let readingSkillIds;
let state;
let currentItem;
let answered = false;
let roleplayAvailable = false;
let roleplayHistory = [];
let pendingRoleplayResult = null;
let forcedFurigana = new Set();
let selectedMapSkillId = null;
let completedMissionRun = null;
let completedMissionWeakestSkillId = null;
let missionTimerId = null;
let repairTimerId = null;

function showReadingFor(entry) {
  const skill = state.skills[readingSkillId(entry)];
  return !skill || !readingIsReady(readings, skill);
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
    const label = document.createElement("span");
    renderJapanese(label, skillLabel(observation.skillId));
    entry.append(label, document.createTextNode(`: ${observation.outcome.replace("_", " ")}`));
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

const fieldOutcomeLabels = {
  worked: "Worked",
  phone_sheet: "Used phone sheet",
  aborted: "Aborted safely",
  failed: "Failed"
};

function guidedSession() {
  return state.session?.active ?? null;
}

function guidedMission(session = guidedSession()) {
  return missionById(missionPack, session?.missionId);
}

function repairSession() {
  return state.repair?.active ?? null;
}

function missionForId(missionId) {
  const repair = repairSession();
  if (repair?.mission?.id === missionId) return repair.mission;
  return missionById(missionPack, missionId);
}

function renderSessionLauncher() {
  const session = guidedSession();
  if (!session) {
    dom.sessionSummary.textContent = "3 recognition cards · 3 no-furigana readings · 1 speak-first mission";
    dom.sessionOpen.textContent = "Start session";
    return;
  }
  if (session.phase === "cards") {
    dom.sessionSummary.textContent = `${session.outcomes.length}/${session.cardIds.length} cards complete · progress survives refresh`;
    dom.sessionOpen.textContent = "Continue session";
    return;
  }
  if (session.phase === "mission") {
    dom.sessionSummary.textContent = `Cards complete · speak next: ${guidedMission(session)?.title ?? "closed-loop mission"}`;
    dom.sessionOpen.textContent = state.mission.active ? "Resume mission" : "Run mission";
    return;
  }
  dom.sessionSummary.textContent = `${session.outcomes.filter((outcome) => outcome.correct).length}/${session.cardIds.length} cards · mission ${session.missionOutcome ?? "complete"}`;
  dom.sessionOpen.textContent = "View summary";
}

function setStageStatus(element, status) {
  element.dataset.status = status;
}

function renderSessionSetup() {
  const preview = buildGuidedSession({ items, tree, readings, missionPack, state });
  const mission = guidedMission(preview);
  dom.sessionTitle.textContent = "About five minutes.";
  dom.sessionSetup.hidden = false;
  dom.sessionActive.hidden = true;
  dom.sessionComplete.hidden = true;
  dom.sessionPlan.textContent = `Kaiwa will finish with a speak-first “${mission.title},” selected from weak skills, route urgency, mission history, and field results.`;
}

function renderSessionActive(session) {
  const phraseDone = session.outcomes.filter((outcome) => outcome.mode !== "reading").length;
  const readingDone = session.outcomes.filter((outcome) => outcome.mode === "reading").length;
  const phraseTotal = session.phraseSkillIds.length;
  const readingTotal = session.readingSkillIds.length;
  dom.sessionTitle.textContent = "Guided session in progress.";
  dom.sessionSetup.hidden = true;
  dom.sessionActive.hidden = false;
  dom.sessionComplete.hidden = true;
  dom.sessionProgress.textContent = session.phase === "mission"
    ? `All ${session.cardIds.length} cards complete. Say the fixed lines in “${guidedMission(session)?.title ?? "the selected mission"}.”`
    : `Card ${session.outcomes.length + 1} of ${session.cardIds.length} · ${phraseDone} phrases and ${readingDone} readings complete`;
  setStageStatus(dom.sessionStagePhrases, phraseDone >= phraseTotal ? "done" : "current");
  setStageStatus(dom.sessionStageReadings, readingDone >= readingTotal
    ? "done"
    : phraseDone >= phraseTotal ? "current" : "upcoming");
  setStageStatus(dom.sessionStageMission, session.phase === "mission" ? "current" : "upcoming");
  dom.sessionContinue.textContent = session.phase === "mission"
    ? state.mission.active ? "Resume selected mission" : "Start selected mission"
    : "Continue cards";
}

function appendSessionDetail(titleText, detailText) {
  const item = document.createElement("li");
  const title = document.createElement("strong");
  title.textContent = titleText;
  const detail = document.createElement("span");
  detail.textContent = detailText;
  item.append(title, detail);
  dom.sessionResults.append(item);
}

function renderSessionComplete(session) {
  const summary = summarizeGuidedSession(session, { state, tree, readings, items });
  const seconds = Math.round(summary.durationMs / 1000);
  const duration = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  dom.sessionTitle.textContent = "Session result";
  dom.sessionSetup.hidden = true;
  dom.sessionActive.hidden = true;
  dom.sessionComplete.hidden = false;
  dom.sessionOutcome.textContent = `Mission ${summary.missionOutcome ?? "complete"}`;
  dom.sessionCompleteTitle.textContent = summary.missionOutcome === "clean"
    ? "Closed loop complete."
    : summary.missionOutcome === "recovered"
      ? "You recovered safely."
      : "The loop needs another run.";
  dom.sessionCompleteMetrics.textContent = `${duration} · four evidence channels kept separate · all progress saved locally`;
  dom.sessionResults.replaceChildren();
  appendSessionDetail(
    "Recognition",
    `${summary.phraseCorrect}/${summary.phraseTotal} correct. ${summary.newlyReadyPhrases.length} phrase${summary.newlyReadyPhrases.length === 1 ? "" : "s"} crossed the BKT readiness gate.`
  );
  const retired = summary.newlyRetiredReadings.map((item) => item.prompt).join(" · ");
  const needs = summary.needsFurigana.map((item) => item.prompt).join(" · ");
  appendSessionDetail(
    "Reading",
    `${summary.readingCorrect}/${summary.readingTotal} correct.${retired ? ` Furigana retired: ${retired}.` : " No new furigana retired."}${needs ? ` Still testing: ${needs}.` : ""}`
  );
  const production = summary.production;
  appendSessionDetail(
    "Production",
    production
      ? `${production.clean}/${production.total} said cleanly. Abort response: ${(production.abortResponseMs / 1000).toFixed(1)}s (target ≤ ${(ABORT_TARGET_MS / 1000).toFixed(0)}s). This did not change BKT.`
      : "No speak-first evidence recorded in this session."
  );
  const mission = guidedMission(session);
  const field = latestFieldOutcome(state.field, mission?.scenarioId);
  appendSessionDetail(
    "Real world",
    field
      ? `${fieldOutcomeLabels[field.outcome]} was last logged for this scenario. It influences priority, not mastery.`
      : "Not logged yet. After the real conversation, record whether it worked, needed the phone sheet, ended with the abort, or failed."
  );
}

function renderSessionDialog() {
  const session = guidedSession();
  if (!session) renderSessionSetup();
  else if (session.phase === "complete") renderSessionComplete(session);
  else renderSessionActive(session);
}

function openSessionDialog() {
  renderSessionDialog();
  dom.sessionDialog.showModal();
}

function startGuidedSession() {
  if (repairSession() && repairSession().phase !== "complete") {
    if (dom.sessionDialog.open) dom.sessionDialog.close();
    showToast("Finish or end the active field repair first");
    openRepairDialog();
    return;
  }
  if (state.mission.active) {
    if (dom.sessionDialog.open) dom.sessionDialog.close();
    showToast("Finish the active mission first");
    openMissionDialog();
    return;
  }
  const archived = archiveCompletedSession(state.session);
  const cleanState = { ...state, session: archived };
  const active = buildGuidedSession({ items, tree, readings, missionPack, state: cleanState });
  state = { ...cleanState, session: { ...archived, active } };
  saveState(state);
  if (dom.sessionDialog.open) dom.sessionDialog.close();
  renderCard();
  document.querySelector(".card").scrollIntoView({ behavior: "smooth", block: "start" });
  showToast("Five-minute session started");
}

function continueGuidedSession() {
  const session = guidedSession();
  if (!session) {
    startGuidedSession();
    return;
  }
  if (session.phase === "cards") {
    if (dom.sessionDialog.open) dom.sessionDialog.close();
    renderCard();
    document.querySelector(".card").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (session.phase === "mission") {
    if (dom.sessionDialog.open) dom.sessionDialog.close();
    if (state.mission.active?.missionId === session.missionId) openMissionDialog();
    else startMission(session.missionId, false, "production");
    return;
  }
  renderSessionDialog();
}

function endGuidedSession() {
  if (!window.confirm("End this guided session? Card and mission evidence already recorded will remain.")) return;
  state = { ...state, session: { ...state.session, active: null } };
  saveState(state);
  dom.sessionDialog.close();
  renderCard();
  showToast("Session ended; progress kept");
}

function statsForMission(missionId) {
  return state.mission.stats[missionId] ?? {
    runs: 0,
    cleanRuns: 0,
    safeRecoveries: 0,
    failedRuns: 0,
    recognitionRuns: 0,
    productionRuns: 0,
    noFuriganaRuns: 0,
    hints: 0,
    totalResponseMs: 0,
    recent: []
  };
}

function renderMissionSummary() {
  const allStats = Object.values(state.mission.stats);
  const totals = allStats.reduce((result, stats) => ({
    runs: result.runs + (stats.runs ?? 0),
    clean: result.clean + (stats.cleanRuns ?? 0),
    production: result.production + (stats.productionRuns ?? 0),
    noFurigana: result.noFurigana + (stats.noFuriganaRuns ?? 0)
  }), { runs: 0, clean: 0, production: 0, noFurigana: 0 });
  if (state.mission.active) {
    const active = missionForId(state.mission.active.missionId);
    dom.missionSummary.textContent = `Resume ${active?.title ?? "active mission"} · step ${state.mission.active.stepIndex + 1}`;
    dom.missionOpen.textContent = "Resume mission";
    return;
  }
  dom.missionSummary.textContent = totals.runs === 0
    ? `${missionPack.missions.length} fixed missions · speak first or recognize · no network`
    : `${totals.clean}/${totals.runs} clean · ${totals.production} speak-first · ${totals.noFurigana} without furigana`;
  dom.missionOpen.textContent = "Open missions";
}

function selectedMission() {
  return missionById(missionPack, dom.missionSelect.value) ?? missionPack.missions[0];
}

function renderMissionLobby() {
  const mission = selectedMission();
  const stats = statsForMission(mission.id);
  dom.missionTitle.textContent = "Closed-loop practice";
  dom.missionSetup.hidden = false;
  dom.missionRun.hidden = true;
  dom.missionComplete.hidden = true;
  dom.missionPurpose.textContent = mission.purpose;
  dom.missionStart.textContent = dom.missionMode.value === "production"
    ? "Start speak-first mission"
    : "Start recognition mission";
  dom.missionHistory.textContent = stats.runs === 0
    ? `${mission.steps.length} fixed turns. The final turn deliberately goes off script.`
    : `${stats.cleanRuns}/${stats.runs} clean · ${stats.productionRuns ?? 0} speak-first · ${stats.safeRecoveries} safe recoveries · ${stats.noFuriganaRuns} without furigana`;
}

function saveMissionRun(run) {
  state = {
    ...state,
    mission: { ...state.mission, active: run }
  };
  saveState(state);
  renderMissionSummary();
}

function missionStepEntries(step) {
  const choiceText = step.choiceSkillIds
    .map((skillId) => missionLines.get(skillId)?.ja ?? "")
    .join(" ");
  return readingEntriesIn(`${step.prompt} ${choiceText}`, readings);
}

function stopMissionTimer() {
  if (missionTimerId != null) window.clearInterval(missionTimerId);
  missionTimerId = null;
}

function updateMissionTimer(run, step, now = Date.now()) {
  if (run.mode !== "production" || run.productionRevealed || run.awaitingAdvance) {
    dom.missionTimer.hidden = true;
    return;
  }
  const elapsed = Math.max(0, now - run.stepStartedAt);
  const isAbort = step.targetSkillId === "abort.wakarimasen";
  dom.missionTimer.hidden = false;
  dom.missionTimer.classList.toggle("late", isAbort && elapsed > ABORT_TARGET_MS);
  dom.missionTimer.textContent = isAbort
    ? `${(elapsed / 1000).toFixed(1)}s · abort target ≤ ${(ABORT_TARGET_MS / 1000).toFixed(0)}s`
    : `${(elapsed / 1000).toFixed(1)}s · say the line before revealing`;
}

function startMissionTimer(run, step) {
  stopMissionTimer();
  updateMissionTimer(run, step);
  if (run.mode === "production" && !run.productionRevealed && !run.awaitingAdvance) {
    missionTimerId = window.setInterval(() => updateMissionTimer(run, step), 100);
  }
}

function renderMissionFeedback(run, mission, step) {
  const observation = run.observations.at(-1);
  const correctLine = missionLines.get(step.targetSkillId);
  dom.missionFeedback.hidden = false;
  if (run.mode === "production") {
    dom.missionFeedback.dataset.result = !run.awaitingAdvance
      ? "pending"
      : observation?.grade === "clean" ? "correct" : "incorrect";
    dom.missionFeedbackTitle.textContent = !run.awaitingAdvance
      ? `Compare with the fixed line · ${(run.productionResponseMs / 1000).toFixed(1)}s`
      : observation.grade === "clean"
        ? "Said cleanly — production evidence recorded. BKT unchanged."
        : observation.grade === "help"
          ? "Needed help — production evidence recorded. BKT unchanged."
          : "Miss — production evidence recorded. BKT unchanged.";
    dom.missionProductionGrades.hidden = run.awaitingAdvance;
    dom.missionAdvance.hidden = !run.awaitingAdvance;
  } else {
    dom.missionFeedback.dataset.result = observation.answerCorrect ? "correct" : "incorrect";
    dom.missionFeedbackTitle.textContent = observation.evidenceCorrect
      ? "Correct — unaided mission evidence recorded."
      : observation.answerCorrect
        ? "Correct with help — BKT records this as a miss."
        : "Not the fixed response — BKT records a miss.";
    dom.missionProductionGrades.hidden = true;
    dom.missionAdvance.hidden = false;
  }
  renderJapanese(dom.missionCorrectLine, correctLine.ja, { alwaysShow: true });
  dom.missionCorrectMeaning.textContent = correctLine.meaning;
  dom.missionAdvance.textContent = run.stepIndex === mission.steps.length - 1
    ? "Finish mission"
    : "Continue mission";
}

function revealProductionStep() {
  const active = state.mission.active;
  if (!active || active.mode !== "production" || active.productionRevealed) return;
  stopMissionTimer();
  saveMissionRun(revealProductionAnswer(active));
  renderMissionStep();
}

function gradeProductionChoice(grade) {
  const active = state.mission.active;
  const mission = missionForId(active?.missionId);
  if (!active || !mission || active.mode !== "production" || active.awaitingAdvance) return;
  const run = gradeProductionStep(active, mission, grade);
  state = applyProductionObservation(state, run.observations.at(-1));
  saveMissionRun(run);
  renderCard();
  renderMissionStep();
}

function answerMissionChoice(selectedSkillId) {
  const active = state.mission.active;
  const mission = missionForId(active?.missionId);
  if (!active || !mission || active.awaitingAdvance) return;
  const step = mission.steps[active.stepIndex];
  const run = answerMissionStep(active, mission, selectedSkillId);
  const observation = run.observations.at(-1);
  const observationItem = {
    id: `mission.${mission.id}.${step.id}.${observation.observedAt}`,
    skillId: observation.skillId,
    options: step.choiceSkillIds.map((skillId) => ({ id: skillId }))
  };
  state = applyObservation(
    state,
    observationItem,
    observation.evidenceCorrect,
    observation.observedAt,
    { source: "mission" }
  );
  saveMissionRun(run);
  renderCard();
  renderMissionStep();
}

function renderMissionStep() {
  const run = state.mission.active;
  const mission = missionForId(run?.missionId);
  if (!run || !mission) {
    renderMissionLobby();
    return;
  }
  const step = mission.steps[run.stepIndex];
  dom.missionTitle.textContent = mission.title;
  dom.missionSetup.hidden = true;
  dom.missionRun.hidden = false;
  dom.missionComplete.hidden = true;
  dom.missionProgress.textContent = `Turn ${run.stepIndex + 1} of ${mission.steps.length}`;
  dom.missionKind.textContent = step.kind === "off_script" ? "Off script" : "Partner";
  dom.missionKind.classList.toggle("mission-off-script", step.kind === "off_script");
  dom.missionInstruction.textContent = run.mode === "production"
    ? step.kind === "off_script"
      ? "The exchange opened up. Say the abort aloud now; target five seconds."
      : "Say your fixed response aloud before revealing it. No microphone is listening."
    : step.kind === "off_script"
      ? "The exchange opened up. Use the pre-decided recovery; do not improvise."
      : "Choose your fixed response to the partner's Japanese.";
  renderJapanese(dom.missionPrompt, step.prompt, { neverShow: run.hideFurigana });
  const readingEntries = missionStepEntries(step);
  const shownReadings = run.hideFurigana
    ? 0
    : readingEntries.filter((entry) => showReadingFor(entry)).length;
  dom.missionFuriganaStatus.textContent = run.hideFurigana
    ? `Challenge run · furigana${run.mode === "recognition" ? " and choice meanings" : ""} hidden`
    : readingEntries.length === 0
      ? "This turn uses kana only"
      : `${shownReadings} supported · ${readingEntries.length - shownReadings} retired by reading checks`;
  dom.missionPromptMeaning.textContent = step.meaning;
  dom.missionPromptMeaning.hidden = !run.currentHintUsed && !run.awaitingAdvance;
  dom.missionHint.hidden = run.awaitingAdvance || run.productionRevealed;
  dom.missionHint.disabled = run.currentHintUsed;
  dom.missionHint.textContent = run.currentHintUsed ? "Meaning shown — help recorded" : "Need help — show meaning";
  dom.missionFeedback.hidden = true;
  dom.missionProductionGrades.hidden = true;
  dom.missionAdvance.hidden = false;
  dom.missionProductionReveal.hidden = run.mode !== "production" || run.productionRevealed || run.awaitingAdvance;
  dom.missionOptions.replaceChildren();

  const observation = run.awaitingAdvance ? run.observations.at(-1) : null;
  if (run.mode === "recognition") {
    for (const skillId of step.choiceSkillIds) {
      const line = missionLines.get(skillId);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mission-option";
      button.disabled = run.awaitingAdvance;
      button.dataset.skillId = skillId;
      button.dataset.correct = String(skillId === step.targetSkillId);
      const japanese = document.createElement("span");
      japanese.className = "mission-option-japanese";
      japanese.lang = "ja";
      renderJapanese(japanese, line.ja, { neverShow: run.hideFurigana });
      button.append(japanese);
      if (!run.hideFurigana) {
        const meaning = document.createElement("span");
        meaning.className = "mission-option-meaning";
        meaning.textContent = line.meaning;
        button.append(meaning);
      }
      if (observation) {
        if (skillId === step.targetSkillId) button.classList.add("correct");
        if (skillId === observation.selectedSkillId && !observation.answerCorrect) button.classList.add("incorrect");
      }
      button.addEventListener("click", () => answerMissionChoice(skillId));
      dom.missionOptions.append(button);
    }
  }
  if (run.awaitingAdvance || (run.mode === "production" && run.productionRevealed)) {
    renderMissionFeedback(run, mission, step);
  }
  startMissionTimer(run, step);
}

function weakestMissionSkill(run) {
  const skillIds = [...new Set(run.observations.map((observation) => observation.skillId))];
  if (run.mode === "production") {
    const gradeRank = { miss: 0, help: 1, clean: 2 };
    return skillIds.sort((a, b) => {
      const aObservation = run.observations.findLast((entry) => entry.skillId === a);
      const bObservation = run.observations.findLast((entry) => entry.skillId === b);
      const resultDifference = gradeRank[aObservation?.grade] - gradeRank[bObservation?.grade];
      if (resultDifference) return resultDifference;
      const readyDifference = Number(productionIsReady(state.skills[a])) - Number(productionIsReady(state.skills[b]));
      return readyDifference
        || (state.skills[a].production?.streak ?? 0) - (state.skills[b].production?.streak ?? 0);
    })[0] ?? null;
  }
  return skillIds.sort((a, b) => {
    const readyDifference = Number(skillIsReady(tree, state.skills[a])) - Number(skillIsReady(tree, state.skills[b]));
    return readyDifference || probabilityKnown(state.skills[a]) - probabilityKnown(state.skills[b]);
  })[0] ?? null;
}

function renderMissionComplete(run) {
  const mission = missionForId(run.missionId);
  completedMissionRun = run;
  completedMissionWeakestSkillId = weakestMissionSkill(run);
  const stats = statsForMission(mission.id);
  const responseMs = run.observations.reduce((total, observation) => total + observation.responseMs, 0);
  dom.missionTitle.textContent = mission.title;
  dom.missionSetup.hidden = true;
  dom.missionRun.hidden = true;
  dom.missionComplete.hidden = false;
  dom.missionOutcome.dataset.outcome = run.outcome;
  dom.missionOutcome.textContent = run.outcome;
  const wording = {
    clean: ["Closed loop complete.", run.mode === "production"
      ? "Every fixed line was said cleanly, and the abort came within five seconds."
      : "Every fixed response—including the abort—was correct without help."],
    recovered: ["Recovered safely.", run.mode === "production"
      ? "The abort was available, but one line needed help or the abort took longer than five seconds."
      : "There was a miss or hint, but you used the abort when the exchange opened up."],
    failed: ["Loop needs another run.", "The final off-script turn was not recovered cleanly with the abort line."]
  }[run.outcome];
  dom.missionCompleteTitle.textContent = wording[0];
  dom.missionCompleteSummary.textContent = wording[1];
  dom.missionSkillResults.replaceChildren();
  const results = new Map();
  for (const observation of run.observations) {
    const current = results.get(observation.skillId) ?? { correct: 0, helped: 0, missed: 0 };
    if (run.mode === "production") {
      current[observation.grade === "clean" ? "correct" : observation.grade === "help" ? "helped" : "missed"] += 1;
    } else {
      current[observation.evidenceCorrect ? "correct" : "missed"] += 1;
    }
    results.set(observation.skillId, current);
  }
  for (const [skillId, result] of results) {
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.className = "mission-skill-result-label";
    renderJapanese(label, skillLabel(skillId));
    const meta = document.createElement("span");
    meta.className = "mission-skill-result-meta";
    if (run.mode === "production") {
      const production = state.skills[skillId].production;
      meta.textContent = `${productionIsReady(state.skills[skillId]) ? "production ready" : `production streak ${production.streak}/2`} · ${result.correct} clean / ${result.helped} help / ${result.missed} miss`;
    } else {
      meta.textContent = `${Math.round(probabilityKnown(state.skills[skillId]) * 100)}% BKT · ${result.correct} hit / ${result.missed} miss`;
    }
    item.append(label, meta);
    dom.missionSkillResults.append(item);
  }
  dom.missionCompleteMetrics.textContent = `${(responseMs / 1000).toFixed(1)}s response time · ${run.hints} hints · ${stats.cleanRuns}/${stats.runs} clean overall · ${run.mode === "production" ? "production only; BKT unchanged" : "recognition BKT recorded"}${run.hideFurigana ? " · challenge run" : ""}`;
  dom.missionPracticeWeakest.disabled = !completedMissionWeakestSkillId;
}

function startMission(
  missionId = dom.missionSelect.value,
  hideFurigana = dom.missionChallenge.checked,
  mode = dom.missionMode.value
) {
  const repair = repairSession();
  if (repair && repair.phase !== "complete") {
    showToast("Finish or end the active field repair first");
    openRepairDialog();
    return;
  }
  const mission = missionById(missionPack, missionId);
  if (!mission) return;
  completedMissionRun = null;
  completedMissionWeakestSkillId = null;
  dom.missionSelect.value = mission.id;
  dom.missionMode.value = mode;
  saveMissionRun(createMissionRun(mission, Date.now(), { hideFurigana, mode }));
  renderMissionStep();
  if (!dom.missionDialog.open) dom.missionDialog.showModal();
}

function openMissionDialog() {
  completedMissionRun = null;
  if (state.mission.active) renderMissionStep();
  else renderMissionLobby();
  dom.missionDialog.showModal();
}

function focusDescription() {
  const focus = state.focus;
  if (focus?.skillId) return skillLabel(focus.skillId);
  const scenario = scenarioById(focus?.scenarioId);
  if (!scenario) return "";
  return focus.mode === "reading" ? `${scenario.title} readings` : scenario.title;
}

function renderFocus() {
  const description = focusDescription();
  dom.focusBanner.hidden = !description;
  dom.focusSummary.replaceChildren();
  if (description) {
    dom.focusSummary.append(document.createTextNode("Practice focus: "));
    const label = document.createElement("strong");
    renderJapanese(label, description);
    dom.focusSummary.append(label, document.createTextNode(". This overrides automatic route selection."));
  }
  dom.focusClear.hidden = !description;
  dom.mapClearFocus.hidden = !description;
}

function setPracticeFocus({ scenarioId, skillId = null, mode = null }, message) {
  state = { ...state, focus: { scenarioId, skillId, mode } };
  saveState(state);
  renderCard();
  if (dom.mapDialog.open) dom.mapDialog.close();
  showToast(message);
}

function clearPracticeFocus() {
  if (!focusDescription()) return;
  state = { ...state, focus: { scenarioId: null, skillId: null, mode: null } };
  saveState(state);
  renderCard();
  if (dom.mapDialog.open) renderSkillMap();
  showToast("Practice focus cleared");
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

function renderMapDetail(model, skillId) {
  const node = model.islands.flatMap((island) => island.nodes).find((entry) => entry.id === skillId);
  if (!node) {
    dom.mapDetail.hidden = true;
    return;
  }

  selectedMapSkillId = skillId;
  dom.mapDetail.replaceChildren();
  dom.mapDetail.hidden = false;

  const title = document.createElement("h3");
  renderJapanese(title, node.label);
  const status = document.createElement("div");
  status.className = "map-detail-status";
  const statusChip = document.createElement("span");
  statusChip.className = "map-status-chip";
  statusChip.dataset.status = node.status;
  statusChip.textContent = node.status[0].toUpperCase() + node.status.slice(1);
  const knownChip = document.createElement("span");
  knownChip.className = "map-status-chip";
  knownChip.textContent = `${node.knownPercent}% BKT · ${state.skills[skillId].correct}/${tree.readyMinCorrect ?? 2} confirmations`;
  const productionChip = document.createElement("span");
  const production = state.skills[skillId].production;
  productionChip.className = "map-status-chip";
  productionChip.textContent = production.attempts > 0
    ? `${production.streak}/2 spoken clean${productionIsReady(state.skills[skillId]) ? " · ready" : ""}`
    : "spoken · untested";
  status.append(statusChip, knownChip, productionChip);
  dom.mapDetail.append(title, status);

  const item = items.find((candidate) => candidate.skillId === skillId && candidate.mode !== "reading")
    ?? items.find((candidate) => candidate.skillId === skillId);
  if (item) {
    const sample = document.createElement("p");
    sample.className = "map-detail-sample";
    sample.lang = "ja";
    renderJapanese(sample, item.prompt);
    dom.mapDetail.append(sample);
  }

  if (model.current?.skillId === skillId) {
    const note = document.createElement("p");
    note.className = "map-detail-note";
    note.textContent = `This is the current next card: ${model.current.reason}.`;
    dom.mapDetail.append(note);
  }

  const prerequisites = node.prerequisites;
  if (prerequisites.length > 0) {
    const list = document.createElement("ul");
    list.className = "map-prerequisites";
    for (const prerequisiteId of prerequisites) {
      const entry = document.createElement("li");
      const label = document.createElement("span");
      renderJapanese(label, skillLabel(prerequisiteId));
      const known = Math.round(probabilityKnown(state.skills[prerequisiteId]) * 100);
      entry.append(label, document.createTextNode(` · ${known}% BKT`));
      list.append(entry);
    }
    dom.mapDetail.append(list);
  } else {
    const note = document.createElement("p");
    note.className = "map-detail-note";
    note.textContent = "No prerequisite — this branch is available immediately.";
    dom.mapDetail.append(note);
  }

  const targetId = practiceTargetFor(tree, state, skillId);
  const targetItem = targetId
    ? items.find((candidate) => candidate.skillId === targetId && candidate.mode !== "reading")
      ?? items.find((candidate) => candidate.skillId === targetId)
    : null;
  const practice = document.createElement("button");
  practice.type = "button";
  practice.className = "reveal-button";
  practice.disabled = !targetItem;
  if (!targetItem) {
    practice.textContent = "No practice card available";
  } else if (targetId === skillId) {
    practice.textContent = "Practice this skill";
  } else {
    practice.append(document.createTextNode("Practice prerequisite: "));
    const targetLabel = document.createElement("span");
    renderJapanese(targetLabel, skillLabel(targetId));
    practice.append(targetLabel);
  }
  practice.addEventListener("click", () => {
    setPracticeFocus({ scenarioId: targetItem.scenarioId, skillId: targetId }, "Skill focus set");
  });
  dom.mapDetail.append(practice);
}

function renderMapIsland(model, island) {
  const details = document.createElement("details");
  details.className = "map-island";
  details.dataset.scenario = island.id;
  details.open = island.id === model.current?.scenarioId
    || island.focused
    || island.readingsFocused
    || island.nodes.some((node) => node.id === selectedMapSkillId);

  const summary = document.createElement("summary");
  const heading = document.createElement("span");
  heading.className = "map-island-title";
  heading.textContent = island.title;
  const stats = document.createElement("span");
  stats.className = "map-island-stats";
  stats.textContent = `${island.phraseReady}/${island.phraseTotal} phrases · ${island.readingReady}/${island.readingTotal} readings`;
  summary.append(heading, stats);

  const body = document.createElement("div");
  body.className = "map-island-body";
  const purpose = document.createElement("p");
  purpose.className = "map-island-purpose";
  purpose.textContent = island.purpose;
  const actions = document.createElement("div");
  actions.className = "map-island-actions";
  const focusScenario = document.createElement("button");
  focusScenario.type = "button";
  focusScenario.className = "small-button";
  focusScenario.dataset.active = String(island.focused);
  focusScenario.textContent = island.focused ? "Scenario focused" : "Practice this scenario";
  focusScenario.addEventListener("click", () => {
    setPracticeFocus({ scenarioId: island.id }, `Focused ${island.title}`);
  });
  actions.append(focusScenario);

  const viewport = document.createElement("div");
  viewport.className = "map-canvas-scroll";
  const svg = svgElement("svg", {
    class: "map-canvas",
    viewBox: `0 0 ${island.width} ${island.height}`,
    width: island.width,
    height: island.height,
    role: "group",
    "aria-label": `${island.title} prerequisite map`
  });
  const markerId = `map-arrow-${island.id.replace(/[^a-z0-9-]/gi, "-")}`;
  const defs = svgElement("defs");
  const marker = svgElement("marker", {
    id: markerId,
    viewBox: "0 0 10 10",
    refX: 9,
    refY: 5,
    markerWidth: 5,
    markerHeight: 5,
    orient: "auto-start-reverse"
  });
  marker.append(svgElement("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "#9aaba1" }));
  defs.append(marker);
  svg.append(defs);

  for (const edge of island.edges) {
    svg.append(svgElement("path", {
      class: "map-edge",
      d: edge.d,
      "marker-end": `url(#${markerId})`
    }));
  }
  for (const node of island.nodes) {
    const container = svgElement("foreignObject", {
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height
    });
    const button = document.createElement("button");
    button.type = "button";
    button.className = "map-node";
    button.dataset.status = node.status;
    button.dataset.next = String(node.next);
    button.dataset.focused = String(node.focused);
    button.dataset.skill = node.id;
    button.setAttribute("aria-pressed", String(node.id === selectedMapSkillId));
    button.setAttribute("aria-label", `${node.label}: ${node.status}, ${node.knownPercent}% known`);
    const label = document.createElement("span");
    label.className = "map-node-title";
    renderJapanese(label, node.label);
    const meta = document.createElement("span");
    meta.className = "map-node-meta";
    meta.textContent = `${node.knownPercent}% · ${node.status}${node.externalPrerequisiteCount ? ` · ${node.externalPrerequisiteCount} outside` : ""}`;
    button.append(label, meta);
    button.addEventListener("click", () => {
      dom.mapIslands.querySelectorAll(".map-node[aria-pressed='true']")
        .forEach((entry) => entry.setAttribute("aria-pressed", "false"));
      button.setAttribute("aria-pressed", "true");
      renderMapDetail(model, node.id);
      dom.mapDetail.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    container.append(button);
    svg.append(container);
  }
  viewport.append(svg);
  body.append(purpose, actions, viewport);

  if (island.readingTotal > 0) {
    const readingCluster = document.createElement("button");
    readingCluster.type = "button";
    readingCluster.className = "map-reading-cluster";
    readingCluster.dataset.focused = String(island.readingsFocused);
    readingCluster.dataset.next = String(island.nextReading);
    readingCluster.setAttribute("aria-label", `Practice ${island.title} readings`);
    const total = document.createElement("strong");
    total.textContent = `Reading cluster · ${island.readingReady}/${island.readingTotal} furigana retired`;
    const weakest = document.createElement("span");
    const weakText = island.weakestReadings
      .map((entry) => entry.term)
      .join(" · ");
    renderJapanese(weakest, `Needs work: ${weakText}`);
    readingCluster.append(total, weakest);
    readingCluster.addEventListener("click", () => {
      setPracticeFocus({ scenarioId: island.id, mode: "reading" }, `Focused ${island.title} readings`);
    });
    body.append(readingCluster);
  }

  details.append(summary, body);
  return details;
}

function renderSkillMap() {
  const model = buildSkillMap({ content, tree, readings, state, currentItem });
  dom.mapNext.replaceChildren();
  if (model.current) {
    dom.mapNext.append(document.createTextNode("Next: "));
    const label = document.createElement("strong");
    renderJapanese(label, model.current.label);
    dom.mapNext.append(label, document.createTextNode(` · ${model.current.reason}`));
  } else {
    dom.mapNext.textContent = "No next card is currently available.";
  }

  if (!selectedMapSkillId || !model.islands.some((island) => island.nodes.some((node) => node.id === selectedMapSkillId))) {
    selectedMapSkillId = currentItem?.mode === "reading" ? null : currentItem?.skillId;
  }
  renderMapDetail(model, selectedMapSkillId);
  dom.mapIslands.replaceChildren(...model.islands.map((island) => renderMapIsland(model, island)));
  renderFocus();
}

function showAnswer(resultText = "") {
  answered = true;
  dom.answer.hidden = false;
  dom.reveal.hidden = true;
  dom.nextCard.hidden = false;
  const repair = repairSession();
  const session = guidedSession();
  dom.nextCard.textContent = repair?.phase === "mission"
    ? "Start spoken repair"
    : repair?.phase === "cards"
      ? "Next repair check"
      : session?.phase === "mission"
    ? "Start session mission"
    : session?.phase === "cards" ? "Next session card" : "Next card";
  dom.result.textContent = resultText;
}

function applyCardAnswer(item, correct, now = Date.now()) {
  const activeRepair = repairSession();
  const repairItem = currentRepairCard(activeRepair, items);
  const active = guidedSession();
  const sessionItem = currentSessionCard(active, items);
  state = applyObservation(state, item, correct, now);
  if (repairItem?.id === item.id) {
    state = {
      ...state,
      repair: {
        ...state.repair,
        active: recordRepairCard(activeRepair, item, correct, now)
      }
    };
  }
  if (sessionItem?.id === item.id) {
    state = {
      ...state,
      session: {
        ...state.session,
        active: recordSessionCard(active, item, correct, now)
      }
    };
  }
  saveState(state);
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
      applyCardAnswer(item, option.correct);
      for (const sibling of dom.options.children) {
        sibling.disabled = true;
        if (sibling.dataset.correct === "true") sibling.classList.add("correct");
      }
      button.classList.add(option.correct ? "correct" : "incorrect");
      showAnswer(option.correct ? "Correct — BKT updated." : "Not this one — BKT recorded a miss.");
      renderEvidence();
      renderProgress();
      renderSessionLauncher();
      renderRepairLauncher();
    });
    dom.options.append(button);
  }
}

function renderPromptFurigana() {
  const isReadingTest = currentItem.mode === "reading" || currentItem.mode === "focus";
  renderJapanese(dom.prompt, currentItem.prompt, { neverShow: isReadingTest });
  const entries = readingEntriesIn(currentItem.prompt, readings);

  if (isReadingTest) {
    const skill = state.skills[currentItem.skillId];
    const streak = skill?.readingCheckpointStreak ?? 0;
    const needed = readings.furiganaMinStreak ?? 2;
    dom.furiganaStatus.textContent = `No-furigana checkpoint · ${Math.min(streak, needed)}/${needed} consecutive passes`;
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
  dom.furiganaStatus.textContent = `${shown} supported · ${retired.length} retired by reading checks`;
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
      mode: "reading",
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
  applyCardAnswer(currentItem, false);
  for (const button of dom.options.children) {
    button.disabled = true;
    if (button.dataset.correct === "true") button.classList.add("correct");
  }
  showAnswer("Shown as a miss — uncertainty is evidence too.");
  renderEvidence();
  renderProgress();
  renderSessionLauncher();
  renderRepairLauncher();
}

function renderEvidence() {
  const skill = state.skills[currentItem.skillId];
  const known = Math.round(probabilityKnown(skill) * 100);
  const minimumCorrect = tree.readyMinCorrect ?? 2;
  const isReading = currentItem.mode === "reading";
  const readiness = isReading
    ? readingIsReady(readings, skill) ? "reading secure" : "furigana still supported"
    : skillIsReady(tree, skill)
      ? "ready"
      : `${Math.min(skill.correct, minimumCorrect)}/${minimumCorrect} confirmations`;
  const readingGate = isReading
    ? ` · checkpoint ${Math.min(skill.readingCheckpointStreak ?? 0, readings.furiganaMinStreak ?? 2)}/${readings.furiganaMinStreak ?? 2}`
    : "";
  dom.evidence.textContent = `BKT estimate ${known}% known · ${skill.correct} correct / ${skill.incorrect} missed · ${readiness}${readingGate}`;
}

function renderProgress() {
  const reviewLabel = state.totalReviews === 1 ? "review" : "reviews";
  const readingIds = [...readingSkillIds];
  const phraseIds = tree.nodes.map((node) => node.id).filter((id) => !readingSkillIds.has(id));
  const readingSeen = readingIds.filter((id) => state.skills[id]?.attempts > 0).length;
  const phraseSeen = phraseIds.filter((id) => state.skills[id]?.attempts > 0).length;
  dom.progress.textContent = `${state.totalReviews} ${reviewLabel} · ${state.totalProduction ?? 0} spoken turns · phrases ${phraseSeen}/${phraseIds.length} · readings ${readingSeen}/${readingIds.length} · saved here`;
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

function renderFieldSummary(preferredScenarioId = null) {
  const scenarioId = preferredScenarioId
    ?? dom.fieldScenario.value
    ?? currentItem?.scenarioId;
  if (scenarioById(scenarioId)) dom.fieldScenario.value = scenarioId;
  const latest = latestFieldOutcome(state.field, dom.fieldScenario.value);
  const counts = fieldCounts(state.field, dom.fieldScenario.value);
  if (!latest) {
    dom.fieldSummary.textContent = "Nothing logged for this scenario yet.";
    return;
  }
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  dom.fieldSummary.textContent = `Latest: ${fieldOutcomeLabels[latest.outcome]} · ${total} field ${total === 1 ? "result" : "results"} · practice priority adjusted locally`;
}

function repairOffer(scenarioId = dom.fieldScenario.value) {
  const event = latestFieldOutcome(state.field, scenarioId);
  if (!event || !REPAIRABLE_FIELD_OUTCOMES.includes(event.outcome)) return null;
  if (repairHandledFieldEvent(state.repair, event.id)) return null;
  if (!missionPack.missions.some((mission) => mission.scenarioId === event.scenarioId)) return null;
  return event;
}

function stopRepairTimer() {
  if (repairTimerId != null) window.clearInterval(repairTimerId);
  repairTimerId = null;
}

function repairWaitText(session, now = Date.now()) {
  const remaining = Math.max(0, session.revisitAt - now);
  if (remaining === 0) return "Ten-minute revisit ready.";
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.ceil((remaining % 60000) / 1000);
  return `Revisit in ${minutes}:${String(seconds).padStart(2, "0")}. It survives refresh.`;
}

function scheduleRepairTimer(session) {
  stopRepairTimer();
  if (session?.phase !== "waiting" || session.revisitAt <= Date.now()) return;
  repairTimerId = window.setInterval(() => {
    renderRepairLauncher();
    if (dom.repairDialog.open) renderRepairDialog();
  }, 1000);
}

function renderRepairLauncher() {
  const active = repairSession();
  const offer = repairOffer();
  dom.repairLauncher.hidden = !active && !offer;
  if (!active && !offer) {
    stopRepairTimer();
    return;
  }
  if (!active) {
    const scenario = scenarioById(offer.scenarioId);
    dom.repairLaunchTitle.textContent = `Repair ${scenario.title}.`;
    dom.repairSummary.textContent = `${fieldOutcomeLabels[offer.outcome]} stays in the field log. Practice the weak prompt, reading, fixed response, and abort.`;
    dom.repairOpen.textContent = "Start repair";
    stopRepairTimer();
    return;
  }
  const scenario = scenarioById(active.scenarioId);
  dom.repairLaunchTitle.textContent = `${scenario.title} field repair`;
  if (active.phase === "cards") {
    dom.repairSummary.textContent = `${active.outcomes.length}/${active.cardIds.length} objective checks complete.`;
    dom.repairOpen.textContent = "Continue repair";
  } else if (active.phase === "mission") {
    dom.repairSummary.textContent = active.round === "revisit"
      ? "Ten-minute revisit: say the fixed line and timed abort again."
      : "Objective checks complete. Say the fixed line and timed abort.";
    dom.repairOpen.textContent = state.mission.active ? "Resume speaking" : "Start speaking";
  } else if (active.phase === "waiting") {
    dom.repairSummary.textContent = repairWaitText(active);
    dom.repairOpen.textContent = active.revisitAt <= Date.now() ? "Start revisit" : "View repair";
  } else {
    dom.repairSummary.textContent = `Repair complete. Original field result remains ${fieldOutcomeLabels[active.fieldOutcome]}.`;
    dom.repairOpen.textContent = "View result";
  }
  scheduleRepairTimer(active);
}

function repairStageStatuses(session) {
  if (!session) return ["current", "upcoming", "upcoming", "upcoming", "upcoming"];
  const recognitionDone = session.outcomes.length >= 1;
  const readingDone = session.outcomes.length >= 2;
  let production = readingDone ? "current" : "upcoming";
  let abort = "upcoming";
  let revisit = "upcoming";
  if (session.phase === "mission" && session.round === "initial") {
    const step = state.mission.active?.missionId === session.mission.id
      ? state.mission.active.stepIndex
      : 0;
    production = step > 0 ? "done" : "current";
    abort = step > 0 ? "current" : "upcoming";
  }
  if (["waiting", "complete"].includes(session.phase) || session.round === "revisit") {
    production = "done";
    abort = "done";
  }
  if (session.phase === "mission" && session.round === "revisit") revisit = "current";
  if (session.phase === "complete") revisit = "done";
  return [
    recognitionDone ? "done" : "current",
    readingDone ? "done" : recognitionDone ? "current" : "upcoming",
    production,
    abort,
    revisit
  ];
}

function renderRepairDialog() {
  const active = repairSession();
  const offer = repairOffer();
  const scenarioId = active?.scenarioId ?? offer?.scenarioId;
  const scenario = scenarioById(scenarioId);
  dom.repairTitle.textContent = scenario ? `Repair ${scenario.title}.` : "Field repair";
  const statuses = repairStageStatuses(active);
  [
    dom.repairStageRecognition,
    dom.repairStageReading,
    dom.repairStageProduction,
    dom.repairStageAbort,
    dom.repairStageRevisit
  ].forEach((element, index) => setStageStatus(element, statuses[index]));
  dom.repairEnd.hidden = !active || active.phase === "complete";
  dom.repairAction.disabled = false;

  if (!active) {
    dom.repairStatus.textContent = offer
      ? `${fieldOutcomeLabels[offer.outcome]} remains the real result. This repair adds two objective checks, two spoken recalls, and a ten-minute revisit without rewriting it.`
      : "Log a difficult real conversation to build a repair."
    dom.repairAction.textContent = offer ? "Start two-card repair" : "No repair available";
    dom.repairAction.disabled = !offer;
    return;
  }
  if (active.phase === "cards") {
    dom.repairStatus.textContent = `Complete ${active.cardIds.length - active.outcomes.length} more objective ${active.cardIds.length - active.outcomes.length === 1 ? "check" : "checks"}, then retrieve the weakest fixed line aloud.`;
    dom.repairAction.textContent = "Continue objective checks";
  } else if (active.phase === "mission") {
    dom.repairStatus.textContent = active.round === "revisit"
      ? "No cards this time: retrieve the same fixed response and abort without furigana."
      : "Choices are hidden. Say the weakest fixed response, then recover from the off-script turn within five seconds.";
    dom.repairAction.textContent = state.mission.active ? "Resume spoken repair" : "Start spoken repair";
  } else if (active.phase === "waiting") {
    dom.repairStatus.textContent = `${repairWaitText(active)} The original ${fieldOutcomeLabels[active.fieldOutcome].toLowerCase()} result is unchanged.`;
    dom.repairAction.textContent = active.revisitAt <= Date.now() ? "Start ten-minute revisit" : "Revisit not due yet";
    dom.repairAction.disabled = active.revisitAt > Date.now();
  } else {
    const revisit = active.revisit;
    dom.repairStatus.textContent = `Repair complete: ${revisit.clean}/${revisit.total} revisit lines said cleanly; abort ${(revisit.abortResponseMs / 1000).toFixed(1)}s. Field log still says ${fieldOutcomeLabels[active.fieldOutcome]}.`;
    dom.repairAction.textContent = "Done";
  }
}

function openRepairDialog() {
  renderRepairDialog();
  if (!dom.repairDialog.open) dom.repairDialog.showModal();
}

function startRepair() {
  const currentSession = guidedSession();
  if (currentSession && currentSession.phase !== "complete") {
    showToast("Finish or end the guided session first");
    return;
  }
  if (state.mission.active) {
    showToast("Finish the active mission first");
    return;
  }
  const event = repairOffer();
  if (!event) return;
  const repairState = archiveCompletedRepair(state.repair);
  const cleanSession = currentSession?.phase === "complete"
    ? archiveCompletedSession(state.session)
    : state.session;
  const active = buildRepairSession({ event, items, missionPack, state, now: Date.now() });
  state = { ...state, repair: { ...repairState, active }, session: cleanSession };
  saveState(state);
  if (dom.repairDialog.open) dom.repairDialog.close();
  renderCard();
  document.querySelector(".card").scrollIntoView({ behavior: "smooth", block: "start" });
  showToast("Field repair started");
}

function startRepairMission() {
  const repair = repairSession();
  if (!repair || repair.phase !== "mission") return;
  if (state.mission.active) {
    if (state.mission.active.missionId === repair.mission.id) openMissionDialog();
    else showToast("Finish the active mission first");
    return;
  }
  if (dom.repairDialog.open) dom.repairDialog.close();
  completedMissionRun = null;
  completedMissionWeakestSkillId = null;
  saveMissionRun(createMissionRun(repair.mission, Date.now(), {
    hideFurigana: repair.round === "revisit",
    mode: "production"
  }));
  renderMissionStep();
  dom.missionDialog.showModal();
}

function continueRepair() {
  const repair = repairSession();
  if (!repair) {
    startRepair();
    return;
  }
  if (repair.phase === "cards") {
    if (dom.repairDialog.open) dom.repairDialog.close();
    renderCard();
    document.querySelector(".card").scrollIntoView({ behavior: "smooth", block: "start" });
  } else if (repair.phase === "mission") {
    startRepairMission();
  } else if (repair.phase === "waiting" && repair.revisitAt <= Date.now()) {
    state = {
      ...state,
      repair: { ...state.repair, active: beginRepairRevisit(repair) }
    };
    saveState(state);
    renderRepairLauncher();
    startRepairMission();
  } else if (repair.phase === "complete") {
    dom.repairDialog.close();
  }
}

function endRepair() {
  const repair = repairSession();
  if (!repair || !window.confirm("End this repair? Recorded card and production evidence will remain, and the field result will not change.")) return;
  stopRepairTimer();
  const ownsMission = state.mission.active?.missionId === repair.mission.id;
  state = {
    ...state,
    repair: { ...state.repair, active: null },
    mission: ownsMission ? { ...state.mission, active: null } : state.mission
  };
  saveState(state);
  dom.repairDialog.close();
  if (dom.missionDialog.open) dom.missionDialog.close();
  renderCard();
  showToast("Repair ended; evidence kept");
}

function logFieldOutcome(outcome) {
  const now = Date.now();
  const repair = archiveCompletedRepair(state.repair);
  state = {
    ...state,
    updatedAt: now,
    repair,
    field: recordFieldOutcome(state.field, {
      scenarioId: dom.fieldScenario.value,
      outcome,
      at: now
    })
  };
  saveState(state);
  renderCard();
  renderFieldSummary(dom.fieldScenario.value);
  showToast(`${fieldOutcomeLabels[outcome]} logged; BKT unchanged`);
}

function renderCard() {
  currentItem = currentRepairCard(repairSession(), items)
    ?? currentSessionCard(guidedSession(), items)
    ?? selectNextItem(items, tree, state);
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
    reading: "Kanji → reading",
    "repair-recognition": "Field prompt → meaning"
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
  renderFieldSummary();
  renderRepairLauncher();
  renderFocus();
  renderMissionSummary();
  renderSessionLauncher();
}

function populateRouteScenarios() {
  for (const scenario of content.scenarios.filter((entry) => entry.id !== "essentials")) {
    for (const select of [dom.routeScenario, dom.fieldScenario]) {
      const option = document.createElement("option");
      option.value = scenario.id;
      option.textContent = scenario.title;
      select.append(option);
    }
  }
}

function populateMissions() {
  for (const mission of missionPack.missions) {
    const option = document.createElement("option");
    option.value = mission.id;
    option.textContent = mission.title;
    dom.missionSelect.append(option);
  }
}

function downloadProgress() {
  const blob = new Blob([createProgressBackup(state)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `kaiwa-progress-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("Progress backup downloaded");
}

function sessionIsValid(session) {
  if (!session) return true;
  if (!new Set(["cards", "mission", "complete"]).has(session.phase)) return false;
  if (!Array.isArray(session.cardIds) || !Array.isArray(session.outcomes)) return false;
  if (session.outcomes.length > session.cardIds.length) return false;
  if (!session.cardIds.every((id) => items.some((item) => item.id === id))) return false;
  return Boolean(missionById(missionPack, session.missionId));
}

function repairIsValid(repair) {
  if (!repair) return true;
  if (!new Set(["cards", "mission", "waiting", "complete"]).has(repair.phase)) return false;
  if (!new Set(["initial", "revisit"]).has(repair.round)) return false;
  if (!Array.isArray(repair.cardIds) || !Array.isArray(repair.outcomes)) return false;
  if (repair.outcomes.length > repair.cardIds.length) return false;
  if (!repair.recognitionCard || repair.cardIds[0] !== repair.recognitionCard.id) return false;
  if (!repair.cardIds.slice(1).every((id) => items.some((item) => item.id === id))) return false;
  return repair.mission?.steps?.length === 2
    && repair.mission.steps.at(-1)?.targetSkillId === "abort.wakarimasen";
}

function repairActivityState() {
  let repaired = false;
  if (!repairIsValid(state.repair?.active)) {
    state = { ...state, repair: { ...state.repair, active: null } };
    repaired = true;
  }
  if (state.mission.active && !missionForId(state.mission.active.missionId)) {
    state = { ...state, mission: { ...state.mission, active: null } };
    repaired = true;
  }
  if (!sessionIsValid(state.session?.active)) {
    state = { ...state, session: { ...state.session, active: null } };
    repaired = true;
  }
  if (repaired) saveState(state);
}

async function restoreProgressFile(file) {
  if (!file) return;
  try {
    state = restoreProgressBackup(await file.text(), tree);
    repairActivityState();
    completedMissionRun = null;
    completedMissionWeakestSkillId = null;
    renderCard();
    showToast("Progress restored");
  } catch (error) {
    showToast(error.message);
  } finally {
    dom.progressImport.value = "";
  }
}

function bindEvents() {
  dom.sessionOpen.addEventListener("click", openSessionDialog);
  dom.sessionStart.addEventListener("click", startGuidedSession);
  dom.sessionContinue.addEventListener("click", continueGuidedSession);
  dom.sessionEnd.addEventListener("click", endGuidedSession);
  dom.sessionAgain.addEventListener("click", startGuidedSession);
  dom.repairOpen.addEventListener("click", openRepairDialog);
  dom.repairAction.addEventListener("click", continueRepair);
  dom.repairEnd.addEventListener("click", endRepair);
  dom.missionOpen.addEventListener("click", openMissionDialog);
  dom.missionSelect.addEventListener("change", renderMissionLobby);
  dom.missionMode.addEventListener("change", renderMissionLobby);
  dom.missionStart.addEventListener("click", () => startMission());
  dom.missionProductionReveal.addEventListener("click", revealProductionStep);
  dom.missionProductionGrades.querySelectorAll("[data-production-grade]").forEach((button) => {
    button.addEventListener("click", () => gradeProductionChoice(button.dataset.productionGrade));
  });
  dom.missionHint.addEventListener("click", () => {
    const run = revealMissionHint(state.mission.active);
    saveMissionRun(run);
    renderMissionStep();
  });
  dom.missionAdvance.addEventListener("click", () => {
    const active = state.mission.active;
    const mission = missionForId(active?.missionId);
    if (!active || !mission || !active.awaitingAdvance) return;
    const run = advanceMissionRun(active, mission);
    if (run.completed) {
      stopMissionTimer();
      const repair = repairSession();
      const session = guidedSession();
      const completedRepair = repair?.phase === "mission" && repair.mission.id === run.missionId;
      const completedGuided = session?.phase === "mission" && session.missionId === run.missionId;
      if (completedRepair) {
        state = {
          ...state,
          mission: { ...state.mission, active: null },
          repair: {
            ...state.repair,
            active: completeRepairRound(repair, run, run.completedAt)
          }
        };
      } else {
        state = { ...state, mission: recordMissionCompletion(state.mission, run) };
      }
      if (completedGuided && !completedRepair) {
        state = {
          ...state,
          session: {
            ...state.session,
            active: completeGuidedSession(session, run, run.completedAt)
          }
        };
      }
      saveState(state);
      renderCard();
      if (completedRepair) {
        dom.missionDialog.close();
        renderRepairDialog();
        dom.repairDialog.showModal();
      } else if (completedGuided) {
        dom.missionDialog.close();
        renderSessionDialog();
        dom.sessionDialog.showModal();
      } else {
        renderMissionComplete(run);
      }
      return;
    }
    saveMissionRun(run);
    renderMissionStep();
  });
  dom.missionEnd.addEventListener("click", () => {
    if (!window.confirm("End this mission? Recognition, reading, and production evidence already recorded will remain.")) return;
    stopMissionTimer();
    const repairMission = repairSession()?.mission.id === state.mission.active?.missionId;
    state = { ...state, mission: { ...state.mission, active: null } };
    saveState(state);
    completedMissionRun = null;
    renderMissionSummary();
    if (repairMission) {
      dom.missionDialog.close();
      openRepairDialog();
    } else {
      renderMissionLobby();
    }
  });
  dom.missionPracticeWeakest.addEventListener("click", () => {
    const skillId = completedMissionWeakestSkillId
      ? practiceTargetFor(tree, state, completedMissionWeakestSkillId)
      : null;
    const item = skillId
      ? items.find((candidate) => candidate.skillId === skillId && candidate.mode !== "reading")
        ?? items.find((candidate) => candidate.skillId === skillId)
      : null;
    if (!item) return;
    setPracticeFocus({ scenarioId: item.scenarioId, skillId }, "Weakest mission skill focused");
    dom.missionDialog.close();
  });
  dom.missionAgain.addEventListener("click", () => {
    if (!completedMissionRun) return;
    startMission(completedMissionRun.missionId, completedMissionRun.hideFurigana, completedMissionRun.mode);
  });
  dom.mapOpen.addEventListener("click", () => {
    renderSkillMap();
    dom.mapDialog.showModal();
  });
  dom.focusClear.addEventListener("click", clearPracticeFocus);
  dom.mapClearFocus.addEventListener("click", clearPracticeFocus);
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
  dom.missionDialog.addEventListener("close", stopMissionTimer);
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
  dom.nextCard.addEventListener("click", () => {
    if (repairSession()?.phase === "mission") startRepairMission();
    else if (repairSession()?.phase === "cards") renderCard();
    else if (guidedSession()?.phase === "mission") continueGuidedSession();
    else renderCard();
  });
  dom.progressExport.addEventListener("click", downloadProgress);
  dom.progressImportOpen.addEventListener("click", () => dom.progressImport.click());
  dom.progressImport.addEventListener("change", () => restoreProgressFile(dom.progressImport.files?.[0]));
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
  dom.fieldScenario.addEventListener("change", () => {
    renderFieldSummary();
    renderRepairLauncher();
  });
  document.querySelectorAll("[data-field-outcome]").forEach((button) => {
    button.addEventListener("click", () => logFieldOutcome(button.dataset.fieldOutcome));
  });
  dom.reset.addEventListener("click", () => {
    if (!window.confirm("Reset all Kaiwa practice progress on this device?")) return;
    clearState();
    stopRepairTimer();
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
    [content, tree, readings, missionPack] = await Promise.all([
      loadJson("./data/scenarios.json"),
      loadJson("./data/tree.json"),
      loadJson("./data/readings.json"),
      loadJson("./data/missions.json")
    ]);
    tree = augmentTreeWithReadings(tree, readings);
    validateMissionPack(missionPack, content, tree);
    missionLines = missionLineIndex(content);
    readingSkillIds = new Set(readings.entries.map(readingSkillId));
    items = flattenItems(content, readings);
    state = loadState(tree);
    repairActivityState();

    const name = content.placeholders.nameKatakana;
    dom.placeholder.textContent = `${name.value} is an unconfirmed placeholder. Replace it with the exact reservation name.`;
    dom.placeholder.hidden = name.confirmed;

    populateRouteScenarios();
    populateMissions();
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
