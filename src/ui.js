import { probabilityKnown, skillIsReady } from "./mastery.js";
import {
  clearPrivateOverlay,
  loadPrivateOverlay,
  mergeContentOverlay,
  parsePrivateOverlay,
  savePrivateOverlay,
  validateSkillGraph
} from "./content.js";
import {
  MAX_BREAKDOWN_COMPONENTS,
  MAX_BREAKDOWN_DEPTH,
  MAX_BREAKDOWN_GRAPH_NODES,
  BREAKDOWN_REVISIT_GUESS_PROBABILITY,
  activateAvailableBreakdown,
  abandonBreakdown,
  archiveCompletedBreakdown,
  beginBreakdownRevisit,
  breakdownProgress,
  breakdownDue,
  buildBreakdownSession,
  currentBreakdownCard,
  queueBreakdown,
  recordBreakdownComponent,
  recordBreakdownRetry,
  scheduleWaitingBreakdown
} from "./breakdown.js";
import {
  advanceMissionRun,
  answerMissionStep,
  createMissionRun,
  ensureMissionChoiceOrders,
  gradeProductionStep,
  missionChoiceSkillIds,
  missionById,
  missionLineIndex,
  recordMissionCompletion,
  revealMissionHint,
  revealProductionAnswer,
  validateMissionPack
} from "./mission.js";
import { fieldCounts, latestFieldOutcome, recordFieldOutcome } from "./field.js";
import { speechCapability, speakJapanese, stopJapaneseSpeech } from "./listening.js";
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
import {
  getRoleplayConfig,
  readRoleplayAccessToken,
  requestRoleplay,
  saveRoleplayAccessToken
} from "./providers/llm.js";
import {
  augmentTreeWithReadings,
  generatedOptionsForAttempt,
  itemTestsReading,
  readingIsReady,
  readingSkillId,
  tokenizeReadings
} from "./readings.js";
import {
  applyObservation,
  flattenItems,
  recordAssistedObservation,
  recordRebuildObservation,
  selectNextItem
} from "./scheduler.js";
import {
  archiveCompletedSession,
  buildGuidedSession,
  completeGuidedSession,
  currentSessionCard,
  currentSessionSpeakingItem,
  recordSessionCard,
  recordSessionSpeaking,
  summarizeGuidedSession
} from "./session.js";
import { routeAfterFieldOutcome, showtimeStatus } from "./showtime.js";
import {
  buildSpeakingItems,
  createSpeakingAttempt,
  gradeSpeakingAttempt,
  revealSpeakingAttempt,
  speakingItemsForScenario,
  speakingReadiness,
  validateSpeakingAttempt,
  validateSpeakingItems
} from "./speaking.js";
import { buildSkillMap, practiceTargetFor, schedulerReason } from "./map.js";
import {
  clearState,
  createInitialState,
  createProgressBackup,
  loadState,
  previewProgressBackup,
  restoreProgressBackup,
  saveState
} from "./store.js";
import {
  actionPair,
  answerFieldDecision,
  candidateAnswer,
  cycleIndex,
  fieldDecision,
  FIELD_DECISION_START,
  shuffleCandidates
} from "./wizard.js";

const PRODUCTION_URL = "https://kaiwa-nine.vercel.app/";
const ROUTE_MINUTES = Object.freeze([10, 30, 60, 180, 360, 720]);
const FIELD_LABELS = Object.freeze({
  worked: "Worked",
  phone_sheet: "Used phone sheet",
  aborted: "Aborted safely",
  failed: "Failed"
});

const dom = {
  title: document.querySelector("#app-title"),
  badge: document.querySelector("#offline-badge"),
  journeyFill: document.querySelector("#journey-fill"),
  context: document.querySelector("#wizard-context"),
  placeholder: document.querySelector("#placeholder-warning"),
  loading: document.querySelector("#loading"),
  error: document.querySelector("#error"),
  screen: document.querySelector("#wizard-screen"),
  actions: document.querySelector("#wizard-actions"),
  secondary: document.querySelector("#action-secondary"),
  primary: document.querySelector("#action-primary"),
  progressImport: document.querySelector("#progress-import"),
  contentImport: document.querySelector("#content-import"),
  toast: document.querySelector("#toast")
};

let content;
let tree;
let readings;
let missionPack;
let missionLines;
let items = [];
let speakingItems = [];
let state;
let screen = { name: "home", data: {} };
let cardUi = null;
let missionChoiceUi = null;
let missionAudioUi = null;
let completedMissionRun = null;
let tickerId = null;
let passport = { raw: null, preview: null, file: null, shareSupported: false };
let overlayDraft = null;
let basePacks = null;
let overlayStatus = { installed: false, error: null };
let deviceSpeech = speechCapability();
let roleplay = {
  available: false,
  model: null,
  reason: "Checking optional provider…",
  history: [],
  pending: null,
  draft: ""
};

function element(tag, className = "", text = "") {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text) result.textContent = text;
  return result;
}

function showReadingFor(entry) {
  const skill = state.skills[readingSkillId(entry)];
  return !skill || !readingIsReady(readings, skill);
}

function appendJapanese(target, value, { alwaysShow = false, neverShow = false } = {}) {
  target.replaceChildren();
  for (const segment of tokenizeReadings(String(value ?? ""), readings)) {
    if (!segment.entry) {
      target.append(document.createTextNode(segment.text));
      continue;
    }
    const ruby = element("ruby");
    const base = element("span", "", segment.text);
    const rt = element("rt", "", segment.entry.reading);
    const visible = alwaysShow || (!neverShow && showReadingFor(segment.entry));
    ruby.classList.toggle("furigana-hidden", !visible);
    ruby.dataset.readingSkill = readingSkillId(segment.entry);
    rt.setAttribute("aria-hidden", String(!visible));
    ruby.append(base, rt);
    target.append(ruby);
  }
  return target;
}

function appendProviderParts(target, parts) {
  target.replaceChildren();
  for (const part of parts ?? []) {
    if (!part.reading) {
      target.append(document.createTextNode(part.text));
      continue;
    }
    const ruby = element("ruby");
    ruby.append(element("span", "", part.text), element("rt", "", part.reading));
    target.append(ruby);
  }
}

function screenHeading(kicker, title, copy = "") {
  dom.screen.replaceChildren();
  delete dom.screen.dataset.itemId;
  dom.screen.append(element("p", "screen-kicker", kicker));
  dom.screen.append(element("h2", "screen-title", title));
  if (copy) dom.screen.append(element("p", "screen-copy", copy));
}

function addMeta(...labels) {
  const row = element("div", "screen-meta");
  for (const label of labels.filter(Boolean)) row.append(element("span", "pill", label));
  dom.screen.append(row);
  return row;
}

function addDataCard(title, body = "") {
  const card = element("article", "data-card");
  if (title) card.append(element("p", "candidate-label", title));
  if (body) card.append(element("p", "screen-copy", body));
  dom.screen.append(card);
  return card;
}

function formatLocalTime(value) {
  if (!Number.isFinite(value)) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function progressSummary(progressState) {
  return [
    ["Objective checks", progressState.totalReviews ?? 0],
    ["Spoken observations", progressState.totalProduction ?? 0],
    ["Field logs", progressState.field?.events?.length ?? 0],
    ["Last activity", formatLocalTime(progressState.updatedAt)]
  ];
}

function appendProgressSummary(progressState) {
  const list = element("ul", "metric-list passport-summary");
  for (const [label, value] of progressSummary(progressState)) list.append(metric(value, label));
  dom.screen.append(list);
}

function configureAction(button, action) {
  button.hidden = !action;
  button.onclick = null;
  button.disabled = false;
  if (!action) return;
  button.textContent = action.label;
  button.disabled = Boolean(action.disabled);
  button.onclick = action.onClick;
}

function setActions(secondary = null, primary = null) {
  actionPair(secondary, primary);
  configureAction(dom.secondary, secondary);
  configureAction(dom.primary, primary);
  dom.actions.hidden = !secondary && !primary;
}

function setChrome({ title = "One decision at a time.", context = "Kaiwa wizard", progress = 0.12 } = {}) {
  dom.title.textContent = title;
  dom.context.textContent = context;
  dom.journeyFill.style.width = `${Math.max(4, Math.min(100, progress * 100))}%`;
}

function stopTicker() {
  if (tickerId != null) window.clearInterval(tickerId);
  tickerId = null;
}

function startTicker(callback, interval = 1000) {
  stopTicker();
  tickerId = window.setInterval(callback, interval);
}

function showToast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.add("visible");
  window.setTimeout(() => dom.toast.classList.remove("visible"), 1500);
}

function save() {
  saveState(state);
}

function show(name, data = {}) {
  stopTicker();
  if (screen.name !== name) stopJapaneseSpeech();
  screen = { name, data };
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function scenarioById(id) {
  return content.scenarios.find((scenario) => scenario.id === id) ?? null;
}

function guidedSession() {
  return state.session?.active ?? null;
}

function repairSession() {
  return state.repair?.active ?? null;
}

function breakdownSession() {
  return state.breakdown?.active ?? null;
}

function speakingAttempt() {
  return state.speaking?.active ?? null;
}

function schedulableItems() {
  if (deviceSpeech.status === "ready" || state.focus?.skillId?.startsWith("listening.")) return items;
  return items.filter((item) => item.mode !== "listening");
}

function sessionHasCardPhase(session = guidedSession()) {
  return Boolean(session && new Set(["cards", "recognition", "facets"]).has(session.phase));
}

function breakdownSourceItem(session = breakdownSession()) {
  if (!session) return null;
  return items.find((item) => item.id === session.sourceItemId)
    ?? (repairSession()?.recognitionCard?.id === session.sourceItemId ? repairSession().recognitionCard : null);
}

function missionForId(id) {
  const repair = repairSession();
  if (repair?.mission?.id === id) return repair.mission;
  return missionById(missionPack, id);
}

function latestRepairOffer() {
  return [...(state.field?.events ?? [])].reverse().find((event) =>
    REPAIRABLE_FIELD_OUTCOMES.includes(event.outcome)
    && !repairHandledFieldEvent(state.repair, event.id)
    && missionPack.missions.some((mission) => mission.scenarioId === event.scenarioId)
  ) ?? null;
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

function sessionIsValid(session) {
  if (!session) return true;
  if (!new Set(["cards", "recognition", "speaking", "facets", "mission", "complete"]).has(session.phase)) return false;
  if (!Array.isArray(session.cardIds) || !Array.isArray(session.outcomes)) return false;
  if (session.outcomes.length > session.cardIds.length) return false;
  if (!session.cardIds.every((id) => items.some((item) => item.id === id))) return false;
  if (session.formatVersion === 2 && (session.recognitionCardIds?.length !== 2
    || session.facetCardIds?.length !== 2
    || session.speakLineSkillIds?.length !== 2
    || !Array.isArray(session.speakingOutcomes)
    || session.speakingOutcomes.length > session.speakLineSkillIds.length
    || session.cardIds.join("\0") !== [...session.recognitionCardIds, ...session.facetCardIds].join("\0")
    || !session.speakLineSkillIds.every((skillId) => speakingItems.some((item) =>
      item.skillId === skillId && item.scenarioIds.includes(session.scenarioId)
    )))) return false;
  return Boolean(missionById(missionPack, session.missionId));
}

function breakdownIsValid(session) {
  if (!session) return true;
  if (!new Set(["components", "retry", "waiting", "revisit", "complete"]).has(session.phase)) return false;
  if (!new Set(["integration", "revisit"]).has(session.round)) return false;
  if (!breakdownSourceItem(session)) return false;
  if (!Array.isArray(session.componentIds) || !Array.isArray(session.deferredIds) || !Array.isArray(session.queue)) return false;
  if (!Array.isArray(session.diagnosis?.skillIds)) return false;
  if (!Array.isArray(session.expansionEvents)) return false;
  if (!session.childrenByItem || typeof session.childrenByItem !== "object") return false;
  if (!session.parentByItem || typeof session.parentByItem !== "object") return false;
  if (!session.depthByItem || typeof session.depthByItem !== "object") return false;
  if (!session.nodeLabels || typeof session.nodeLabels !== "object") return false;
  if (!Number.isInteger(session.graphNodeCount) || session.graphNodeCount < 0 || session.graphNodeCount > MAX_BREAKDOWN_GRAPH_NODES) return false;
  if (session.phase === "waiting" && !Number.isFinite(session.revisitAt)) return false;
  if (!session.componentIds.every((id) => items.some((item) => item.id === id))) return false;
  if (!session.deferredIds.every((id) => items.some((item) => item.id === id) && !session.componentIds.includes(id))) return false;
  if (!session.queue.every((id) => session.componentIds.includes(id))) return false;
  if (!Object.values(session.childrenByItem).every((ids) =>
    Array.isArray(ids)
    && ids.length <= MAX_BREAKDOWN_COMPONENTS
    && ids.every((id) => items.some((item) => item.id === id))
  )) return false;
  if (!Object.values(session.depthByItem).every((depth) =>
    Number.isInteger(depth) && depth >= 0 && depth <= MAX_BREAKDOWN_DEPTH
  )) return false;
  if (!session.expansionEvents.every((event) =>
    items.some((item) => item.id === event.parentItemId)
    && Array.isArray(event.childItemIds)
    && event.childItemIds.length <= MAX_BREAKDOWN_COMPONENTS
    && event.childItemIds.every((id) => items.some((item) => item.id === id))
  )) return false;
  return Number.isInteger(session.queueIndex)
    && session.queueIndex >= 0
    && session.queueIndex <= session.queue.length;
}

function repairActivityState() {
  let changed = false;
  const routeStatus = showtimeStatus(state.route, state.field);
  if ((state.route?.scenarioId && !scenarioById(state.route.scenarioId)) || routeStatus.phase === "complete") {
    state = { ...state, route: { scenarioId: null, eventAt: null } };
    changed = true;
  }
  if (!repairIsValid(state.repair?.active)) {
    state = { ...state, repair: { ...state.repair, active: null } };
    changed = true;
  }
  if (state.mission.active && !missionForId(state.mission.active.missionId)) {
    state = { ...state, mission: { ...state.mission, active: null } };
    changed = true;
  }
  if (state.mission.active?.mode === "recognition") {
    const hydrated = ensureMissionChoiceOrders(state.mission.active, missionForId(state.mission.active.missionId));
    if (hydrated !== state.mission.active) {
      state = { ...state, mission: { ...state.mission, active: hydrated } };
      changed = true;
    }
  }
  if (!sessionIsValid(state.session?.active)) {
    state = { ...state, session: { ...state.session, active: null } };
    changed = true;
  }
  if (!validateSpeakingAttempt(state.speaking?.active, speakingItems, state.session?.active)) {
    state = { ...state, speaking: { ...state.speaking, active: null } };
    changed = true;
  }
  if (!breakdownIsValid(state.breakdown?.active)) {
    state = { ...state, breakdown: { ...state.breakdown, active: null } };
    changed = true;
  }
  const validQueued = (state.breakdown?.queued ?? []).filter((session) =>
    breakdownIsValid(session) && session.phase !== "waiting"
  );
  const validScheduled = (state.breakdown?.scheduled ?? []).filter((session) =>
    breakdownIsValid(session) && session.phase === "waiting"
  );
  if (validQueued.length !== (state.breakdown?.queued?.length ?? 0)
    || validScheduled.length !== (state.breakdown?.scheduled?.length ?? 0)) {
    state = {
      ...state,
      breakdown: { ...state.breakdown, queued: validQueued, scheduled: validScheduled }
    };
    changed = true;
  }
  if (changed) save();
}

function primaryPracticeLabel() {
  if (speakingAttempt()) return speakingAttempt().grade ? "Review spoken line" : "Resume speaking";
  if (breakdownSession()) return breakdownSession().phase === "waiting" ? "Continue practice" : "Resume breakdown";
  const guided = guidedSession();
  const repair = repairSession();
  const canInterleave = (!guided || guided.phase === "complete")
    && (!repair || repair.phase === "complete");
  if (canInterleave && (breakdownDue(state.breakdown) || (state.breakdown?.queued?.length ?? 0) > 0)) {
    return breakdownDue(state.breakdown) ? "Delayed check due" : "Repair missed card";
  }
  if (repair && repair.phase !== "complete") return "Resume repair";
  if (state.mission.active) return "Resume mission";
  const session = guidedSession();
  if (session?.phase === "complete") return "View session";
  if (session) return "Resume session";
  return "Start practice";
}

function readinessOrbit(value, total, label) {
  const wrapper = element("div", "readiness-orbit");
  const orbit = element("div", "progress-orbit compact");
  orbit.style.setProperty("--value", `${value / Math.max(1, total) * 360}deg`);
  orbit.append(element("span", "", `${value}/${total}`));
  wrapper.append(orbit, element("p", "candidate-label", label));
  return wrapper;
}

function renderHome() {
  const now = Date.now();
  const next = selectNextItem(schedulableItems(), tree, state);
  const showtime = showtimeStatus(state.route, state.field, now);
  const routedScenario = scenarioById(showtime.scenarioId);
  const recognizeReady = speakingItems.filter((line) => skillIsReady(tree, state.skills[line.skillId])).length;
  const say = speakingReadiness(speakingItems, state);
  const listeningItems = items.filter((item) => item.mode === "listening");
  const hearReady = listeningItems.filter((item) => skillIsReady(tree, state.skills[item.skillId])).length;
  const isShowtime = showtime.phase === "showtime";
  const needsFieldLog = showtime.phase === "field";
  screenHeading(
    isShowtime ? "SHOWTIME" : needsFieldLog ? "AFTER THE EVENT" : "TODAY'S TRIP LOOP",
    routedScenario && (isShowtime || needsFieldLog) ? routedScenario.title : "What do you need right now?",
    isShowtime
      ? "Your fixed phone sheet is ready. The safe abort remains one tap away."
      : needsFieldLog
        ? "Record what actually happened. The result changes priority, never mastery."
        : "Practice opens the strongest next step automatically. Menu reveals every other tool one at a time."
  );
  setChrome({
    title: isShowtime ? "Use the prepared exchange." : needsFieldLog ? "Close the real-world loop." : "Practice the next exchange.",
    context: isShowtime ? "Showtime · event within 30 minutes" : needsFieldLog ? "Showtime · field handoff" : "Home · two choices",
    progress: isShowtime ? 0.92 : needsFieldLog ? 0.96 : 0.08
  });

  const card = addDataCard(isShowtime ? "USE NOW" : needsFieldLog ? "LOG NEXT" : "NEXT PRIORITY");
  const nextTitle = element("p", "candidate-text");
  appendJapanese(nextTitle, routedScenario && (isShowtime || needsFieldLog) ? routedScenario.title : next?.scenarioTitle ?? "Loading…", { alwaysShow: true });
  card.append(nextTitle, element("p", "screen-copy", routedScenario && (isShowtime || needsFieldLog)
    ? routedScenario.purpose
    : next ? next.scenarioPurpose : "No practice item is currently available."));
  const orbits = element("div", "readiness-orbits");
  orbits.append(
    readinessOrbit(recognizeReady, speakingItems.length, "recognize-ready"),
    readinessOrbit(say.ready, say.total, "say-ready"),
    readinessOrbit(hearReady, listeningItems.length, "hear-ready")
  );
  dom.screen.append(orbits, element("p", "screen-copy", `${state.totalReviews} objective checks · ${state.totalProduction ?? 0} spoken observations · progress stays on this device.`));
  if (new Set(["scheduled", "showtime"]).has(showtime.phase)) {
    startTicker(() => {
      if (showtimeStatus(state.route, state.field).phase !== showtime.phase) render();
    });
  }

  if (isShowtime) return setActions(
    { label: "Abort line", onClick: () => show("abort") },
    { label: "Open sheet", onClick: () => show("sheet-line", { scenarioId: routedScenario.id, lineIndex: 0 }) }
  );
  if (needsFieldLog) return setActions(
    { label: "Phone sheet", onClick: () => show("sheet-line", { scenarioId: routedScenario.id, lineIndex: 0 }) },
    { label: "Log outcome", onClick: () => show("field-question", { scenarioId: routedScenario.id, step: FIELD_DECISION_START }) }
  );
  setActions(
    { label: "Menu", onClick: () => show("tools", { index: 0 }) },
    { label: primaryPracticeLabel(), onClick: resumePractice }
  );
}

function resumePractice() {
  if (speakingAttempt()) return show("speaking-card");
  if (breakdownSession()?.phase === "waiting") {
    state = { ...state, breakdown: scheduleWaitingBreakdown(state.breakdown) };
    save();
  }
  const activeSession = guidedSession();
  const activeRepair = repairSession();
  const canInterleave = (!activeSession || activeSession.phase === "complete")
    && (!activeRepair || activeRepair.phase === "complete");
  const promoted = activateAvailableBreakdown(state.breakdown, Date.now(), { includeQueued: canInterleave });
  if (promoted !== state.breakdown) {
    state = { ...state, breakdown: promoted };
    save();
  }
  if (breakdownSession()) return show("breakdown-overview");
  const repair = repairSession();
  if (repair && repair.phase !== "complete") {
    if (repair.phase === "cards") return showCard("repair");
    if (repair.phase === "mission" && state.mission.active) return show("mission-turn");
    return show("repair-overview");
  }
  if (state.mission.active) return show("mission-turn");
  const session = guidedSession();
  if (!session) return show("session-intro");
  if (sessionHasCardPhase(session)) return showCard("session");
  if (session.phase === "speaking") return continueGuidedSpeaking();
  if (session.phase === "mission") return show("session-overview");
  return show("session-summary");
}

function toolChoices() {
  const result = [
    { id: "abort", title: "Emergency exit", copy: "Show the fixed abort line immediately.", open: () => show("abort") },
    { id: "sheet", title: "Conversation sheet", copy: "Browse one allowed line at a time for a live exchange.", open: () => showScenarioChooser("sheet") },
    { id: "field", title: "Log a real conversation", copy: "Record what happened through three yes/no questions.", open: () => showScenarioChooser("field") }
  ];
  if (repairSession() || latestRepairOffer()) {
    result.push({ id: "repair", title: "Field repair", copy: "Close the loop on the latest difficult exchange.", open: () => show("repair-overview") });
  }
  result.push(
    { id: "card", title: "One quick card", copy: "Let the cram scheduler pick a single Japanese-first check.", open: () => showCard("solo") },
    { id: "listen", title: "Listen to a word", copy: "Hear one kana-authored word through the Japanese device voice, then identify its trip meaning.", open: () => showScenarioChooser("listen") },
    { id: "speak", title: "Speak a fixed line", copy: "Retrieve any prepared learner line aloud before revealing it. No microphone listens.", open: () => showScenarioChooser("speak") },
    { id: "mission", title: "Closed-loop mission", copy: "Choose a fixed scenario, mode, and furigana level step by step.", open: () => showMissionChooser() },
    { id: "route", title: "Next real event", copy: "Boost one scenario because a real conversation is approaching.", open: () => show("route-home") },
    { id: "map", title: "Skill path", copy: "Browse scenarios and skills without opening a dense dashboard.", open: () => show("map-home") },
    { id: "roleplay", title: "Optional roleplay", copy: "Use the routed partner only when the HTTP provider is configured.", open: () => openRoleplay() },
    { id: "share", title: "Open on another phone", copy: "Show the QR card for the public Vercel site.", open: () => show("share") },
    { id: "progress", title: "Progress and backup", copy: "Download, restore, or reset local state through confirmations.", open: () => show("progress-menu", { index: 0 }) },
    { id: "overlay", title: "Private lesson overlay", copy: "Import personal names or lessons into this browser without publishing them with the app.", open: () => show("overlay-home") },
    { id: "home", title: "Back home", copy: "Return to the recommended next practice step.", open: () => show("home") }
  );
  return result;
}

function renderTools() {
  const tools = toolChoices();
  const index = Math.min(screen.data.index ?? 0, tools.length - 1);
  const tool = tools[index];
  screenHeading("TOOL MENU", tool.title, tool.copy);
  setChrome({ title: "Choose one tool.", context: `Menu · ${index + 1} of ${tools.length}`, progress: 0.14 });
  const card = addDataCard("ONE TOOL AT A TIME");
  card.append(element("p", "candidate-text", tool.title), element("p", "screen-copy", "Choose it, or move to the next tool."));
  setActions(
    { label: "Not this →", onClick: () => show("tools", { index: cycleIndex(index, tools.length) }) },
    { label: tool.id === "home" ? "Go home" : "Open", onClick: tool.open }
  );
}

function chooserScenarios(flow) {
  return [...content.scenarios, { id: "__back", title: "Back to menu", purpose: "Leave without changing anything." }];
}

function showScenarioChooser(flow, index = 0) {
  show("scenario-chooser", { flow, index });
}

function renderScenarioChooser() {
  const { flow, index = 0 } = screen.data;
  const scenarios = chooserScenarios(flow);
  const scenario = scenarios[index];
  const titles = {
    sheet: "Which live conversation?",
    field: "Which conversation happened?",
    route: "Which event is coming up?",
    speak: "Which situation do you want to say?",
    listen: "Which situation do you want to hear?",
    roleplay: "Which partner scenario?"
  };
  screenHeading("CHOOSE A SCENARIO", scenario.title, scenario.purpose);
  setChrome({ title: titles[flow] ?? "Choose a scenario.", context: `${index + 1} of ${scenarios.length}`, progress: 0.22 });
  if (scenario.id !== "__back") {
    const counts = fieldCounts(state.field, scenario.id);
    const say = speakingReadiness(speakingItems, state, { scenarioId: scenario.id });
    const listening = items.filter((item) => item.scenarioId === scenario.id && item.mode === "listening");
    const hearReady = listening.filter((item) => skillIsReady(tree, state.skills[item.skillId])).length;
    addMeta(`${scenario.items.length} cards`, `${scenario.allowedUserLines.length} fixed lines`, `${say.ready}/${say.total} say-ready`, `${hearReady}/${listening.length} hear-ready`, `${Object.values(counts).reduce((a, b) => a + b, 0)} field logs`);
  }
  setActions(
    { label: "Another →", onClick: () => showScenarioChooser(flow, cycleIndex(index, scenarios.length)) },
    { label: scenario.id === "__back" ? "Back" : "Choose", onClick: () => chooseScenario(flow, scenario) }
  );
}

function chooseScenario(flow, scenario) {
  if (scenario.id === "__back") return show("tools", { index: 0 });
  if (flow === "sheet") return show("sheet-line", { scenarioId: scenario.id, lineIndex: 0 });
  if (flow === "field") return show("field-question", { scenarioId: scenario.id, step: FIELD_DECISION_START });
  if (flow === "speak") return beginSoloSpeaking(scenario.id, 0);
  if (flow === "listen") {
    const item = selectNextItem(items.filter((candidate) => candidate.mode === "listening" && candidate.scenarioId === scenario.id), tree, state);
    return item ? showCard("solo", item.id) : showToast("No listening word is available in this scenario yet");
  }
  if (flow === "route") return show("route-time", { scenarioId: scenario.id, index: 0 });
  if (flow === "roleplay") return show("roleplay-line", { scenarioId: scenario.id, index: 0 });
}

function breakdownCardReason(active, item) {
  if (active.phase === "retry") {
    return "Immediate integration check · component evidence cannot pass the complete phrase";
  }
  if (active.phase === "revisit") {
    return "Delayed reconsolidation check · retrieve the complete phrase after a real gap";
  }
  const evidence = active.selectionEvidence?.[item.id];
  const relationship = active.relationships?.[item.id] ?? "component";
  const labels = {
    diagnosed: "selected distractor points here",
    explicit: "authored component",
    grammar: "grammar pattern",
    pragmatic: "social meaning",
    meaning: "word meaning",
    kanji: "written kanji component",
    decomposition: "phrase component",
    prerequisite: "direct prerequisite",
    reading: "contextual reading",
    foundation: "foundation prerequisite"
  };
  const history = evidence?.attempts > 0
    ? `${evidence.knownPercent}% BKT after ${evidence.attempts} check${evidence.attempts === 1 ? "" : "s"}`
    : "not objectively checked yet";
  const round = active.round === "revisit" ? "Delayed miss repair" : "Breakdown";
  const path = [];
  const seen = new Set();
  let id = item.id;
  while (id && !seen.has(id) && path.length <= 5) {
    seen.add(id);
    path.unshift(active.nodeLabels?.[id] ?? id);
    id = active.parentByItem?.[id];
  }
  const breadcrumb = path.length > 1 ? ` · ${path.join(" → ")}` : "";
  return `${round} · ${labels[relationship] ?? relationship} · ${history}${breadcrumb}`;
}

function cardOptions(item) {
  const available = cardUi?.options ?? item.options;
  if (!Array.isArray(cardUi?.optionIds)) return available;
  const byId = new Map(available.map((option) => [option.id, option]));
  const ordered = cardUi.optionIds.map((id) => byId.get(id)).filter(Boolean);
  return ordered.length === available.length ? ordered : available;
}

function showCard(context, explicitItemId = null) {
  if (context !== "breakdown" && breakdownSession()) return show("breakdown-overview");
  let item;
  if (context === "breakdown") item = currentBreakdownCard(breakdownSession(), items, breakdownSourceItem());
  else if (context === "repair") item = currentRepairCard(repairSession(), items);
  else if (context === "session") item = currentSessionCard(guidedSession(), items);
  else item = items.find((candidate) => candidate.id === explicitItemId) ?? selectNextItem(schedulableItems(), tree, state);
  if (!item) return context === "breakdown" ? show("breakdown-overview") : show("home");
  if (screen.name !== "card" || cardUi?.itemId !== item.id) {
    const options = generatedOptionsForAttempt(item, readings, state.skills[item.skillId]?.attempts ?? 0);
    cardUi = {
      itemId: item.id,
      context,
      optionIndex: 0,
      rejectedCorrect: false,
      answered: false,
      correct: null,
      selectedOptionId: null,
      diagnosticSkillIds: [],
      audioPlayed: false,
      audioReady: item.mode !== "listening",
      transcriptRevealed: false,
      assisted: false,
      options,
      optionIds: shuffleCandidates(options).map((option) => option.id)
    };
  } else {
    cardUi.context = context;
  }
  show("card", { context, itemId: item.id });
}

function renderCard() {
  const item = items.find((candidate) => candidate.id === screen.data.itemId)
    ?? repairSession()?.recognitionCard;
  if (!item) return show("home");
  const skill = state.skills[item.skillId];
  const context = screen.data.context;
  const activeBreakdown = context === "breakdown" ? breakdownSession() : null;
  const progress = context === "breakdown"
    ? new Set(["retry", "revisit"]).has(activeBreakdown.phase)
      ? activeBreakdown.phase === "revisit"
        ? "delayed whole-card recall"
        : `whole-card retry ${activeBreakdown.retryOutcomes.length + 1}`
      : `part ${activeBreakdown.queueIndex + 1} of ${activeBreakdown.queue.length}`
    : context === "session"
    ? `${guidedSession().outcomes.length} of ${guidedSession().cardIds.length}`
    : context === "repair"
      ? `${repairSession().outcomes.length} of ${repairSession().cardIds.length}`
      : "scheduler selected";
  const isReadingCard = itemTestsReading(item);
  const isKanjiCard = item.mode === "kanji";
  const isWordFormCard = item.facet === "written-form";
  const isMeaningCard = item.facet === "meaning-recognition";
  const isRecallCard = item.facet === "meaning-recall";
  const isListeningCard = item.mode === "listening";
  const japaneseCandidate = isReadingCard || isKanjiCard || isWordFormCard || isRecallCard;
  const cardTitle = isListeningCard
    ? "Hear the word before reading it."
    : isKanjiCard
    ? "Rebuild the written word."
    : isReadingCard
      ? "Match the word to its reading."
      : isWordFormCard
        ? "Rebuild the complete word."
        : isMeaningCard
          ? "Choose what the word means."
          : isRecallCard
            ? "Recall the Japanese word."
            : "Read the Japanese first.";
  const chromeTitle = isListeningCard
    ? "What did you hear?"
    : isKanjiCard
    ? "Which kanji fits?"
    : isReadingCard
      ? "Does this reading match?"
      : isWordFormCard
        ? "Which written form matches?"
        : isMeaningCard
          ? "What does this mean?"
          : isRecallCard
            ? "Which Japanese word fits?"
            : "Is this the answer?";
  const direction = isListeningCard
    ? "Audio → meaning"
    : isKanjiCard
    ? "Reading → written form"
    : isReadingCard
      ? "Written form → hiragana"
      : isWordFormCard
        ? "Reading → written form"
        : isMeaningCard
          ? "Japanese → meaning"
          : isRecallCard
            ? "Meaning → Japanese"
            : "Japanese → meaning";
  screenHeading(
    item.scenarioTitle,
    cardTitle,
    item.instruction
  );
  dom.screen.dataset.itemId = item.id;
  setChrome({
    title: chromeTitle,
    context: `${progress} · ${Math.round(probabilityKnown(skill) * 100)}% BKT`,
    progress: cardUi.answered ? 0.72 : 0.52
  });

  if (isListeningCard && !cardUi.transcriptRevealed && !cardUi.answered) {
    const audio = element("article", "audio-card");
    audio.append(
      element("p", "candidate-label", cardUi.audioPlayed ? "AUDIO HEARD" : "AUDIO FIRST"),
      element("p", "audio-symbol", "♪"),
      element("p", "screen-copy", deviceSpeech.status === "ready"
        ? cardUi.audioPlayed ? "Replay as often as useful, then begin the meaning choices." : "The written word stays hidden until feedback."
        : deviceSpeech.reason)
    );
    dom.screen.append(audio);
  } else {
    const prompt = element("p", "prompt-japanese");
    appendJapanese(prompt, item.prompt, isListeningCard
      ? { alwaysShow: true }
      : { neverShow: isReadingCard || isKanjiCard || isWordFormCard || isRecallCard });
    dom.screen.append(prompt);
  }
  addMeta(
    direction,
    `${item.options.length} candidates`
  );
  const reason = context === "repair"
    ? "Field repair · recent conversation friction"
    : context === "breakdown"
      ? breakdownCardReason(activeBreakdown, item)
    : context === "session"
      ? `Guided plan · ${schedulerReason(state, item)}`
      : schedulerReason(state, item);
  const reasonCard = element("aside", "practice-reason");
  reasonCard.append(element("p", "candidate-label", "WHY THIS CARD"), element("p", "practice-reason-text", reason));
  dom.screen.append(reasonCard);

  if (isListeningCard && !cardUi.audioReady && !cardUi.answered) {
    if (deviceSpeech.status === "ready") {
      setActions(
        cardUi.audioPlayed
          ? { label: "Replay", onClick: () => playCardAudio(item) }
          : { label: "Show text", onClick: showListeningText },
        { label: cardUi.audioPlayed ? "Start choices" : "Play audio", onClick: () => cardUi.audioPlayed ? startListeningChoices() : playCardAudio(item) }
      );
    } else {
      setActions(
        { label: "Home", onClick: () => show("home") },
        { label: deviceSpeech.status === "loading" ? "Use text" : "Text fallback", onClick: showListeningText }
      );
    }
    return;
  }

  if (!cardUi.answered) {
    const options = cardOptions(item);
    const option = options[cardUi.optionIndex];
    const candidate = element("article", "candidate-card");
    candidate.dataset.optionId = option.id;
    candidate.append(element(
      "p",
      "candidate-label",
      `${isKanjiCard
        ? "Possible kanji"
        : isReadingCard
          ? "Possible reading"
          : isWordFormCard
            ? "Possible written form"
            : isMeaningCard
              ? "Possible meaning"
              : isRecallCard
                ? "Possible Japanese word"
                : "Candidate"} ${cardUi.optionIndex + 1} of ${options.length}`
    ));
    const label = element("p", `candidate-text${japaneseCandidate ? " candidate-japanese" : ""}`);
    appendJapanese(
      label,
      option.label,
      isKanjiCard || isWordFormCard || isRecallCard ? { neverShow: true } : { alwaysShow: true }
    );
    candidate.append(label);
    dom.screen.append(candidate);
    setActions(
      { label: "No", onClick: () => answerCardCandidate(item, false) },
      { label: "Yes", onClick: () => answerCardCandidate(item, true) }
    );
    return;
  }

  const result = element("article", "result-card");
  result.dataset.result = cardUi.correct ? "correct" : "incorrect";
  result.append(element("p", "result-label", cardUi.correct
    ? cardUi.assisted ? "Correct with text help" : "Correct"
    : "Review this one"));
  const japanese = element("p", "line-japanese");
  appendJapanese(japanese, item.answer.ja, isListeningCard
    ? { alwaysShow: true }
    : isReadingCard || item.wordId ? { neverShow: true } : { alwaysShow: true });
  result.append(japanese);
  if (item.answer.reading) result.append(element("p", "answer-reading", item.answer.reading));
  const meaning = element("p", "line-meaning");
  appendJapanese(meaning, item.answer.meaning, { alwaysShow: true });
  result.append(meaning);
  if (item.answer.note) {
    const note = element("p", "screen-copy");
    appendJapanese(note, item.answer.note, { alwaysShow: true });
    result.append(note);
  }
  if (!cardUi.correct && cardUi.selectedOptionId && cardUi.diagnosticSkillIds.length > 0) {
    const diagnosis = element("aside", "word-zoom");
    diagnosis.append(element("h3", "", "WHAT THAT ANSWER SUGGESTS"));
    const labels = cardUi.diagnosticSkillIds.map((skillId) =>
      tree.nodes.find((node) => node.id === skillId)?.label ?? skillId
    );
    diagnosis.append(element("p", "screen-copy", `The selected answer points to: ${labels.join(" · ")}. Those nodes move to the front of this breakdown.`));
    result.append(diagnosis);
  }
  if (item.zoom) {
    const zoom = element("aside", "word-zoom");
    zoom.append(element("h3", "", "WORD ZOOM"));
    const zoomContext = element("p");
    appendJapanese(zoomContext, item.zoom.context, { alwaysShow: true });
    const zoomBreakdown = element("p", "screen-copy");
    appendJapanese(zoomBreakdown, item.zoom.breakdown, { alwaysShow: true });
    zoom.append(zoomContext, zoomBreakdown);
    result.append(zoom);
  }
  dom.screen.append(result);
  const left = breakdownSession()
    ? { label: "Pause", onClick: () => show("home") }
    : context === "repair"
    ? { label: "End repair", onClick: confirmEndRepair }
    : context === "session"
      ? { label: "End session", onClick: confirmEndSession }
      : { label: "Home", onClick: () => show("home") };
  setActions(left, { label: nextCardLabel(context), onClick: () => continueAfterCard(context) });
}

function playCardAudio(item) {
  const itemId = item.id;
  const result = speakJapanese(item.speech.reading, {
    onError: () => {
      if (cardUi?.itemId !== itemId) return;
      deviceSpeech = { status: "unavailable", voice: null, reason: "The Japanese device voice could not play this word." };
      render();
    }
  });
  if (!result.ok) {
    deviceSpeech = { status: result.status, voice: null, reason: result.reason };
    return render();
  }
  cardUi.audioPlayed = true;
  render();
}

function showListeningText() {
  stopJapaneseSpeech();
  cardUi.transcriptRevealed = true;
  cardUi.audioReady = true;
  cardUi.assisted = true;
  render();
}

function startListeningChoices() {
  stopJapaneseSpeech();
  cardUi.audioReady = true;
  render();
}

function answerCardCandidate(item, accepted) {
  const options = cardOptions(item);
  const option = options[cardUi.optionIndex];
  if (accepted && !option.correct) {
    cardUi.selectedOptionId = option.id;
    cardUi.diagnosticSkillIds = [...(option.diagnosticSkillIds ?? [])];
  }
  const result = candidateAnswer({
    options,
    index: cardUi.optionIndex,
    rejectedCorrect: cardUi.rejectedCorrect,
    accepted
  });
  if (!result.complete) {
    cardUi.optionIndex = result.nextIndex;
    cardUi.rejectedCorrect = result.rejectedCorrect;
    return render();
  }
  if (!result.correct && cardUi.rejectedCorrect) {
    cardUi.selectedOptionId = null;
    cardUi.diagnosticSkillIds = [];
  }
  cardUi.answered = true;
  cardUi.correct = result.correct;
  applyCardResult(item, result.correct);
  render();
}

function applyCardResult(item, correct, now = Date.now()) {
  const context = cardUi.context;
  const repair = repairSession();
  const repairItem = currentRepairCard(repair, items);
  const session = guidedSession();
  const sessionItem = currentSessionCard(session, items);
  if (context === "breakdown") {
    const active = breakdownSession();
    state = item.mode === "listening" && cardUi.assisted
      ? recordAssistedObservation(state, item, now, { source: "hint" })
      : active.phase === "retry" && active.round === "integration"
      ? recordRebuildObservation(state, item, correct, now)
      : applyObservation(
        state,
        item,
        correct,
        now,
        active.phase === "revisit"
          ? { guessProbability: BREAKDOWN_REVISIT_GUESS_PROBABILITY }
          : undefined
      );
    const updated = active.phase === "components"
      ? recordBreakdownComponent(active, item, correct, now)
      : recordBreakdownRetry(active, item, correct, now);
    state = { ...state, breakdown: { ...state.breakdown, active: updated } };
    save();
    return;
  }
  state = item.mode === "listening" && cardUi.assisted
    ? recordAssistedObservation(state, item, now, { source: "hint" })
    : applyObservation(state, item, correct, now);
  if (repairItem?.id === item.id) {
    state = { ...state, repair: { ...state.repair, active: recordRepairCard(repair, item, correct, now) } };
  }
  if (sessionItem?.id === item.id) {
    state = { ...state, session: { ...state.session, active: recordSessionCard(session, item, correct, now, { assisted: cardUi.assisted }) } };
  }
  if (!correct) {
    const breakdown = buildBreakdownSession({
      item,
      items,
      tree,
      readings,
      state,
      diagnosticSkillIds: cardUi.diagnosticSkillIds,
      selectedOptionId: cardUi.selectedOptionId,
      returnContext: context,
      now
    });
    state = {
      ...state,
      breakdown: context === "session"
        ? queueBreakdown(state.breakdown, breakdown)
        : { ...state.breakdown, active: breakdown }
    };
  }
  save();
}

function nextCardLabel(context) {
  const active = breakdownSession();
  if (context !== "breakdown" && active) return "Break it down";
  if (context === "breakdown") {
    if (active?.phase === "complete") return "Finish breakdown";
    if (active?.phase === "retry") return "Retry whole card";
    if (active?.phase === "waiting") return "Continue practice";
    if (active?.phase === "revisit") return "Finish delayed check";
    return "Next part";
  }
  if (context === "repair" && repairSession()?.phase === "mission") return "Speak next";
  if (context === "session" && guidedSession()?.phase === "speaking") return "Say next";
  if (context === "session" && guidedSession()?.phase === "mission") return "Start mission";
  if (context === "session" && guidedSession()?.phase === "facets") return "Check a word";
  return "Next card";
}

function continueAfterCard(context) {
  cardUi = null;
  if (context !== "breakdown" && breakdownSession()) return show("breakdown-overview");
  if (context === "breakdown") {
    if (breakdownSession()?.phase === "waiting") {
      const returnContext = breakdownSession().returnContext;
      state = { ...state, breakdown: scheduleWaitingBreakdown(state.breakdown) };
      save();
      return resumeAfterBreakdownContext(returnContext);
    }
    if (breakdownSession()?.phase === "components") return showCard("breakdown");
    return show("breakdown-overview");
  }
  if (context === "repair") {
    return repairSession()?.phase === "cards" ? showCard("repair") : show("repair-overview");
  }
  if (context === "session") {
    return resumeGuidedSession();
  }
  showCard("solo");
}

function renderBreakdownOverview() {
  const active = breakdownSession();
  if (!active) return resumeAfterBreakdownContext("solo");
  const source = breakdownSourceItem(active);
  if (!source) return show("home");
  const progress = breakdownProgress(active);
  const title = {
    components: active.round === "revisit" ? "Repair what slipped." : "Learn the parts.",
    retry: "Put it back together.",
    waiting: "Let it settle.",
    revisit: "Retrieve it later.",
    complete: "Connection held."
  }[active.phase];
  const copy = active.phase === "components"
    ? active.round === "revisit"
      ? "The delayed whole-phrase miss reopened the most relevant nodes. Clean them, then try the phrase again."
      : "The miss has been traced into weak kanji, grammar, pragmatic, prerequisite, and reading nodes. A selected distractor is promoted when it identifies a specific confusion."
    : active.phase === "retry"
      ? progress.atomic
        ? "This is an honest atomic leaf: study its correction, then retrieve the whole card without invented subskills."
        : "The targeted parts are clean, but their evidence cannot mark the parent mastered. Retrieve the complete phrase now."
      : active.phase === "waiting"
        ? `${breakdownWaitText(active)} You can keep practicing while this check waits.`
        : active.phase === "revisit"
          ? "The gap is complete. Retrieve the untouched whole phrase once more; this is the check that closes the loop."
          : "The components, immediate integration, and delayed whole-phrase recall all have independent evidence.";
  screenHeading("CARD BREAKDOWN", title, copy);
  setChrome({
    title: source.scenarioTitle,
    context: active.phase === "complete" ? "Breakdown complete" : `Breakdown · ${progress.correctComponents}/${progress.componentTotal} parts`,
    progress: { components: 0.45, retry: 0.65, waiting: 0.78, revisit: 0.9, complete: 1 }[active.phase]
  });

  const sourceCard = addDataCard("MISSED WHOLE CARD");
  const japanese = element("p", "candidate-text candidate-japanese");
  const studyMode = active.phase === "components";
  appendJapanese(
    japanese,
    studyMode ? source.answer?.ja ?? source.prompt : source.prompt,
    studyMode ? { alwaysShow: true } : itemTestsReading(source) ? { neverShow: true } : {}
  );
  sourceCard.append(japanese);
  if (active.phase === "components" && source.answer?.meaning) {
    sourceCard.append(element("p", "line-meaning", source.answer.meaning));
  }
  addMeta(
    progress.atomic ? "atomic leaf" : `${progress.componentTotal} targeted parts`,
    `${progress.componentChecks} component checks`,
    `${progress.retries} whole retries`,
    active.expansionEvents?.length ? `${active.expansionEvents.length} recursive expansions` : null,
    active.diagnosis?.skillIds?.length ? "answer-specific diagnosis" : "graph diagnosis",
    active.deferredCount ? `${active.deferredCount} lower-priority nodes deferred` : null
  );

  const stages = element("ol", "stage-list");
  const integrationDone = Number.isFinite(active.integrationPassedAt);
  const delayedStarted = active.round === "revisit" || new Set(["revisit", "complete"]).has(active.phase);
  stages.append(
    element("li", active.phase === "components" && active.round === "integration" ? "current" : integrationDone ? "done" : active.phase === "retry" ? "done" : "", progress.atomic ? "Study the atomic correction" : "Diagnose and check targeted parts"),
    element("li", active.phase === "retry" ? "current" : integrationDone ? "done" : "", "Retrieve the complete phrase now"),
    element("li", active.phase === "waiting" ? "current" : delayedStarted ? "done" : "", "Leave a real ten-minute gap"),
    element("li", active.phase === "revisit" || (active.phase === "components" && active.round === "revisit") ? "current" : active.phase === "complete" ? "done" : "", "Retrieve the complete phrase later")
  );
  dom.screen.append(stages);

  let primary = active.phase === "components"
    ? { label: active.queueIndex === 0 ? "Start parts" : "Continue parts", onClick: () => showCard("breakdown") }
    : active.phase === "retry"
      ? { label: "Retry whole card", onClick: () => showCard("breakdown") }
      : active.phase === "revisit"
        ? { label: "Start delayed check", onClick: () => showCard("breakdown") }
        : active.phase === "complete"
          ? { label: "Continue", onClick: completeBreakdown }
          : null;
  if (active.phase === "waiting") {
    const due = active.revisitAt <= Date.now();
    primary = {
      label: due ? "Start delayed check" : "Continue practice",
      onClick: due ? startBreakdownRevisit : scheduleBreakdownAndResume
    };
    startTicker(() => {
      if (active.revisitAt <= Date.now()) render();
      else {
        const waitCopy = dom.screen.querySelector(".screen-copy");
        if (waitCopy) waitCopy.textContent = breakdownWaitText(active);
      }
    });
  }
  setActions(
    active.phase === "complete"
      ? { label: "Home", onClick: () => show("home") }
      : { label: "End breakdown", onClick: confirmEndBreakdown },
    primary
  );
}

function scheduleBreakdownAndResume() {
  const active = breakdownSession();
  if (!active || active.phase !== "waiting") return show("home");
  const context = active.returnContext;
  state = { ...state, breakdown: scheduleWaitingBreakdown(state.breakdown) };
  save();
  resumeAfterBreakdownContext(context);
}

function breakdownWaitText(active, now = Date.now()) {
  const remaining = Math.max(0, active.revisitAt - now);
  if (remaining === 0) return "The delayed whole-phrase recall is ready.";
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.ceil((remaining % 60000) / 1000);
  return `Delayed recall in ${minutes}:${String(seconds).padStart(2, "0")}. The countdown survives refresh.`;
}

function startBreakdownRevisit() {
  const active = breakdownSession();
  if (!active || active.phase !== "waiting" || active.revisitAt > Date.now()) return;
  state = {
    ...state,
    breakdown: { ...state.breakdown, active: beginBreakdownRevisit(active) }
  };
  save();
  cardUi = null;
  showCard("breakdown");
}

function resumeAfterBreakdownContext(context) {
  if (context === "session") {
    if (!guidedSession()) return show("home");
    return resumeGuidedSession();
  }
  if (context === "repair") {
    if (!repairSession()) return show("home");
    return repairSession().phase === "cards" ? showCard("repair") : show("repair-overview");
  }
  show("home");
}

function completeBreakdown() {
  const active = breakdownSession();
  if (!active || active.phase !== "complete") return show("home");
  const context = active.returnContext;
  state = { ...state, breakdown: archiveCompletedBreakdown(state.breakdown) };
  save();
  cardUi = null;
  resumeAfterBreakdownContext(context);
}

function confirmEndBreakdown() {
  show("confirm", {
    kicker: "END BREAKDOWN",
    title: "Stop before reconnecting the whole card?",
    copy: "Every completed component check stays recorded, but this breakdown will be archived as unfinished.",
    no: () => show("breakdown-overview"),
    yes: endBreakdown
  });
}

function endBreakdown() {
  const context = breakdownSession()?.returnContext ?? "solo";
  state = { ...state, breakdown: abandonBreakdown(state.breakdown) };
  save();
  cardUi = null;
  resumeAfterBreakdownContext(context);
}

function renderSessionIntro() {
  screenHeading("GUIDED SESSION", "Five minutes. One path.", "Recognize two lines, retrieve two aloud, check two weak word facets—including ear-first work when available—then close one spoken mission.");
  setChrome({ title: "Ready to begin?", context: "Guided practice · step 1", progress: 0.18 });
  const stages = element("ol", "stage-list");
  ["Recognize two Japanese prompts", "Say two fixed lines before reveal", "Hear or read two weak word facets", "Hear, speak, and abort in the fixed loop"].forEach((label, index) => {
    stages.append(element("li", index === 0 ? "current" : "", label));
  });
  dom.screen.append(stages);
  setActions(
    { label: "Menu", onClick: () => show("tools", { index: 0 }) },
    { label: "Start", onClick: startGuidedSession }
  );
}

function startGuidedSession() {
  if (breakdownSession()) return show("breakdown-overview");
  const repair = repairSession();
  if (repair && repair.phase !== "complete") return show("repair-overview");
  if (state.mission.active) return show("mission-turn");
  state = {
    ...state,
    repair: archiveCompletedRepair(state.repair),
    session: archiveCompletedSession(state.session)
  };
  const active = buildGuidedSession({ items: schedulableItems(), speakingItems, tree, readings, missionPack, state, now: Date.now() });
  state = { ...state, session: { ...state.session, active } };
  save();
  cardUi = null;
  resumeGuidedSession();
}

function resumeGuidedSession() {
  const session = guidedSession();
  if (!session) return show("session-intro");
  if (sessionHasCardPhase(session)) return showCard("session");
  if (session.phase === "speaking") return continueGuidedSpeaking();
  if (session.phase === "mission") return show("session-overview");
  return show("session-summary");
}

function renderSessionOverview() {
  const session = guidedSession();
  if (!session) return show("session-intro");
  if (sessionHasCardPhase(session)) return showCard("session");
  if (session.phase === "speaking") return continueGuidedSpeaking();
  if (session.phase === "complete") return show("session-summary");
  const mission = missionById(missionPack, session.missionId);
  screenHeading("GUIDED SESSION", "Cards complete. Speak now.", mission.purpose);
  setChrome({ title: "Finish the closed loop.", context: "Guided practice · spoken mission", progress: 0.82 });
  addDataCard("SELECTED FROM YOUR EVIDENCE", mission.title);
  const stages = element("ol", "stage-list");
  stages.append(
    element("li", "done", "Two recognition checks"),
    element("li", "done", "Two standalone spoken recalls"),
    element("li", "done", "Two word-facet checks"),
    element("li", "current", "Speak-first mission")
  );
  dom.screen.append(stages);
  setActions(
    { label: "End session", onClick: confirmEndSession },
    { label: state.mission.active ? "Resume mission" : "Start mission", onClick: () => startGuidedMission(mission) }
  );
}

function startGuidedMission(mission) {
  if (!state.mission.active) startMissionRun(mission, { mode: "production", hideFurigana: false });
  show("mission-turn");
}

function renderSessionSummary() {
  const session = guidedSession();
  if (!session) return show("home");
  const summary = summarizeGuidedSession(session, { state, tree, readings, items, speakingItems });
  screenHeading("SESSION COMPLETE", "The loop is closed.", "Phrase, word-facet, and speaking evidence remain separate channels.");
  setChrome({ title: "Session complete.", context: "Guided practice · summary", progress: 1 });
  const metrics = element("ul", "metric-list");
  metrics.append(
    metric(`${summary.correctCards}/${summary.cardsTotal}`, "objective checks correct"),
    metric(`${summary.facetCorrect}/${summary.facetTotal}`, "word facets correct")
  );
  if (summary.listeningTotal) metrics.append(metric(`${summary.listeningCorrect}/${summary.listeningTotal}`, "ear-first checks unaided"));
  metrics.append(
    metric(`${summary.spokenClean}/${summary.spokenTotal}`, "standalone lines clean"),
    metric(summary.missionOutcome ?? "complete", "spoken mission outcome")
  );
  if (summary.production) metrics.append(metric(`${summary.production.clean}/${summary.production.total}`, "spoken lines clean"));
  dom.screen.append(metrics);
  setActions(
    { label: "Home", onClick: () => show("home") },
    { label: "Again", onClick: startGuidedSession }
  );
}

function metric(value, label) {
  const item = element("li");
  item.append(element("span", "metric-value", String(value)), document.createTextNode(label));
  return item;
}

function confirmEndSession() {
  show("confirm", {
    kicker: "END SESSION",
    title: "Keep the evidence and stop?",
    copy: "Completed checks and spoken observations stay recorded.",
    no: () => resumePractice(),
    yes: endGuidedSession
  });
}

function endGuidedSession() {
  const session = guidedSession();
  const ownsMission = session?.missionId === state.mission.active?.missionId;
  const ownsSpeaking = speakingAttempt()?.source === "session" && speakingAttempt()?.sessionId === session?.id;
  state = {
    ...state,
    session: { ...state.session, active: null },
    mission: ownsMission ? { ...state.mission, active: null } : state.mission,
    speaking: ownsSpeaking ? { ...state.speaking, active: null } : state.speaking
  };
  save();
  show("home");
}

function renderAbort() {
  const line = content.scenarios.flatMap((scenario) => scenario.allowedUserLines)
    .find((candidate) => candidate.skillId === "abort.wakarimasen");
  screenHeading("POLITE EXIT", "Say this once. Then show the screen.", "The abort is always available and never requires network access.");
  setChrome({ title: "Need out?", context: "Safety line", progress: 1 });
  const card = element("article", "line-card");
  const japanese = element("p", "prompt-japanese");
  appendJapanese(japanese, line.ja, { alwaysShow: true });
  const meaning = element("p", "line-meaning");
  appendJapanese(meaning, line.meaning, { alwaysShow: true });
  card.append(japanese, meaning);
  dom.screen.append(card);
  setActions(
    { label: "Home", onClick: () => show("home") },
    { label: "Phone sheet", onClick: () => showScenarioChooser("sheet") }
  );
}

function speakingItemForAttempt(attempt = speakingAttempt()) {
  return speakingItems.find((item) => item.skillId === attempt?.skillId && item.scenarioIds.includes(attempt.scenarioId)) ?? null;
}

function beginSoloSpeaking(scenarioId, lineIndex = 0) {
  const scenario = scenarioById(scenarioId);
  const line = scenario?.allowedUserLines[lineIndex];
  const item = speakingItems.find((candidate) => candidate.skillId === line?.skillId && candidate.scenarioIds.includes(scenarioId));
  if (!item) return show("home");
  state = {
    ...state,
    speaking: { ...state.speaking, active: createSpeakingAttempt(item, Date.now(), { scenarioId, source: "solo" }) }
  };
  save();
  show("speaking-card");
}

function continueGuidedSpeaking() {
  const session = guidedSession();
  if (!session) return show("home");
  const active = speakingAttempt();
  if (active?.source === "session" && active.sessionId === session.id) return show("speaking-card");
  if (session.phase !== "speaking") return resumeGuidedSession();
  const item = currentSessionSpeakingItem(session, speakingItems);
  if (!item) return show("session-overview");
  state = {
    ...state,
    speaking: {
      ...state.speaking,
      active: createSpeakingAttempt(item, Date.now(), {
        scenarioId: session.scenarioId,
        source: "session",
        sessionId: session.id
      })
    }
  };
  save();
  show("speaking-card");
}

function renderSpeakingCard() {
  const attempt = speakingAttempt();
  const item = speakingItemForAttempt(attempt);
  const scenario = scenarioById(attempt?.scenarioId);
  if (!attempt || !item || !scenario) return show("home");
  const isSession = attempt.source === "session";
  const isAbort = item.isAbort;
  const stepIndex = isSession ? (guidedSession()?.speakingOutcomes.length ?? 0) + (attempt.grade ? 0 : 1) : null;
  const heading = attempt.grade
    ? attempt.grade === "clean" ? "Clean recall." : attempt.grade === "help" ? "Help recorded." : "Miss recorded."
    : item.meaning;
  screenHeading(isSession ? "GUIDED · SAY IT" : "SAY IT", heading, attempt.grade
    ? "This is production evidence only. It never changes objective BKT."
    : isAbort
      ? "Say the safety line aloud before revealing it. Target five seconds. Nothing is listening."
      : "Say the Japanese line aloud before revealing it. Nothing is listening or grading you.");
  setChrome({
    title: attempt.grade ? "Spoken observation saved." : "Retrieve before revealing.",
    context: isSession ? `Guided speaking · ${Math.min(stepIndex, guidedSession()?.speakLineSkillIds.length ?? 2)} of ${guidedSession()?.speakLineSkillIds.length ?? 2}` : `${scenario.title} · speak-first`,
    progress: attempt.grade ? 0.8 : Number.isFinite(attempt.revealedAt) ? 0.65 : 0.45
  });

  if (!Number.isFinite(attempt.revealedAt)) {
    const cue = addDataCard("INTENT");
    cue.append(element("p", "candidate-text", item.meaning));
    const timer = element("p", "timer", "0.0s");
    dom.screen.append(timer);
    const update = () => {
      const elapsed = Math.max(0, Date.now() - attempt.startedAt);
      timer.textContent = isAbort
        ? `${(elapsed / 1000).toFixed(1)}s · abort target ≤ ${(ABORT_TARGET_MS / 1000).toFixed(0)}s`
        : `${(elapsed / 1000).toFixed(1)}s · speak before revealing`;
      timer.classList.toggle("late", isAbort && elapsed > ABORT_TARGET_MS);
    };
    update();
    startTicker(update, 100);
    return setActions(
      { label: "Need help", onClick: () => revealActiveSpeaking(true) },
      { label: "I spoke", onClick: () => revealActiveSpeaking(false) }
    );
  }

  const card = element("article", attempt.grade ? "result-card" : "line-card");
  if (attempt.grade) card.dataset.result = attempt.grade === "clean" ? "correct" : "incorrect";
  card.append(element("p", attempt.grade ? "result-label" : "candidate-label", attempt.grade
    ? attempt.grade === "clean" ? "Said cleanly" : attempt.grade === "help" ? "Needed the reveal" : "Could not produce it"
    : `Compare · ${(attempt.responseMs / 1000).toFixed(1)}s`));
  const japanese = element("p", "line-japanese");
  appendJapanese(japanese, item.ja, { alwaysShow: true });
  card.append(japanese, element("p", "line-meaning", item.meaning));
  dom.screen.append(card);

  if (!attempt.grade) {
    dom.screen.append(element("p", "instruction", "Did you say the complete line correctly before the reveal?"));
    return setActions(
      { label: "No", onClick: () => gradeActiveSpeaking(false) },
      { label: "Yes", onClick: () => gradeActiveSpeaking(true) }
    );
  }

  return setActions(
    { label: isSession ? "End session" : "Done", onClick: isSession ? confirmEndSession : finishSpeakingAttempt },
    { label: isSession ? "Continue" : "Next line", onClick: isSession ? finishSpeakingAttempt : nextSoloSpeaking }
  );
}

function revealActiveSpeaking(usedHelp) {
  state = {
    ...state,
    speaking: {
      ...state.speaking,
      active: revealSpeakingAttempt(speakingAttempt(), { usedHelp, now: Date.now() })
    }
  };
  save();
  render();
}

function gradeActiveSpeaking(correct) {
  const active = speakingAttempt();
  const item = speakingItemForAttempt(active);
  const graded = gradeSpeakingAttempt(active, correct, Date.now());
  state = applyProductionObservation(state, graded.observation);
  if (active.source === "session") {
    state = {
      ...state,
      session: {
        ...state.session,
        active: recordSessionSpeaking(guidedSession(), item, graded.observation)
      }
    };
  }
  state = { ...state, speaking: { ...state.speaking, active: graded.attempt } };
  save();
  render();
}

function finishSpeakingAttempt() {
  const source = speakingAttempt()?.source;
  state = { ...state, speaking: { ...state.speaking, active: null } };
  save();
  if (source === "session") return resumeGuidedSession();
  show("home");
}

function nextSoloSpeaking() {
  const active = speakingAttempt();
  const scenario = scenarioById(active?.scenarioId);
  if (!active || !scenario) return finishSpeakingAttempt();
  const currentIndex = scenario.allowedUserLines.findIndex((line) => line.skillId === active.skillId);
  state = { ...state, speaking: { ...state.speaking, active: null } };
  save();
  beginSoloSpeaking(scenario.id, cycleIndex(currentIndex, scenario.allowedUserLines.length));
}

function renderSheetLine() {
  const scenario = scenarioById(screen.data.scenarioId);
  const lineIndex = screen.data.lineIndex ?? 0;
  const line = scenario.allowedUserLines[lineIndex];
  screenHeading("LIVE PHONE SHEET", scenario.title, scenario.purpose);
  setChrome({ title: "Only use these lines.", context: `Line ${lineIndex + 1} of ${scenario.allowedUserLines.length}`, progress: (lineIndex + 1) / scenario.allowedUserLines.length });
  const card = element("article", line.skillId === scenario.abortSkillId ? "line-card result-card" : "line-card");
  if (line.skillId === scenario.abortSkillId) card.dataset.result = "incorrect";
  const japanese = element("p", "line-japanese");
  appendJapanese(japanese, line.ja, { alwaysShow: true });
  const meaning = element("p", "line-meaning");
  appendJapanese(meaning, line.meaning, { alwaysShow: true });
  card.append(japanese, meaning);
  dom.screen.append(card);
  setActions(
    { label: "Done", onClick: () => show("home") },
    { label: "Next line →", onClick: () => show("sheet-line", { scenarioId: scenario.id, lineIndex: cycleIndex(lineIndex, scenario.allowedUserLines.length) }) }
  );
}

function renderFieldQuestion() {
  const scenario = scenarioById(screen.data.scenarioId);
  const decision = fieldDecision(screen.data.step);
  screenHeading("REAL CONVERSATION", decision.prompt, "Answer honestly. This changes priority but never claims BKT mastery.");
  setChrome({ title: scenario.title, context: `Field log · ${screen.data.step.replace("_", " ")}`, progress: screen.data.step === "worked" ? 0.35 : screen.data.step === "phone_sheet" ? 0.62 : 0.82 });
  addDataCard("SCENARIO", scenario.purpose);
  setActions(
    { label: "No", onClick: () => resolveFieldDecision(false) },
    { label: "Yes", onClick: () => resolveFieldDecision(true) }
  );
}

function resolveFieldDecision(answer) {
  const result = answerFieldDecision(screen.data.step, answer);
  if (result.next) return show("field-question", { scenarioId: screen.data.scenarioId, step: result.next });
  const now = Date.now();
  const scenarioId = screen.data.scenarioId;
  state = {
    ...state,
    updatedAt: now,
    repair: archiveCompletedRepair(state.repair),
    field: recordFieldOutcome(state.field, { scenarioId, outcome: result.outcome, at: now }),
    route: routeAfterFieldOutcome(state.route, { scenarioId, at: now })
  };
  save();
  show("field-result", { scenarioId, outcome: result.outcome });
}

function renderFieldResult() {
  const scenario = scenarioById(screen.data.scenarioId);
  const event = latestFieldOutcome(state.field, scenario.id);
  const canRepair = event && REPAIRABLE_FIELD_OUTCOMES.includes(event.outcome)
    && missionPack.missions.some((mission) => mission.scenarioId === scenario.id);
  screenHeading("FIELD RESULT SAVED", FIELD_LABELS[screen.data.outcome], "The real result is immutable. Practice may respond to it, but cannot rewrite it.");
  setChrome({ title: scenario.title, context: "Field log · saved locally", progress: 1 });
  const counts = fieldCounts(state.field, scenario.id);
  const list = element("ul", "metric-list");
  Object.entries(FIELD_LABELS).forEach(([key, label]) => list.append(metric(counts[key], label)));
  dom.screen.append(list);
  setActions(
    { label: "Home", onClick: () => show("home") },
    canRepair
      ? { label: "Repair now", onClick: () => startRepair(event) }
      : { label: "Practice next", onClick: () => showCard("solo") }
  );
}

function startRepair(event = latestRepairOffer()) {
  if (!event) return show("home");
  if (breakdownSession()) return show("breakdown-overview");
  if (guidedSession() && guidedSession().phase !== "complete") return show("session-overview");
  if (state.mission.active) return show("mission-turn");
  state = {
    ...state,
    repair: archiveCompletedRepair(state.repair),
    session: archiveCompletedSession(state.session)
  };
  const active = buildRepairSession({ event, items, missionPack, state, now: Date.now() });
  state = { ...state, repair: { ...state.repair, active } };
  save();
  cardUi = null;
  showCard("repair");
}

function repairWaitText(repair, now = Date.now()) {
  const remaining = Math.max(0, repair.revisitAt - now);
  if (remaining === 0) return "The ten-minute revisit is ready.";
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.ceil((remaining % 60000) / 1000);
  return `Revisit in ${minutes}:${String(seconds).padStart(2, "0")}. This countdown survives refresh.`;
}

function renderRepairOverview() {
  const repair = repairSession();
  const offer = latestRepairOffer();
  if (!repair) {
    if (!offer) {
      screenHeading("FIELD REPAIR", "Nothing needs repair.", "Log a difficult real conversation first.");
      setChrome({ title: "Field repair", context: "No pending result", progress: 0.1 });
      return setActions({ label: "Home", onClick: () => show("home") }, { label: "Log result", onClick: () => showScenarioChooser("field") });
    }
    const scenario = scenarioById(offer.scenarioId);
    screenHeading("FIELD REPAIR", `Repair ${scenario.title}.`, `${FIELD_LABELS[offer.outcome]} remains the real result. Two objective checks and a spoken revisit respond to it.`);
    setChrome({ title: "Close the field loop.", context: "Repair · ready", progress: 0.18 });
    return setActions({ label: "Not now", onClick: () => show("home") }, { label: "Start repair", onClick: () => startRepair(offer) });
  }
  const scenario = scenarioById(repair.scenarioId);
  const phaseCopy = {
    cards: `${repair.outcomes.length}/${repair.cardIds.length} objective checks complete.`,
    mission: repair.round === "revisit" ? "Repeat the same two spoken lines without furigana." : "Retrieve the weakest fixed response and timed abort.",
    waiting: repairWaitText(repair),
    complete: `Repair complete. The field log still says ${FIELD_LABELS[repair.fieldOutcome]}.`
  }[repair.phase];
  screenHeading("FIELD REPAIR", scenario.title, phaseCopy);
  setChrome({ title: "Repair one break.", context: `Repair · ${repair.phase}`, progress: { cards: 0.28, mission: 0.62, waiting: 0.82, complete: 1 }[repair.phase] });
  const stages = element("ol", "stage-list");
  const firstDone = repair.outcomes.length > 0;
  const readingDone = repair.outcomes.length > 1;
  const spokenDone = ["waiting", "complete"].includes(repair.phase) || repair.round === "revisit";
  [
    ["Recognize the partner prompt", firstDone],
    ["Read one difficult word", readingDone],
    ["Say the fixed response and abort", spokenDone],
    ["Ten-minute no-furigana revisit", repair.phase === "complete"]
  ].forEach(([label, done], index) => stages.append(element("li", done ? "done" : index === [firstDone, readingDone, spokenDone, repair.phase === "complete"].findIndex((value) => !value) ? "current" : "", label)));
  dom.screen.append(stages);
  if (repair.phase === "waiting") {
    const due = repair.revisitAt <= Date.now();
    setActions(
      { label: "Home", onClick: () => show("home") },
      { label: due ? "Start revisit" : "Not ready", disabled: !due, onClick: beginRevisit }
    );
    startTicker(() => {
      if (repair.revisitAt <= Date.now()) render();
      else {
        const copy = dom.screen.querySelector(".screen-copy");
        if (copy) copy.textContent = repairWaitText(repair);
      }
    });
    return;
  }
  if (repair.phase === "complete") {
    const summary = repair.revisit;
    dom.screen.append(metricCard(`${summary.clean}/${summary.total}`, `revisit lines clean · abort ${(summary.abortResponseMs / 1000).toFixed(1)}s`));
    return setActions(
      { label: "Home", onClick: () => show("home") },
      { label: "Archive", onClick: archiveRepair }
    );
  }
  setActions(
    { label: "End repair", onClick: confirmEndRepair },
    { label: repair.phase === "cards" ? "Continue checks" : state.mission.active ? "Resume speaking" : "Start speaking", onClick: continueRepair }
  );
}

function metricCard(value, label) {
  const card = element("article", "data-card");
  card.append(element("span", "metric-value", value), element("p", "screen-copy", label));
  return card;
}

function continueRepair() {
  const repair = repairSession();
  if (!repair) return startRepair();
  if (repair.phase === "cards") return showCard("repair");
  if (repair.phase === "mission") {
    if (!state.mission.active) startMissionRun(repair.mission, { mode: "production", hideFurigana: repair.round === "revisit" });
    return show("mission-turn");
  }
}

function beginRevisit() {
  const repair = repairSession();
  if (!repair || repair.revisitAt > Date.now()) return;
  state = { ...state, repair: { ...state.repair, active: beginRepairRevisit(repair) } };
  save();
  continueRepair();
}

function archiveRepair() {
  state = { ...state, repair: archiveCompletedRepair(state.repair) };
  save();
  show("home");
}

function confirmEndRepair() {
  show("confirm", {
    kicker: "END REPAIR",
    title: "Keep the evidence and stop?",
    copy: "The original field result and all completed evidence remain unchanged.",
    no: () => show("repair-overview"),
    yes: endRepair
  });
}

function endRepair() {
  const repair = repairSession();
  const ownsMission = repair?.mission?.id === state.mission.active?.missionId;
  state = {
    ...state,
    repair: { ...state.repair, active: null },
    mission: ownsMission ? { ...state.mission, active: null } : state.mission
  };
  save();
  show("home");
}

function showMissionChooser(index = 0) {
  show("mission-chooser", { index });
}

function renderMissionChooser() {
  if (state.mission.active) return show("mission-turn");
  const choices = [...missionPack.missions, { id: "__back", title: "Back to menu", purpose: "Leave without starting a mission." }];
  const index = screen.data.index ?? 0;
  const mission = choices[index];
  screenHeading("CHOOSE A MISSION", mission.title, mission.purpose);
  setChrome({ title: "Which closed loop?", context: `${index + 1} of ${choices.length}`, progress: 0.2 });
  if (mission.id !== "__back") {
    const stats = state.mission.stats?.[mission.id];
    addMeta(`${mission.steps.length} turns`, `${stats?.runs ?? 0} prior runs`, stats?.lastOutcome ? `last: ${stats.lastOutcome}` : "not run yet");
  }
  setActions(
    { label: "Another →", onClick: () => showMissionChooser(cycleIndex(index, choices.length)) },
    { label: mission.id === "__back" ? "Back" : "Choose", onClick: () => mission.id === "__back" ? show("tools", { index: 0 }) : show("mission-mode", { missionId: mission.id }) }
  );
}

function renderMissionMode() {
  const mission = missionById(missionPack, screen.data.missionId);
  screenHeading("MISSION MODE", "Speak before seeing the line?", "Yes records separate production evidence. No tests objective response recognition through the same fixed loop.");
  setChrome({ title: mission.title, context: "Mission setup · mode", progress: 0.34 });
  setActions(
    { label: "No · choose", onClick: () => show("mission-challenge", { missionId: mission.id, mode: "recognition" }) },
    { label: "Yes · speak", onClick: () => show("mission-challenge", { missionId: mission.id, mode: "production" }) }
  );
}

function renderMissionChallenge() {
  const mission = missionById(missionPack, screen.data.missionId);
  screenHeading("FURIGANA CHECK", "Hide furigana for this run?", "Choose yes only when you want every mission prompt and response unsupported.");
  setChrome({ title: mission.title, context: `Mission setup · ${screen.data.mode}`, progress: 0.46 });
  setActions(
    { label: "No · supported", onClick: () => launchManualMission(false) },
    { label: "Yes · hide it", onClick: () => launchManualMission(true) }
  );
}

function launchManualMission(hideFurigana) {
  const mission = missionById(missionPack, screen.data.missionId);
  startMissionRun(mission, { mode: screen.data.mode, hideFurigana });
  show("mission-turn");
}

function startMissionRun(mission, options) {
  completedMissionRun = null;
  missionChoiceUi = null;
  missionAudioUi = null;
  state = { ...state, mission: { ...state.mission, active: createMissionRun(mission, Date.now(), options) } };
  save();
}

function ensureMissionChoice(run, step) {
  const key = `${run.missionId}.${run.stepIndex}`;
  if (missionChoiceUi?.key !== key) missionChoiceUi = {
    key,
    optionIndex: run.recognitionOptionIndex ?? 0,
    rejectedCorrect: run.recognitionRejectedCorrect ?? false
  };
}

function ensureMissionAudio(run, step) {
  const key = `${run.missionId}.${run.stepIndex}.${step.id}`;
  if (missionAudioUi?.key !== key) missionAudioUi = {
    key,
    played: false,
    ready: deviceSpeech.status === "unavailable",
    transcriptRevealed: deviceSpeech.status === "unavailable"
  };
}

function renderMissionTurn() {
  const run = state.mission.active;
  const mission = missionForId(run?.missionId);
  if (!run || !mission) return show("home");
  const step = mission.steps[run.stepIndex];
  ensureMissionChoice(run, step);
  ensureMissionAudio(run, step);
  const isAbort = step.targetSkillId === "abort.wakarimasen";
  screenHeading(isAbort ? "OFF SCRIPT" : "PARTNER", `Turn ${run.stepIndex + 1} of ${mission.steps.length}`, run.mode === "production"
    ? !missionAudioUi.ready ? "Hear your partner first. Their written line stays hidden." : isAbort ? "Say the abort now. Target five seconds." : "Say your fixed response aloud. No microphone is listening."
    : !missionAudioUi.ready ? "Hear your partner first. Their written line stays hidden." : isAbort ? "Choose the pre-decided recovery. Do not improvise." : "Decide whether the candidate is your fixed response.");
  setChrome({ title: mission.title, context: `${run.mode} · ${deviceSpeech.status === "ready" ? "audio-first" : "text fallback"} · ${run.hideFurigana ? "no furigana" : "furigana supported"}`, progress: 0.48 + (run.stepIndex / mission.steps.length) * 0.38 });
  if (missionAudioUi.transcriptRevealed || run.awaitingAdvance) {
    const prompt = element("p", "prompt-japanese");
    appendJapanese(prompt, step.prompt, { alwaysShow: !run.hideFurigana, neverShow: run.hideFurigana });
    dom.screen.append(prompt);
  } else if (!missionAudioUi.ready) {
    const audio = element("article", "audio-card");
    audio.append(
      element("p", "candidate-label", missionAudioUi.played ? "PARTNER AUDIO HEARD" : "PARTNER AUDIO"),
      element("p", "audio-symbol", "♪"),
      element("p", "screen-copy", deviceSpeech.status === "ready"
        ? missionAudioUi.played ? "Replay if useful, then respond without seeing the transcript." : "Listen before choosing or speaking your fixed response."
        : deviceSpeech.reason)
    );
    dom.screen.append(audio);
  }
  if (run.currentHintUsed || run.awaitingAdvance) {
    const meaning = element("p", "line-meaning");
    appendJapanese(meaning, step.meaning, { alwaysShow: true });
    dom.screen.append(meaning);
  }

  if (run.awaitingAdvance) return renderMissionFeedback(run, mission, step);
  if (!missionAudioUi.ready) return renderMissionAudioDecision(run, step);
  if (run.mode === "production") return renderProductionDecision(run, mission, step);
  renderRecognitionDecision(run, mission, step);
}

function renderMissionAudioDecision(run, step) {
  if (deviceSpeech.status === "ready") {
    setActions(
      missionAudioUi.played
        ? { label: "Replay", onClick: () => playMissionAudio(run, step) }
        : { label: "Show text", onClick: revealMissionTranscript },
      { label: missionAudioUi.played ? "Respond" : "Play audio", onClick: () => missionAudioUi.played ? beginMissionResponse() : playMissionAudio(run, step) }
    );
    return;
  }
  setActions(
    { label: "End run", onClick: confirmEndMission },
    { label: "Text fallback", onClick: beginMissionTextFallback }
  );
}

function playMissionAudio(run, step) {
  const key = missionAudioUi.key;
  const result = speakJapanese(step.promptReading, {
    onError: () => {
      if (missionAudioUi?.key !== key) return;
      deviceSpeech = { status: "unavailable", voice: null, reason: "The Japanese device voice could not play this partner line." };
      render();
    }
  });
  if (!result.ok) {
    deviceSpeech = { status: result.status, voice: null, reason: result.reason };
    return render();
  }
  missionAudioUi.played = true;
  render();
}

function beginMissionResponse() {
  stopJapaneseSpeech();
  missionAudioUi.ready = true;
  state = {
    ...state,
    mission: { ...state.mission, active: { ...state.mission.active, stepStartedAt: Date.now() } }
  };
  save();
  render();
}

function revealMissionTranscript() {
  stopJapaneseSpeech();
  missionAudioUi.ready = true;
  missionAudioUi.transcriptRevealed = true;
  const run = revealMissionHint(state.mission.active);
  state = { ...state, mission: { ...state.mission, active: { ...run, stepStartedAt: Date.now() } } };
  save();
  render();
}

function beginMissionTextFallback() {
  stopJapaneseSpeech();
  missionAudioUi.ready = true;
  missionAudioUi.transcriptRevealed = true;
  state = {
    ...state,
    mission: { ...state.mission, active: { ...state.mission.active, stepStartedAt: Date.now() } }
  };
  save();
  render();
}

function renderProductionDecision(run, mission, step) {
  const isAbort = step.targetSkillId === "abort.wakarimasen";
  if (!run.productionRevealed) {
    const timer = element("p", "timer", "0.0s");
    dom.screen.append(timer);
    const update = () => {
      const elapsed = Math.max(0, Date.now() - run.stepStartedAt);
      timer.textContent = isAbort
        ? `${(elapsed / 1000).toFixed(1)}s · abort target ≤ ${(ABORT_TARGET_MS / 1000).toFixed(0)}s`
        : `${(elapsed / 1000).toFixed(1)}s · speak before revealing`;
      timer.classList.toggle("late", isAbort && elapsed > ABORT_TARGET_MS);
    };
    update();
    startTicker(update, 100);
    setActions(
      { label: "Need help", onClick: revealProductionWithHelp },
      { label: "I spoke", onClick: revealProduction }
    );
    return;
  }
  const line = missionLines.get(step.targetSkillId);
  const card = element("article", "line-card");
  card.append(element("p", "candidate-label", `Compare · ${(run.productionResponseMs / 1000).toFixed(1)}s`));
  const japanese = element("p", "line-japanese");
  appendJapanese(japanese, line.ja, { alwaysShow: !run.hideFurigana, neverShow: run.hideFurigana });
  const meaning = element("p", "line-meaning");
  appendJapanese(meaning, line.meaning, { alwaysShow: true });
  card.append(japanese, meaning);
  dom.screen.append(card, element("p", "instruction", "Did you say it correctly?"));
  setActions(
    { label: "No", onClick: () => gradeProduction(false) },
    { label: "Yes", onClick: () => gradeProduction(true) }
  );
}

function revealProductionWithHelp() {
  const run = revealMissionHint(state.mission.active);
  state = { ...state, mission: { ...state.mission, active: revealProductionAnswer(run) } };
  save();
  render();
}

function revealProduction() {
  state = { ...state, mission: { ...state.mission, active: revealProductionAnswer(state.mission.active) } };
  save();
  render();
}

function gradeProduction(correct) {
  const active = state.mission.active;
  const mission = missionForId(active.missionId);
  const run = gradeProductionStep(active, mission, correct ? "clean" : "miss");
  state = applyProductionObservation(state, run.observations.at(-1));
  state = { ...state, mission: { ...state.mission, active: run } };
  save();
  render();
}

function renderRecognitionDecision(run, mission, step) {
  const choiceSkillIds = missionChoiceSkillIds(run, step);
  const skillId = choiceSkillIds[missionChoiceUi.optionIndex];
  const line = missionLines.get(skillId);
  const candidate = element("article", "candidate-card");
  candidate.append(element("p", "candidate-label", `Candidate ${missionChoiceUi.optionIndex + 1} of ${choiceSkillIds.length}`));
  const japanese = element("p", "candidate-text candidate-japanese");
  appendJapanese(japanese, line.ja, { neverShow: run.hideFurigana });
  candidate.append(japanese);
  dom.screen.append(candidate);
  setActions(
    { label: "No", onClick: () => answerMissionCandidate(false) },
    { label: "Yes", onClick: () => answerMissionCandidate(true) }
  );
}

function answerMissionCandidate(accepted) {
  const active = state.mission.active;
  const mission = missionForId(active.missionId);
  const step = mission.steps[active.stepIndex];
  const choiceSkillIds = missionChoiceSkillIds(active, step);
  const options = choiceSkillIds.map((id) => ({ id, correct: id === step.targetSkillId }));
  const decision = candidateAnswer({ options, index: missionChoiceUi.optionIndex, rejectedCorrect: missionChoiceUi.rejectedCorrect, accepted });
  if (!decision.complete) {
    missionChoiceUi.optionIndex = decision.nextIndex;
    missionChoiceUi.rejectedCorrect = decision.rejectedCorrect;
    state = {
      ...state,
      mission: {
        ...state.mission,
        active: {
          ...active,
          recognitionOptionIndex: decision.nextIndex,
          recognitionRejectedCorrect: decision.rejectedCorrect
        }
      }
    };
    save();
    return render();
  }
  const selected = accepted
    ? options[missionChoiceUi.optionIndex].id
    : null;
  const run = answerMissionStep(active, mission, selected);
  const observation = run.observations.at(-1);
  const evidenceCorrect = observation.evidenceCorrect && !missionChoiceUi.rejectedCorrect;
  const observationItem = {
    id: `mission.${mission.id}.${step.id}.${observation.observedAt}`,
    skillId: observation.skillId,
    options: choiceSkillIds.map((id) => ({ id }))
  };
  state = observation.usedHint && observation.answerCorrect && !missionChoiceUi.rejectedCorrect
    ? recordAssistedObservation(state, observationItem, observation.observedAt, { source: "hint" })
    : applyObservation(state, observationItem, evidenceCorrect, observation.observedAt, { source: "mission" });
  if (evidenceCorrect !== observation.evidenceCorrect) {
    const observations = [...run.observations];
    observations[observations.length - 1] = { ...observation, evidenceCorrect };
    state = { ...state, mission: { ...state.mission, active: { ...run, observations } } };
  } else {
    state = { ...state, mission: { ...state.mission, active: run } };
  }
  save();
  render();
}

function renderMissionFeedback(run, mission, step) {
  const observation = run.observations.at(-1);
  const line = missionLines.get(step.targetSkillId);
  const correct = run.mode === "production" ? observation.grade === "clean" : observation.evidenceCorrect;
  const card = element("article", "result-card");
  card.dataset.result = correct ? "correct" : "incorrect";
  const label = run.mode === "production"
    ? observation.grade === "clean" ? "Said cleanly" : observation.grade === "help" ? "Help recorded" : "Miss recorded"
    : observation.evidenceCorrect
      ? "Correct"
      : observation.answerCorrect && observation.usedHint
        ? "Correct with a hint"
        : observation.answerCorrect ? "Correct after rejecting it" : "Review the fixed response";
  card.append(element("p", "result-label", label));
  const japanese = element("p", "line-japanese");
  appendJapanese(japanese, line.ja, { alwaysShow: true });
  const meaning = element("p", "line-meaning");
  appendJapanese(meaning, line.meaning, { alwaysShow: true });
  card.append(japanese, meaning);
  dom.screen.append(card);
  setActions(
    { label: "End run", onClick: confirmEndMission },
    { label: run.stepIndex === mission.steps.length - 1 ? "Finish" : "Continue", onClick: advanceMission }
  );
}

function advanceMission() {
  const active = state.mission.active;
  const mission = missionForId(active.missionId);
  const run = advanceMissionRun(active, mission);
  missionChoiceUi = null;
  missionAudioUi = null;
  if (!run.completed) {
    state = { ...state, mission: { ...state.mission, active: run } };
    save();
    return render();
  }
  completedMissionRun = run;
  const repair = repairSession();
  const session = guidedSession();
  const completedRepair = repair?.phase === "mission" && repair.mission.id === run.missionId;
  const completedGuided = session?.phase === "mission" && session.missionId === run.missionId;
  if (completedRepair) {
    state = {
      ...state,
      mission: { ...state.mission, active: null },
      repair: { ...state.repair, active: completeRepairRound(repair, run, run.completedAt) }
    };
  } else {
    state = { ...state, mission: recordMissionCompletion(state.mission, run) };
  }
  if (completedGuided && !completedRepair) {
    state = { ...state, session: { ...state.session, active: completeGuidedSession(session, run, run.completedAt) } };
  }
  save();
  if (completedRepair) return show("repair-overview");
  if (completedGuided) return show("session-summary");
  show("mission-complete");
}

function renderMissionComplete() {
  const run = completedMissionRun;
  if (!run) return show("home");
  const mission = missionById(missionPack, run.missionId);
  const wording = {
    clean: ["Closed loop complete.", "Every fixed response worked, including the timed abort."],
    recovered: ["Recovered safely.", "The abort was available, but at least one earlier line needed support."],
    failed: ["Run the loop again.", "The final open turn was not recovered with the fixed abort."]
  }[run.outcome];
  screenHeading(run.outcome.toUpperCase(), wording[0], wording[1]);
  setChrome({ title: mission.title, context: `Mission · ${run.mode}`, progress: 1 });
  const clean = run.mode === "production"
    ? run.observations.filter((entry) => entry.grade === "clean").length
    : run.observations.filter((entry) => entry.evidenceCorrect).length;
  const metrics = element("ul", "metric-list");
  metrics.append(metric(`${clean}/${run.observations.length}`, run.mode === "production" ? "spoken clean" : "objective correct"), metric(run.hints, "hints used"), metric(`${(run.completedAt - run.startedAt) / 1000}s`, "total duration"));
  dom.screen.append(metrics);
  setActions(
    { label: "Home", onClick: () => show("home") },
    { label: "Run again", onClick: () => { startMissionRun(mission, { mode: run.mode, hideFurigana: run.hideFurigana }); show("mission-turn"); } }
  );
}

function confirmEndMission() {
  show("confirm", {
    kicker: "END MISSION",
    title: "Keep the evidence and stop?",
    copy: "Anything already answered remains recorded.",
    no: () => show("mission-turn"),
    yes: endMission
  });
}

function endMission() {
  const missionId = state.mission.active?.missionId;
  const repairOwned = repairSession()?.mission.id === missionId;
  const sessionOwned = guidedSession()?.missionId === missionId;
  state = { ...state, mission: { ...state.mission, active: null } };
  save();
  if (repairOwned) return show("repair-overview");
  if (sessionOwned) return show("session-overview");
  show("home");
}

function renderRouteHome() {
  const route = state.route;
  if (!route?.scenarioId || !route.eventAt) return showScenarioChooser("route");
  const scenario = scenarioById(route.scenarioId);
  const status = showtimeStatus(route, state.field);
  const minutes = Math.max(0, Math.round((route.eventAt - Date.now()) / 60000));
  screenHeading(
    status.phase === "field" ? "AFTER THE EVENT" : status.phase === "showtime" ? "SHOWTIME" : "NEXT REAL EVENT",
    scenario.title,
    status.phase === "field"
      ? "The scheduled time has passed. Log the real outcome so practice can respond honestly."
      : status.phase === "showtime"
        ? `${minutes} minutes away. Home now opens the phone sheet with the abort line pinned beside it.`
        : `About ${minutes} minutes away. Route urgency currently outranks ordinary due-date ordering.`
  );
  setChrome({ title: status.phase === "field" ? "Close the field loop." : status.phase === "showtime" ? "The prepared exchange is ready." : "Route boost is active.", context: status.phase === "scheduled" ? "Scheduler priority" : "Showtime", progress: status.phase === "scheduled" ? 0.7 : 0.92 });
  if (status.phase === "field") return setActions(
    { label: "Clear event", onClick: clearRoute },
    { label: "Log outcome", onClick: () => show("field-question", { scenarioId: scenario.id, step: FIELD_DECISION_START }) }
  );
  if (status.phase === "showtime") return setActions(
    { label: "Abort line", onClick: () => show("abort") },
    { label: "Open sheet", onClick: () => show("sheet-line", { scenarioId: scenario.id, lineIndex: 0 }) }
  );
  setActions(
    { label: "Clear boost", onClick: clearRoute },
    { label: "Change", onClick: () => showScenarioChooser("route") }
  );
}

function renderRouteTime() {
  const scenario = scenarioById(screen.data.scenarioId);
  const index = screen.data.index ?? 0;
  const minutes = ROUTE_MINUTES[index];
  screenHeading("EVENT TIME", `Is it about ${minutes < 60 ? `${minutes} minutes` : `${minutes / 60} hours`} away?`, "Choose this interval, or move through the useful trip-time presets.");
  setChrome({ title: scenario.title, context: `Time choice · ${index + 1} of ${ROUTE_MINUTES.length}`, progress: 0.56 });
  setActions(
    { label: "Another →", onClick: () => show("route-time", { scenarioId: scenario.id, index: cycleIndex(index, ROUTE_MINUTES.length) }) },
    { label: "Set boost", onClick: () => setRoute(scenario.id, minutes) }
  );
}

function setRoute(scenarioId, minutes) {
  state = { ...state, route: { scenarioId, eventAt: Date.now() + minutes * 60000 } };
  save();
  show("route-home");
}

function clearRoute() {
  state = { ...state, route: { scenarioId: null, eventAt: null } };
  save();
  show("home");
}

function renderMapHome() {
  const focus = state.focus;
  if (focus?.scenarioId || focus?.skillId) {
    screenHeading("SKILL PATH", "Practice focus is active.", "Clear it to return to ordinary cram, route, and field ordering—or browse a different skill.");
    setChrome({ title: "Focused practice", context: focus.skillId ?? focus.scenarioId, progress: 0.32 });
    return setActions({ label: "Clear focus", onClick: clearFocus }, { label: "Browse skills", onClick: () => show("map-island", { index: 0 }) });
  }
  show("map-island", { index: 0 });
}

function currentMap() {
  return buildSkillMap({ content, tree, readings, state, currentItem: selectNextItem(schedulableItems(), tree, state) });
}

function renderMapIsland() {
  const model = currentMap();
  const choices = [...model.islands, { id: "__back", title: "Back to menu", purpose: "Leave the skill path." }];
  const index = screen.data.index ?? 0;
  const island = choices[index];
  screenHeading("SKILL PATH", island.title, island.purpose);
  setChrome({ title: "Choose one scenario.", context: `${index + 1} of ${choices.length}`, progress: 0.28 });
  if (island.id !== "__back") {
    const orbit = element("div", "progress-orbit");
    const total = island.recognizeTotal + island.sayTotal;
    const ready = island.recognizeReady + island.sayReady;
    orbit.style.setProperty("--value", `${ready / Math.max(1, total) * 360}deg`);
    orbit.append(element("span", "", `${ready}/${total}`));
    dom.screen.append(orbit);
    addMeta(
      island.conversationReady ? "conversation ready" : "conversation not ready",
      `${island.recognizeReady}/${island.recognizeTotal} recognize-ready`,
      `${island.sayReady}/${island.sayTotal} say-ready`,
      `${island.hearingReady}/${island.hearingTotal} hear-ready`,
      `${island.facetReady}/${island.facetTotal} word facets`,
      `${island.readingReady}/${island.readingTotal} sounds retired`
    );
  }
  setActions(
    { label: "Another →", onClick: () => show("map-island", { index: cycleIndex(index, choices.length) }) },
    { label: island.id === "__back" ? "Back" : "Open path", onClick: () => island.id === "__back" ? show("tools", { index: 0 }) : show("map-skill", { scenarioId: island.id, index: 0 }) }
  );
}

function mapSkillsForScenario(scenarioId) {
  const island = currentMap().islands.find((candidate) => candidate.id === scenarioId);
  const wordNodes = island.words.map((word) => ({
    id: `word.${word.id}`,
    label: `${word.term} · ${word.reading}`,
    meaning: word.meaning,
    status: word.status,
    knownPercent: word.knownPercent,
    attempts: word.attempts,
    prerequisites: [],
    word: true,
    facets: word.facets,
    facetReady: word.ready,
    facetTotal: word.total,
    targetSkillId: word.targetSkillId
  }));
  return [...island.nodes, ...wordNodes, { id: "__back", label: "Back to scenarios", back: true }];
}

function renderMapSkill() {
  const scenario = scenarioById(screen.data.scenarioId);
  const skills = mapSkillsForScenario(scenario.id);
  const index = screen.data.index ?? 0;
  const skill = skills[index];
  screenHeading(
    skill.word ? "WORD FACETS" : "ONE SKILL",
    skill.label,
    skill.back
      ? "Return to the scenario chooser."
      : skill.word
        ? skill.meaning
        : "This is one node in the prerequisite path. Practice resolves a locked node to its earliest available prerequisite."
  );
  setChrome({ title: scenario.title, context: `${index + 1} of ${skills.length}`, progress: 0.5 });
  if (!skill.back) {
    addMeta(
      skill.status,
      `${skill.knownPercent}% average BKT`,
      `${skill.attempts} checks`,
      skill.fixedLine ? `${skill.productionAttempts} spoken · ${skill.sayReady ? "say-ready" : "needs speaking"}` : null,
      skill.word ? `${skill.facetReady}/${skill.facetTotal} facets ready` : `${skill.prerequisites.length} prerequisites`
    );
    const label = dom.screen.querySelector(".screen-title");
    appendJapanese(label, skill.label, { alwaysShow: true });
    if (skill.word) {
      const facets = element("ol", "stage-list");
      for (const facet of skill.facets) {
        facets.append(element(
          "li",
          facet.ready ? "done" : facet.skillId === skill.targetSkillId ? "current" : "",
          `${facet.label}: ${facet.direction} · ${facet.knownPercent}% BKT · ${facet.status}`
        ));
      }
      dom.screen.append(facets);
    }
  }
  setActions(
    { label: "Next skill →", onClick: () => show("map-skill", { scenarioId: scenario.id, index: cycleIndex(index, skills.length) }) },
    {
      label: skill.back ? "Back" : skill.word ? "Practice weakest" : skill.fixedLine && !skill.sayReady ? "Practice speaking" : "Practice",
      onClick: () => skill.back
        ? show("map-island", { index: 0 })
        : skill.fixedLine && !skill.sayReady
          ? beginSkillSpeaking(scenario.id, skill.id)
          : focusSkill(skill.targetSkillId ?? skill.id)
    }
  );
}

function beginSkillSpeaking(scenarioId, skillId) {
  const scenario = scenarioById(scenarioId);
  const index = scenario?.allowedUserLines.findIndex((line) => line.skillId === skillId) ?? -1;
  if (index < 0) return showToast("No fixed line found");
  beginSoloSpeaking(scenarioId, index);
}

function focusSkill(skillId) {
  const target = practiceTargetFor(tree, state, skillId);
  const item = items.find((candidate) => candidate.skillId === target);
  if (!target || !item) return showToast("No available prerequisite card");
  state = { ...state, focus: { scenarioId: item.scenarioId, skillId: target, mode: null } };
  save();
  showCard("solo", item.id);
}

function clearFocus() {
  state = { ...state, focus: { scenarioId: null, skillId: null, mode: null } };
  save();
  show("home");
}

function openRoleplay() {
  if (!roleplay.available) return show("roleplay-unavailable");
  if (!readRoleplayAccessToken()) return show("roleplay-auth");
  showScenarioChooser("roleplay");
}

function renderRoleplayAuth() {
  screenHeading("OPTIONAL ROLEPLAY", "Enter the private access token.", "The token stays in this browser, is never included in a progress backup, and protects the routed provider from public use.");
  setChrome({ title: "Unlock routed roleplay.", context: "Roleplay · local credential", progress: 0.3 });
  const label = element("label", "textarea-label", "ACCESS TOKEN");
  label.htmlFor = "roleplay-token";
  const input = element("input");
  input.id = "roleplay-token";
  input.type = "password";
  input.autocomplete = "off";
  input.value = readRoleplayAccessToken();
  dom.screen.append(label, input);
  setActions(
    { label: "Back", onClick: () => show("tools", { index: 0 }) },
    { label: "Save", onClick: () => saveRoleplayTokenAndContinue(input.value) }
  );
  input.focus();
}

function saveRoleplayTokenAndContinue(raw) {
  if (!saveRoleplayAccessToken(raw)) return showToast("Enter the configured access token");
  showScenarioChooser("roleplay");
}

function renderRoleplayUnavailable() {
  screenHeading("OPTIONAL ROLEPLAY", "The routed partner is off.", roleplay.reason || "Configure the OpenAI-compatible HTTP proxy to enable it. Offline cards and missions remain fully available.");
  setChrome({ title: "Offline path is ready.", context: "Roleplay · optional", progress: 0.2 });
  setActions(
    { label: "Home", onClick: () => show("home") },
    { label: "Offline mission", onClick: showMissionChooser }
  );
}

function roleplayLineChoices(scenario) {
  return [
    ...scenario.allowedUserLines.map((line) => ({ ...line, id: line.skillId })),
    { id: "__custom", ja: "Type my own Japanese", meaning: "Compose a bounded custom attempt." },
    { id: "__restart", ja: "Restart this exchange", meaning: "Clear the temporary transcript." },
    { id: "__back", ja: "Back to menu", meaning: "Leave roleplay." }
  ];
}

function renderRoleplayLine() {
  const scenario = scenarioById(screen.data.scenarioId);
  const choices = roleplayLineChoices(scenario);
  const index = screen.data.index ?? 0;
  const choice = choices[index];
  screenHeading("YOUR NEXT LINE", scenario.title, choice.meaning);
  setChrome({ title: "Choose what to send.", context: `${index + 1} of ${choices.length} · ${roleplay.model}`, progress: 0.42 });
  const card = element("article", "candidate-card");
  const japanese = element("p", "candidate-text candidate-japanese");
  appendJapanese(japanese, choice.ja, { alwaysShow: true });
  card.append(japanese);
  dom.screen.append(card);
  setActions(
    { label: "Another →", onClick: () => show("roleplay-line", { scenarioId: scenario.id, index: cycleIndex(index, choices.length) }) },
    { label: choice.id.startsWith("__") ? choice.id === "__back" ? "Back" : choice.id === "__restart" ? "Restart" : "Type" : "Use line", onClick: () => chooseRoleplayLine(scenario, choice) }
  );
}

function chooseRoleplayLine(scenario, choice) {
  if (choice.id === "__back") return show("tools", { index: 0 });
  if (choice.id === "__restart") {
    roleplay.history = [];
    roleplay.pending = null;
    roleplay.draft = "";
    return show("roleplay-line", { scenarioId: scenario.id, index: 0 });
  }
  roleplay.draft = choice.id === "__custom" ? "" : choice.ja;
  show("roleplay-compose", { scenarioId: scenario.id });
}

function renderRoleplayCompose() {
  const scenario = scenarioById(screen.data.scenarioId);
  screenHeading("ROLEPLAY TURN", "Send one Japanese attempt.", "Only this typed text and the short exchange history use the configured network provider.");
  setChrome({ title: scenario.title, context: `Roleplay · ${roleplay.model}`, progress: 0.62 });
  renderTranscript();
  const label = element("label", "textarea-label", "YOUR JAPANESE");
  label.htmlFor = "roleplay-draft";
  const textarea = element("textarea");
  textarea.id = "roleplay-draft";
  textarea.maxLength = 500;
  textarea.value = roleplay.draft;
  textarea.placeholder = "Type Japanese…";
  dom.screen.append(label, textarea);
  setActions(
    { label: "Change line", onClick: () => { roleplay.draft = textarea.value; show("roleplay-line", { scenarioId: scenario.id, index: 0 }); } },
    { label: "Send", onClick: () => sendRoleplay(scenario.id, textarea.value) }
  );
  textarea.focus();
}

function renderTranscript() {
  if (roleplay.history.length === 0) return;
  const transcript = element("div", "transcript");
  for (const entry of roleplay.history.slice(-6)) {
    const message = element("article", entry.role === "user" ? "user" : "assistant");
    message.append(element("p", "transcript-label", entry.role === "user" ? "You" : "Partner"));
    const line = element("p");
    appendJapanese(line, entry.content, { alwaysShow: true });
    message.append(line);
    transcript.append(message);
  }
  dom.screen.append(transcript);
}

async function sendRoleplay(scenarioId, raw) {
  const userText = raw.trim();
  if (!userText) return showToast("Type one Japanese line first");
  const priorHistory = [...roleplay.history];
  roleplay.draft = userText;
  show("roleplay-wait", { scenarioId });
  try {
    const result = await requestRoleplay({ scenarioId, history: priorHistory, userText });
    roleplay.history = [
      ...priorHistory,
      { role: "user", content: userText },
      { role: "assistant", content: result.staffReply.ja }
    ].slice(-12);
    roleplay.pending = result;
    roleplay.draft = "";
    show("roleplay-result", { scenarioId });
  } catch (error) {
    show("roleplay-error", { scenarioId, message: error.message });
  }
}

function renderRoleplayWait() {
  screenHeading("ROLEPLAY TURN", "Waiting for the partner…", "Provider failure cannot block offline practice.");
  setChrome({ title: "Sending one turn.", context: "Optional network sensor", progress: 0.76 });
  setActions();
}

function renderRoleplayResult() {
  const result = roleplay.pending;
  if (!result) return show("roleplay-line", { scenarioId: screen.data.scenarioId, index: 0 });
  screenHeading("SENSOR OBSERVATION", "Review before applying.", "The model is a sensor, never mastery authority. You decide whether its structured observations enter local BKT.");
  setChrome({ title: "Partner replied.", context: "Roleplay · review", progress: 0.9 });
  const card = element("article", "line-card");
  const japanese = element("p", "line-japanese");
  if (result.staffReply.parts) appendProviderParts(japanese, result.staffReply.parts);
  else appendJapanese(japanese, result.staffReply.ja, { alwaysShow: true });
  const meaning = element("p", "line-meaning");
  appendJapanese(meaning, result.staffReply.meaning, { alwaysShow: true });
  card.append(japanese, meaning);
  dom.screen.append(card);
  const list = element("ul", "metric-list");
  for (const observation of result.observations) list.append(metric(observation.outcome.replace("_", " "), skillLabel(observation.skillId)));
  if (result.hint) list.append(metric("hint", result.hint));
  dom.screen.append(list);
  setActions(
    { label: "Discard", onClick: () => finishRoleplayReview(false) },
    { label: "Apply", onClick: () => finishRoleplayReview(true) }
  );
}

function finishRoleplayReview(apply) {
  if (apply && roleplay.pending) {
    let applied = 0;
    for (const observation of roleplay.pending.observations) {
      if (observation.outcome === "not_tested") continue;
      const item = { id: `roleplay.${observation.skillId}.${Date.now()}`, skillId: observation.skillId };
      state = observation.outcome === "partial"
        ? recordAssistedObservation(state, item, Date.now() + applied, { source: "roleplay" })
        : applyObservation(
          state,
          item,
          observation.outcome === "success",
          Date.now() + applied,
          { source: "roleplay", guessProbability: 1 / 3 }
        );
      applied += 1;
    }
    save();
    showToast(`${applied} reviewed ${applied === 1 ? "observation" : "observations"} applied`);
  }
  roleplay.pending = null;
  show("roleplay-line", { scenarioId: screen.data.scenarioId, index: 0 });
}

function renderRoleplayError() {
  screenHeading("ROLEPLAY UNAVAILABLE", "The partner did not answer.", screen.data.message);
  setChrome({ title: "Offline practice is unaffected.", context: "Provider error", progress: 0.7 });
  setActions(
    { label: "Offline mission", onClick: showMissionChooser },
    { label: /access token|401/i.test(screen.data.message) ? "Change token" : "Try again", onClick: () => /access token|401/i.test(screen.data.message)
      ? show("roleplay-auth")
      : show("roleplay-compose", { scenarioId: screen.data.scenarioId }) }
  );
}

function renderShare() {
  screenHeading("SHARE KAIWA", "Open the trip loop on a phone.", "Scan with the phone camera. The app loads from Vercel and can then be installed for offline use.");
  setChrome({ title: "Scan this code.", context: "Public Kaiwa URL", progress: 0.8 });
  const card = element("div", "qr-card");
  const image = element("img");
  image.id = "kaiwa-share-qr";
  image.src = "./qr-kaiwa.svg";
  image.width = 180;
  image.height = 180;
  image.alt = `QR code linking to ${PRODUCTION_URL}`;
  card.id = "kaiwa-share";
  card.append(image, element("p", "share-url", PRODUCTION_URL));
  dom.screen.append(card);
  setActions(
    { label: "Home", onClick: () => show("home") },
    { label: "Practice", onClick: resumePractice }
  );
}

function progressChoices() {
  return [
    { id: "download", title: "Download progress", copy: "Save this device's state as a JSON backup." },
    { id: "restore", title: "Restore backup", copy: "Choose a Kaiwa JSON file and migrate it safely." },
    { id: "reset", title: "Reset local progress", copy: "Delete practice state from this browser only." },
    { id: "back", title: "Back to menu", copy: "Leave without changing progress." }
  ];
}

function renderProgressMenu() {
  const choices = progressChoices();
  const index = screen.data.index ?? 0;
  const choice = choices[index];
  screenHeading("LOCAL PROGRESS", choice.title, choice.copy);
  setChrome({ title: "Progress stays yours.", context: `${index + 1} of ${choices.length} · no account`, progress: 0.35 });
  addMeta(`${state.totalReviews} checks`, `${state.totalProduction ?? 0} spoken`, `state v${state.version}`);
  setActions(
    { label: "Another →", onClick: () => show("progress-menu", { index: cycleIndex(index, choices.length) }) },
    { label: choice.id === "back" ? "Back" : "Choose", onClick: () => chooseProgressAction(choice.id) }
  );
}

function chooseProgressAction(id) {
  if (id === "back") return show("tools", { index: 0 });
  if (id === "download") return prepareProgressExport();
  if (id === "restore") return dom.progressImport.click();
  if (id === "reset") {
    return show("confirm", {
      kicker: "RESET PROGRESS",
      title: "Delete local practice state?",
      copy: "This cannot be undone unless you downloaded a backup.",
      no: () => show("progress-menu", { index: 0 }),
      yes: resetProgress
    });
  }
}

function backupFilename(now = Date.now()) {
  return `kaiwa-progress-${new Date(now).toISOString().slice(0, 10)}.json`;
}

function backupFile(raw, now = Date.now()) {
  if (typeof File !== "function") return null;
  return new File([raw], backupFilename(now), { type: "application/json" });
}

function canShareBackup(file) {
  if (!file || typeof navigator.share !== "function") return false;
  if (typeof navigator.canShare !== "function") return true;
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

function prepareProgressExport() {
  const now = Date.now();
  const raw = createProgressBackup(state, now);
  const file = backupFile(raw, now);
  passport = {
    raw,
    file,
    preview: { exportedAt: now, sourceVersion: state.version, state },
    shareSupported: canShareBackup(file)
  };
  show("passport-export");
}

function renderPassportExport() {
  const action = passport.shareSupported ? "Share backup" : "Download backup";
  screenHeading("PROGRESS PASSPORT", "Ready to take with you.", "This JSON file contains only Kaiwa practice state. No account, API key, or private trip content is added.");
  setChrome({ title: "Review before export.", context: `state v${passport.preview?.sourceVersion ?? state.version} · ${(passport.raw?.length ?? 0).toLocaleString()} bytes`, progress: 0.72 });
  appendProgressSummary(passport.preview?.state ?? state);
  setActions(
    { label: "Back", onClick: () => show("progress-menu", { index: 0 }) },
    { label: action, onClick: shareOrDownloadProgress }
  );
}

function downloadProgress(raw = passport.raw) {
  const blob = new Blob([raw], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = passport.file?.name ?? backupFilename();
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("Progress backup downloaded");
  show("home");
}

async function shareOrDownloadProgress() {
  if (!passport.shareSupported) return downloadProgress();
  try {
    await navigator.share({
      files: [passport.file],
      title: "Kaiwa progress passport"
    });
    showToast("Progress passport shared");
    show("home");
  } catch (error) {
    if (error?.name === "AbortError") return;
    passport.shareSupported = false;
    downloadProgress();
    showToast("Sharing unavailable; backup downloaded");
  }
}

async function restoreProgressFile(file) {
  if (!file) return;
  try {
    const raw = await file.text();
    const preview = previewProgressBackup(raw, tree);
    passport = { raw, preview, file, shareSupported: false };
    show("passport-import");
  } catch (error) {
    show("progress-error", { message: error.message });
  } finally {
    dom.progressImport.value = "";
  }
}

function renderPassportImport() {
  const preview = passport.preview;
  if (!preview) return show("progress-menu", { index: 0 });
  screenHeading("RESTORE PREVIEW", "Replace this device’s progress?", "Nothing has changed yet. Restore writes the migrated preview below; Cancel keeps the current browser state exactly as it is.");
  setChrome({ title: "Inspect before restore.", context: `backup v${preview.sourceVersion} · exported ${formatLocalTime(preview.exportedAt)}`, progress: 0.82 });
  appendProgressSummary(preview.state);
  setActions(
    { label: "Cancel", onClick: () => show("progress-menu", { index: 1 }) },
    { label: "Restore", onClick: applyProgressRestore }
  );
}

function applyProgressRestore() {
  state = restoreProgressBackup(passport.raw, tree);
  repairActivityState();
  passport = { raw: null, preview: null, file: null, shareSupported: false };
  showToast("Progress restored");
  show("home");
}

function resetProgress() {
  clearState();
  state = createInitialState(tree);
  save();
  show("home");
}

function renderConfirm() {
  screenHeading(screen.data.kicker ?? "CONFIRM", screen.data.title, screen.data.copy);
  setChrome({ title: "Yes or no?", context: "Confirmation", progress: 0.72 });
  setActions(
    { label: "No", onClick: screen.data.no },
    { label: "Yes", onClick: screen.data.yes }
  );
}

function renderProgressError() {
  screenHeading("RESTORE FAILED", "That backup was not applied.", screen.data.message);
  setChrome({ title: "Progress is unchanged.", context: "Local backup", progress: 0.5 });
  setActions({ label: "Home", onClick: () => show("home") }, { label: "Try another", onClick: () => dom.progressImport.click() });
}

function renderOverlayHome() {
  const installed = overlayStatus.installed;
  screenHeading("PRIVATE LESSON OVERLAY", installed ? "Personal content is installed." : "Public curriculum only.", overlayStatus.error
    ? `The saved overlay could not be loaded: ${overlayStatus.error}`
    : "A private overlay stays in this browser and is separate from progress backups and the deployed public seed.");
  setChrome({ title: "Keep identifying content local.", context: installed ? "Private overlay · installed" : "Private overlay · none", progress: 0.5 });
  setActions(
    { label: installed ? "Remove" : "Back", onClick: installed ? confirmClearPrivateOverlay : () => show("tools", { index: 0 }) },
    { label: installed ? "Replace" : "Import", onClick: () => dom.contentImport.click() }
  );
}

async function previewPrivateOverlayFile(file) {
  if (!file) return;
  try {
    const raw = await file.text();
    const overlay = parsePrivateOverlay(raw);
    const merged = mergeContentOverlay(basePacks, overlay);
    const mergedTree = augmentTreeWithReadings(merged.tree, merged.readings);
    validateSkillGraph(mergedTree);
    validateMissionPack(merged.missionPack, merged.content, mergedTree);
    flattenItems(merged.content, merged.readings);
    validateSpeakingItems(buildSpeakingItems(merged.content), mergedTree);
    overlayDraft = { overlay, fileName: file.name };
    show("overlay-preview");
  } catch (error) {
    show("overlay-error", { message: error.message });
  } finally {
    dom.contentImport.value = "";
  }
}

function renderOverlayError() {
  screenHeading("OVERLAY NOT INSTALLED", "That private content was rejected.", screen.data.message);
  setChrome({ title: "Public curriculum is unchanged.", context: "Private overlay", progress: 0.5 });
  setActions(
    { label: "Back", onClick: () => show("overlay-home") },
    { label: "Try another", onClick: () => dom.contentImport.click() }
  );
}

function renderOverlayPreview() {
  if (!overlayDraft) return show("overlay-home");
  const overlay = overlayDraft.overlay;
  const additions = (overlay.scenarios?.length ?? 0)
    + (overlay.readings?.length ?? 0)
    + (overlay.skills?.length ?? 0)
    + (overlay.missions?.length ?? 0);
  screenHeading("PRIVATE OVERLAY PREVIEW", "Install this local content?", "The public files stay unchanged. Reloading after installation recompiles the local curriculum and preserves matching skill IDs.");
  setChrome({ title: overlayDraft.fileName, context: `${additions} content records · local only`, progress: 0.8 });
  addMeta(
    overlay.placeholders?.nameKatakana ? "personal name override" : null,
    `${overlay.scenarios?.length ?? 0} scenarios`,
    `${overlay.readings?.length ?? 0} readings`,
    `${overlay.missions?.length ?? 0} missions`
  );
  setActions(
    { label: "Cancel", onClick: () => { overlayDraft = null; show("overlay-home"); } },
    { label: "Install", onClick: applyPrivateOverlay }
  );
}

function applyPrivateOverlay() {
  if (!overlayDraft) return show("overlay-home");
  savePrivateOverlay(overlayDraft.overlay);
  location.reload();
}

function confirmClearPrivateOverlay() {
  show("confirm", {
    kicker: "REMOVE PRIVATE OVERLAY",
    title: "Return to the public curriculum?",
    copy: "Progress for removed skill IDs is preserved as orphaned evidence and can return if the overlay is installed again.",
    no: () => show("overlay-home"),
    yes: () => { clearPrivateOverlay(); location.reload(); }
  });
}

function skillLabel(skillId) {
  return tree.nodes.find((node) => node.id === skillId)?.label ?? skillId;
}

function render() {
  stopTicker();
  dom.screen.hidden = false;
  switch (screen.name) {
    case "home": return renderHome();
    case "tools": return renderTools();
    case "scenario-chooser": return renderScenarioChooser();
    case "card": return renderCard();
    case "breakdown-overview": return renderBreakdownOverview();
    case "session-intro": return renderSessionIntro();
    case "session-overview": return renderSessionOverview();
    case "session-summary": return renderSessionSummary();
    case "speaking-card": return renderSpeakingCard();
    case "abort": return renderAbort();
    case "sheet-line": return renderSheetLine();
    case "field-question": return renderFieldQuestion();
    case "field-result": return renderFieldResult();
    case "repair-overview": return renderRepairOverview();
    case "mission-chooser": return renderMissionChooser();
    case "mission-mode": return renderMissionMode();
    case "mission-challenge": return renderMissionChallenge();
    case "mission-turn": return renderMissionTurn();
    case "mission-complete": return renderMissionComplete();
    case "route-home": return renderRouteHome();
    case "route-time": return renderRouteTime();
    case "map-home": return renderMapHome();
    case "map-island": return renderMapIsland();
    case "map-skill": return renderMapSkill();
    case "roleplay-unavailable": return renderRoleplayUnavailable();
    case "roleplay-auth": return renderRoleplayAuth();
    case "roleplay-line": return renderRoleplayLine();
    case "roleplay-compose": return renderRoleplayCompose();
    case "roleplay-wait": return renderRoleplayWait();
    case "roleplay-result": return renderRoleplayResult();
    case "roleplay-error": return renderRoleplayError();
    case "share": return renderShare();
    case "progress-menu": return renderProgressMenu();
    case "passport-export": return renderPassportExport();
    case "passport-import": return renderPassportImport();
    case "progress-error": return renderProgressError();
    case "overlay-home": return renderOverlayHome();
    case "overlay-preview": return renderOverlayPreview();
    case "overlay-error": return renderOverlayError();
    case "confirm": return renderConfirm();
    default: return show("home");
  }
}

async function setupRoleplay() {
  try {
    const config = await getRoleplayConfig();
    roleplay.available = Boolean(config.available);
    roleplay.model = config.model ?? null;
    roleplay.reason = config.reason ?? "Roleplay is not configured.";
  } catch {
    roleplay.available = false;
    roleplay.reason = "Run the local Node server with provider variables to enable optional roleplay.";
  }
}

function updateNetworkBadge() {
  const online = navigator.onLine;
  dom.badge.textContent = online ? "Offline-ready" : "Offline";
  dom.badge.classList.toggle("online", online);
}

function refreshDeviceSpeech() {
  const next = speechCapability();
  const changed = next.status !== deviceSpeech.status || next.voice?.name !== deviceSpeech.voice?.name;
  deviceSpeech = next;
  if (changed && state && new Set(["home", "card", "mission-turn", "session-intro"]).has(screen.name)) render();
}

function watchDeviceVoices() {
  const synthesis = globalThis.speechSynthesis;
  if (!synthesis) return;
  if (typeof synthesis.addEventListener === "function") synthesis.addEventListener("voiceschanged", refreshDeviceSpeech);
  else synthesis.onvoiceschanged = refreshDeviceSpeech;
  refreshDeviceSpeech();
}

async function start() {
  try {
    const [baseContent, baseTree, baseReadings, baseMissionPack] = await Promise.all([
      fetch("./data/scenarios.json").then((response) => response.json()),
      fetch("./data/tree.json").then((response) => response.json()),
      fetch("./data/readings.json").then((response) => response.json()),
      fetch("./data/missions.json").then((response) => response.json())
    ]);
    basePacks = { content: baseContent, tree: baseTree, readings: baseReadings, missionPack: baseMissionPack };
    let privateOverlay = null;
    try {
      privateOverlay = loadPrivateOverlay();
      overlayStatus = { installed: Boolean(privateOverlay), error: null };
    } catch (error) {
      console.warn("Kaiwa ignored an invalid private overlay.", error);
      overlayStatus = { installed: false, error: error.message };
    }
    ({ content, tree, readings, missionPack } = mergeContentOverlay(basePacks, privateOverlay));
    tree = augmentTreeWithReadings(tree, readings);
    validateSkillGraph(tree);
    validateMissionPack(missionPack, content, tree);
    missionLines = missionLineIndex(content);
    items = flattenItems(content, readings);
    speakingItems = buildSpeakingItems(content);
    validateSpeakingItems(speakingItems, tree);
    state = loadState(tree);
    repairActivityState();

    const name = content.placeholders.nameKatakana;
    dom.placeholder.textContent = `${name.value} is an unconfirmed placeholder. Replace it with the exact reservation name.`;
    dom.placeholder.hidden = name.confirmed;
    dom.progressImport.addEventListener("change", () => restoreProgressFile(dom.progressImport.files?.[0]));
    dom.contentImport.addEventListener("change", () => previewPrivateOverlayFile(dom.contentImport.files?.[0]));
    window.addEventListener("online", updateNetworkBadge);
    window.addEventListener("offline", updateNetworkBadge);
    updateNetworkBadge();
    watchDeviceVoices();
    dom.loading.hidden = true;
    render();
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
