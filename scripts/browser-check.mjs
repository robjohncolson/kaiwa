// Dependency-free mobile regression gate driven through Chrome DevTools Protocol.
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STORAGE_KEY = "kaiwa.practice-state.v1";
const MIME = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};
const ROOT_FILES = new Set(["icon.svg", "index.html", "manifest.webmanifest", "qr-kaiwa.svg", "service-worker.js", "styles.css"]);

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function check(value, message) {
  if (!value) throw new Error(message);
  process.stdout.write(`✓ ${message}\n`);
}

async function findChrome() {
  const candidates = [
    process.env.KAIWA_BROWSER,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }
  throw new Error("Chrome/Chromium is required. Set KAIWA_BROWSER to its executable path.");
}

function relativeAsset(pathname) {
  const decoded = decodeURIComponent(pathname);
  const relative = decoded.startsWith("/kaiwa/")
    ? decoded.slice("/kaiwa/".length)
    : decoded.replace(/^\/+/, "");
  const asset = relative === "" ? "index.html" : relative;
  if (!ROOT_FILES.has(asset) && !asset.startsWith("src/") && !asset.startsWith("data/")) return null;
  const resolved = path.resolve(ROOT, asset);
  return resolved.startsWith(`${ROOT}${path.sep}`) ? resolved : null;
}

async function startServer() {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://kaiwa.test");
    if (url.pathname === "/api/config" || url.pathname === "/kaiwa/api/config") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(JSON.stringify({ available: false, reason: "Browser regression runs offline." }));
      return;
    }
    let filePath;
    try {
      filePath = relativeAsset(url.pathname);
    } catch {
      filePath = null;
    }
    if (!filePath) {
      response.writeHead(404).end("Not found");
      return;
    }
    try {
      const body = await readFile(filePath);
      response.writeHead(200, {
        "content-type": MIME[path.extname(filePath)] ?? "application/octet-stream",
        "cache-control": path.basename(filePath) === "service-worker.js" ? "no-cache" : "no-store",
        "content-length": body.length
      });
      response.end(body);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server;
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.id = 0;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
      else resolve(message.result);
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out: ${method}`));
      }, 10_000);
      this.pending.set(id, {
        resolve: (result) => { clearTimeout(timer); resolve(result); },
        reject: (error) => { clearTimeout(timer); reject(error); }
      });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
}

async function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error("Timed out connecting to Chrome.")), 10_000);
    socket.addEventListener("open", () => { clearTimeout(timer); resolve(socket); }, { once: true });
    socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Chrome DevTools WebSocket failed.")); }, { once: true });
  });
}

async function reservePort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForDebuggerUrl(port, browser, stderrLines) {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    if (browser.exitCode != null) {
      throw new Error(`Chrome exited with ${browser.exitCode}: ${stderrLines.join("").trim() || "no diagnostics"}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        const details = await response.json();
        if (details.webSocketDebuggerUrl) return details.webSocketDebuggerUrl;
      }
    } catch {}
    await sleep(25);
  }
  throw new Error(`Chrome did not expose its debugging endpoint within 15 seconds: ${stderrLines.join("").trim() || "no diagnostics"}`);
}

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}

async function eventually(callback, message, attempts = 160) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const value = await callback();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(50);
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message}` : ""}`);
}

async function run() {
  const chrome = await findChrome();
  const server = await startServer();
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "kaiwa-browser-"));
  const debugPort = await reservePort();
  const browser = spawn(chrome, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${debugPort}`,
    "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] });
  const stderrLines = [];
  browser.stderr.on("data", (chunk) => {
    stderrLines.push(String(chunk));
    if (stderrLines.length > 40) stderrLines.shift();
  });
  let socket;
  try {
    socket = await connect(await waitForDebuggerUrl(debugPort, browser, stderrLines));
    const cdp = new Cdp(socket);
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("Network.enable", {}, sessionId);
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `
      window.__kaiwaErrors = [];
      addEventListener("error", event => window.__kaiwaErrors.push(event.message));
      addEventListener("unhandledrejection", event => window.__kaiwaErrors.push(String(event.reason)));
    ` }, sessionId);

    const js = (expression) => evaluate(cdp, sessionId, expression);
    const title = () => js(`document.querySelector(".screen-title")?.textContent || ""`);
    const actions = () => js(`[...document.querySelectorAll("button")].filter(button => !button.hidden && getComputedStyle(button).display !== "none").map(button => ({ label: button.textContent.trim(), disabled: button.disabled, height: button.getBoundingClientRect().height }))`);
    const actionLabel = async (label) => (await actions()).some((button) => button.label === label);
    const click = async (label) => {
      const clicked = await js(`(() => { const button = [...document.querySelectorAll("button")].find(candidate => !candidate.hidden && candidate.textContent.trim() === ${JSON.stringify(label)}); if (!button || button.disabled) return false; button.click(); return true; })()`);
      if (!clicked) throw new Error(`Could not click action: ${label}`);
      await sleep(30);
    };
    const layout = async (label) => {
      const result = await js(`(() => { const visible = [...document.querySelectorAll("button")].filter(button => !button.hidden && getComputedStyle(button).display !== "none"); return { count: visible.length, minHeight: Math.min(...visible.map(button => button.getBoundingClientRect().height)), scrollWidth: document.documentElement.scrollWidth, viewport: innerWidth, errors: window.__kaiwaErrors }; })()`);
      check(result.count <= 2, `${label}: at most two visible buttons`);
      check(result.minHeight >= 44, `${label}: every action is at least 44px high`);
      check(result.scrollWidth <= result.viewport, `${label}: no horizontal overflow`);
      check(result.errors.length === 0, `${label}: no browser errors`);
    };
    const load = async (url, width, height) => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: true }, sessionId);
      await cdp.send("Page.navigate", { url }, sessionId);
      await eventually(async () => js(`document.readyState === "complete" && document.querySelector("#loading")?.hidden && !document.querySelector("#wizard-screen")?.hidden`), `App did not load at ${url}`);
      await layout(`${width}x${height} ${new URL(url).pathname}`);
    };
    const navigateTool = async (toolTitle) => {
      if (!(await actionLabel("Menu"))) throw new Error("Tool navigation must start at home.");
      await click("Menu");
      for (let attempt = 0; attempt < 20 && await title() !== toolTitle; attempt += 1) await click("Not this →");
      check(await title() === toolTitle, `tool wizard reaches ${toolTitle}`);
      await click("Open");
    };
    const candidateIsCorrect = () => js(`(async () => {
      if (!window.__kaiwaItemIndex) {
        window.__kaiwaItemIndex = Promise.all([
          fetch("./data/scenarios.json").then(response => response.json()),
          fetch("./data/readings.json").then(response => response.json()),
          import("./src/scheduler.js")
        ]).then(([content, readings, scheduler]) => scheduler.flattenItems(content, readings));
      }
      const itemId = document.querySelector("#wizard-screen")?.dataset.itemId;
      const optionId = document.querySelector(".candidate-card")?.dataset.optionId;
      const saved = JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)}) || "null");
      const dynamic = saved?.repair?.active?.recognitionCard;
      const item = dynamic?.id === itemId ? dynamic : (await window.__kaiwaItemIndex).find(candidate => candidate.id === itemId);
      return item?.options?.find(option => option.id === optionId)?.correct ?? null;
    })()`);
    const answerCard = async (correct) => {
      for (let candidate = 0; candidate < 4; candidate += 1) {
        const candidateCorrect = await candidateIsCorrect();
        if (candidateCorrect == null) throw new Error("Could not resolve the active card candidate.");
        if (candidateCorrect === correct) {
          await click("Yes");
          return;
        }
        await click("No");
      }
      throw new Error(`Could not select a ${correct ? "correct" : "wrong"} card candidate.`);
    };
    const finishCard = async () => {
      check(Boolean(await js(`document.querySelector(".practice-reason")?.textContent.includes("WHY THIS CARD")`)), "practice card explains why it was selected");
      await answerCard(true);
      check(Boolean(await js(`document.querySelector(".practice-reason")`)), "selection reason remains visible with feedback");
      const next = (await actions()).find((button) => !button.disabled && ["Next card", "Speak next"].includes(button.label));
      if (!next) throw new Error("Card feedback has no forward action.");
      await click(next.label);
    };
    const finishProductionMission = async () => {
      for (let turn = 0; turn < 12; turn += 1) {
        if (await actionLabel("I spoke")) await click("I spoke");
        if (await actionLabel("Yes")) await click("Yes");
        if (await actionLabel("Continue")) await click("Continue");
        else if (await actionLabel("Finish")) { await click("Finish"); return; }
        else if (!(await actionLabel("I spoke"))) return;
      }
      throw new Error("Production mission did not terminate.");
    };
    const dispatchBackup = (reviewCount) => js(`(async () => {
      const saved = localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
      const state = saved
        ? JSON.parse(saved)
        : (await import("./src/store.js")).createInitialState(await fetch("./data/tree.json").then(response => response.json()));
      state.totalReviews = ${reviewCount};
      const raw = JSON.stringify({ format: "kaiwa-progress", version: 1, exportedAt: Date.now() - 1000, state });
      const transfer = new DataTransfer();
      transfer.items.add(new File([raw], "kaiwa-progress-test.json", { type: "application/json" }));
      const input = document.querySelector("#progress-import");
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return raw.length;
    })()`);

    await load(`${origin}/`, 390, 844);

    // Progress passport: native share, safe import preview, then explicit restore.
    await js(`Object.defineProperty(navigator, "share", { configurable: true, value: async value => { window.__sharedBackup = value.files[0].name; } }); Object.defineProperty(navigator, "canShare", { configurable: true, value: value => Boolean(value.files?.length) }); true`);
    await navigateTool("Progress and backup");
    await click("Choose");
    check(await title() === "Ready to take with you.", "export opens a progress passport preview");
    check(await actionLabel("Share backup"), "capable phones receive a native Share action");
    await click("Share backup");
    check(String(await js(`window.__sharedBackup || ""`)).endsWith(".json"), "native sharing receives the JSON backup file");

    await js(`delete navigator.share; delete navigator.canShare; true`);
    await navigateTool("Progress and backup");
    await click("Choose");
    check(await actionLabel("Download backup"), "browsers without native sharing receive a JSON download action");
    await cdp.send("Page.reload", {}, sessionId);
    await eventually(async () => actionLabel("Menu"), "Home did not return after the export fallback check");

    await navigateTool("Progress and backup");
    await click("Another →");
    await click("Choose");
    const beforePreview = await js(`localStorage.getItem(${JSON.stringify(STORAGE_KEY)})`);
    await dispatchBackup(321);
    await eventually(async () => (await title()) === "Replace this device’s progress?", "Import preview did not appear");
    check(await js(`localStorage.getItem(${JSON.stringify(STORAGE_KEY)})`) === beforePreview, "selecting a backup does not mutate local progress");
    check(await actionLabel("Cancel") && await actionLabel("Restore"), "import preview exposes only Cancel and Restore");
    await click("Restore");
    check(await js(`JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})).totalReviews`) === 321, "Restore applies the previewed state only after confirmation");

    // Composite place-reading cards must not inherit adaptive prompt furigana.
    await js(`(() => { const state = JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})); state.focus = { scenarioId: "miyazaki-readings", skillId: "geo.miyazaki_address", mode: null }; localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, JSON.stringify(state)); })()`);
    await cdp.send("Page.reload", {}, sessionId);
    await eventually(async () => actionLabel("Menu"), "Home did not return for the place-reading check");
    await navigateTool("One quick card");
    check(await js(`["児湯郡", "新富町", "三納代"].every(term => [...document.querySelectorAll(".prompt-japanese ruby > span")].some(node => node.textContent === term))`), "focused check opens the Miyazaki address-reading card");
    check(await js(`[...document.querySelectorAll(".prompt-japanese rt")].every(rt => rt.getAttribute("aria-hidden") === "true" && getComputedStyle(rt).visibility === "hidden")`), "Miyazaki address prompt does not reveal its readings");
    await answerCard(true);
    check(await js(`[...document.querySelectorAll(".result-card .line-japanese rt")].every(rt => rt.getAttribute("aria-hidden") === "true" && getComputedStyle(rt).visibility === "hidden")`), "place-reading correction does not duplicate ruby above the answer");
    check((await js(`document.querySelector(".result-card .answer-reading")?.textContent || ""`)).trim() === "こゆぐん しんとみちょう みなしろ", "place-reading correction shows one explicit reading line");
    await click("Home");

    // Every corpus word must expose independent sound, form, meaning, and recall evidence.
    await js(`(() => { const state = JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})); state.focus = { scenarioId: null, skillId: "word-form.minashiro", mode: null }; localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, JSON.stringify(state)); })()`);
    await cdp.send("Page.reload", {}, sessionId);
    await eventually(async () => actionLabel("Menu"), "Home did not return for the written-form facet");
    await navigateTool("One quick card");
    check(await js(`document.querySelector("#wizard-screen")?.dataset.itemId`) === "word-form-card.minashiro", "exact form focus opens the 三納代 written-form card");
    check(await title() === "Rebuild the complete word.", "written-form facet states its task");
    check(Boolean(await js(`document.querySelector(".screen-meta")?.textContent.includes("Reading → written form")`)), "written-form facet labels its direction");
    check(await js(`[...document.querySelectorAll(".candidate-card rt")].every(rt => rt.getAttribute("aria-hidden") === "true" && getComputedStyle(rt).visibility === "hidden")`), "written-form candidates do not leak furigana");
    await answerCard(true);
    await click("Home");

    await js(`(() => { const state = JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})); state.focus = { scenarioId: null, skillId: "word-meaning.minashiro", mode: null }; localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, JSON.stringify(state)); })()`);
    await cdp.send("Page.reload", {}, sessionId);
    await eventually(async () => actionLabel("Menu"), "Home did not return for the meaning facet");
    await navigateTool("One quick card");
    check(await title() === "Choose what the word means.", "meaning facet states its task");
    check(Boolean(await js(`document.querySelector(".screen-meta")?.textContent.includes("Japanese → meaning")`)), "meaning facet labels its direction");
    await answerCard(true);
    await click("Home");

    await js(`(() => { const state = JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})); state.focus = { scenarioId: null, skillId: "word-recall.minashiro", mode: null }; localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, JSON.stringify(state)); })()`);
    await cdp.send("Page.reload", {}, sessionId);
    await eventually(async () => actionLabel("Menu"), "Home did not return for the recall facet");
    await navigateTool("One quick card");
    check(await title() === "Recall the Japanese word.", "meaning-to-Japanese facet states its task");
    check(Boolean(await js(`document.querySelector(".screen-meta")?.textContent.includes("Meaning → Japanese")`)), "recall facet labels its direction");
    check(await js(`[...document.querySelectorAll(".candidate-card rt")].every(rt => rt.getAttribute("aria-hidden") === "true" && getComputedStyle(rt).visibility === "hidden")`), "recall candidates do not leak furigana");
    await answerCard(false);
    await click("Break it down");
    check(await js(`(() => { const active = JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})).breakdown.active; return ["reading.minashiro", "word-form.minashiro", "word-meaning.minashiro"].every(id => active.componentSkillIds.includes(id)); })()`), "a recall miss opens independent sound, form, and meaning nodes");
    await js(`(() => { const state = JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})); state.breakdown.active = null; state.focus = { scenarioId: null, skillId: "reading.minashiro", mode: null }; localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, JSON.stringify(state)); })()`);
    await cdp.send("Page.reload", {}, sessionId);
    await eventually(async () => actionLabel("Menu"), "Home did not return after the word-facet checks");

    // A missed multi-kanji word must teach each written character beneath the whole reading.
    await navigateTool("One quick card");
    check(await js(`document.querySelector("#wizard-screen")?.dataset.itemId`) === "reading-card.minashiro", "exact reading focus opens 三納代");
    await answerCard(false);
    await click("Break it down");
    check(await js(`JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})).breakdown.active.componentIds.length`) === 3, "三納代 decomposes into 三, 納, and 代 cards");
    await click("Start parts");
    check(await title() === "Rebuild the written word.", "kanji remediation names the written-word task");
    check(Boolean(await js(`document.querySelector(".screen-meta")?.textContent.includes("Reading → written form")`)), "kanji remediation labels its direction");
    check(Boolean(await js(`document.querySelector(".prompt-japanese")?.textContent.includes("□")`)), "kanji remediation masks exactly one written component");
    await js(`(() => { const state = JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})); state.breakdown.active = null; state.focus = { scenarioId: "miyazaki-readings", skillId: "geo.miyazaki_address", mode: null }; localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, JSON.stringify(state)); })()`);
    await cdp.send("Page.reload", {}, sessionId);
    await eventually(async () => actionLabel("Menu"), "Home did not return after the kanji-component check");

    // A normal card miss opens a persisted recursive component -> integration cycle.
    await navigateTool("One quick card");
    await answerCard(false);
    check(Boolean(await js(`document.querySelector(".result-card")?.textContent.includes("WHAT THAT ANSWER SUGGESTS")`)), "a diagnosed distractor explains which nodes it implicates");
    check(await actionLabel("Break it down"), "a wrong whole-card answer offers decomposition");
    await click("Break it down");
    check(await title() === "Learn the parts.", "the breakdown explains its component phase");
    await layout("390x844 breakdown overview");
    check(await js(`JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})).breakdown.active.componentIds.length`) === 5, "the Miyazaki phrase activates five contextual reading nodes");
    await click("Start parts");
    let reachedNestedWord = false;
    for (let part = 0; part < 5; part += 1) {
      if (await js(`document.querySelector("#wizard-screen")?.dataset.itemId`) === "reading-card.minashiro") {
        reachedNestedWord = true;
        break;
      }
      await answerCard(true);
      await click("Next part");
    }
    check(reachedNestedWord, "the phrase breakdown reaches its 三納代 word node");
    const queueLengthBeforeExpansion = await js(`JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})).breakdown.active.queue.length`);
    await answerCard(false);
    check(await actionLabel("Next part"), "a missed word remains inside the breakdown");
    await click("Next part");
    const recursiveState = await js(`(() => { const active = JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})).breakdown.active; return { queueLength: active.queue.length, event: active.expansionEvents.at(-1), currentId: active.queue[active.queueIndex] }; })()`);
    check(recursiveState.queueLength === queueLengthBeforeExpansion + 4, "a missed three-kanji word inserts three character checks and a word retry");
    check(recursiveState.event.parentItemId === "reading-card.minashiro" && recursiveState.event.childItemIds.length === 3, "the recursive expansion is persisted with its parent-child edges");
    check(recursiveState.currentId.startsWith("reading-character-card.minashiro."), "the next card teaches an individual kanji");
    check(await title() === "Rebuild the written word.", "nested remediation reaches the written-kanji task immediately");
    check(Boolean(await js(`document.querySelector(".practice-reason-text")?.textContent.includes("三納代 · みなしろ →")`)), "the nested card explains its phrase-to-word-to-kanji path");
    await cdp.send("Page.reload", {}, sessionId);
    await eventually(async () => actionLabel("Resume breakdown"), "Active card breakdown did not survive refresh");
    await click("Resume breakdown");
    check(await title() === "Learn the parts.", "refresh returns to the active component phase");
    await click("Continue parts");
    for (let part = 0; part < 20; part += 1) {
      await answerCard(true);
      if (await actionLabel("Next part")) {
        await click("Next part");
        continue;
      }
      if (await actionLabel("Retry whole card")) {
        await click("Retry whole card");
        break;
      }
      throw new Error("Breakdown component feedback has no forward action.");
    }
    check(await title() === "Put it back together.", "clean components lead to the integration phase");
    await click("Retry whole card");
    await answerCard(true);
    check(await actionLabel("Schedule revisit"), "a clean immediate retry schedules delayed reconsolidation");
    await click("Schedule revisit");
    check(await title() === "Let it settle.", "the breakdown enters a real ten-minute gap");
    check(await actionLabel("Not ready"), "the delayed whole-card check cannot run immediately");
    await cdp.send("Page.reload", {}, sessionId);
    await eventually(async () => actionLabel("Resume breakdown"), "Waiting breakdown did not survive refresh");
    await click("Resume breakdown");
    check(await actionLabel("Not ready"), "refresh preserves the not-yet-due breakdown revisit");
    await js(`(() => { const state = JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})); state.breakdown.active.revisitAt = Date.now() - 1; localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, JSON.stringify(state)); })()`);
    await cdp.send("Page.reload", {}, sessionId);
    await eventually(async () => actionLabel("Resume breakdown"), "Due breakdown did not load");
    await click("Resume breakdown");
    await click("Start delayed check");
    await answerCard(true);
    check(await actionLabel("Finish breakdown"), "a clean delayed parent recall closes the evidence loop");
    await click("Finish breakdown");
    check(await title() === "Connection held.", "breakdown reaches a delayed-recall summary");
    await layout("390x844 breakdown complete");
    const breakdownEvidence = await js(`(() => { const state = JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})); return { parent: state.skills["geo.miyazaki_address"], components: state.breakdown.active.componentSkillIds.map(id => state.skills[id]) }; })()`);
    check(breakdownEvidence.parent.incorrect >= 1 && breakdownEvidence.parent.correct >= 2, "parent BKT records the miss and its own clean retry");
    check(breakdownEvidence.components.every(skill => skill.correct >= 1), "each selected component records independent clean evidence");
    await click("Continue");
    check(await js(`JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})).breakdown.recent.length`) >= 1, "completed breakdown is archived locally");
    await js(`(() => { const state = JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})); state.focus = { scenarioId: null, skillId: null, mode: null }; localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, JSON.stringify(state)); })()`);
    await cdp.send("Page.reload", {}, sessionId);
    await eventually(async () => actionLabel("Start practice"), "Home did not return after the place-reading check");

    // The skill path groups each word's four independent Bayesian facets.
    await navigateTool("Skill path");
    for (let scenario = 0; scenario < 30 && await title() !== "Miyazaki place readings"; scenario += 1) await click("Another →");
    check(await title() === "Miyazaki place readings", "skill path reaches the Miyazaki word corpus");
    check(Boolean(await js(`document.querySelector(".screen-meta")?.textContent.includes("word facets")`)), "scenario progress reports word-facet readiness");
    await click("Open path");
    for (let skill = 0; skill < 30 && await js(`document.querySelector(".screen-kicker")?.textContent`) !== "WORD FACETS"; skill += 1) await click("Next skill →");
    check(await js(`document.querySelector(".screen-kicker")?.textContent`) === "WORD FACETS", "skill path groups a word instead of flattening four opaque nodes");
    check(await js(`document.querySelectorAll(".stage-list li").length`) === 4, "word detail shows sound, form, meaning, and recall rows");
    check(Boolean(await js(`document.querySelector(".stage-list")?.textContent.includes("Meaning → Japanese")`)), "word detail exposes the direction of every facet");
    check(await actionLabel("Practice weakest"), "word detail targets its weakest facet directly");
    await layout("390x844 word facets");
    await js(`(() => { const state = JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})); state.focus = { scenarioId: null, skillId: null, mode: null }; localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, JSON.stringify(state)); })()`);
    await cdp.send("Page.reload", {}, sessionId);
    await eventually(async () => actionLabel("Start practice"), "Home did not return after the word-facet map check");

    // Full guided loop at a common modern phone size.
    await click("Start practice");
    await click("Start");
    for (let card = 0; card < 6; card += 1) {
      if (card === 3) {
        check(await title() === "Match the word to its reading.", "reading card explains the task");
        check(Boolean(await js(`document.querySelector(".screen-meta")?.textContent.includes("Written form → hiragana")`)), "reading card names the written-form to hiragana mapping");
        check(Boolean(await js(`document.querySelector(".candidate-card .candidate-label")?.textContent.includes("Possible reading")`)), "hiragana option is labeled as a possible reading");
        check(await js(`[...document.querySelectorAll(".prompt-japanese rt")].every(rt => rt.getAttribute("aria-hidden") === "true" && getComputedStyle(rt).visibility === "hidden")`), "reading prompt does not reveal its furigana");
      }
      await finishCard();
    }
    check(await title() === "Cards complete. Speak now.", "guided cards advance into the spoken loop");
    await click("Start mission");
    await finishProductionMission();
    check(await title() === "The loop is closed.", "guided session reaches a complete summary");
    await layout("390x844 guided summary");
    await click("Home");

    // Failed field result -> repair -> persisted wait -> due revisit -> completion.
    await navigateTool("Log a real conversation");
    await click("Another →");
    check(await title() === "Music-store pickup", "field wizard selects a repairable closed-loop scenario");
    await click("Choose");
    await click("No");
    await click("No");
    await click("No");
    check(await title() === "Failed", "field wizard records a failed real conversation");
    await click("Repair now");
    await finishCard();
    await finishCard();
    check(await actionLabel("Start speaking"), "repair cards advance into speaking");
    await click("Start speaking");
    await finishProductionMission();
    check(await actionLabel("Not ready"), "repair enters its ten-minute waiting stage");
    await cdp.send("Page.reload", {}, sessionId);
    await eventually(async () => actionLabel("Resume repair"), "Waiting repair did not survive refresh");
    await click("Resume repair");
    check(await actionLabel("Not ready"), "refresh preserves the not-yet-due revisit");
    await js(`(() => { const state = JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})); state.repair.active.revisitAt = Date.now() - 1; localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, JSON.stringify(state)); })()`);
    await cdp.send("Page.reload", {}, sessionId);
    await eventually(async () => actionLabel("Resume repair"), "Due repair did not load");
    await click("Resume repair");
    await click("Start revisit");
    await finishProductionMission();
    check(await actionLabel("Archive"), "no-furigana revisit completes the repair loop");
    await layout("390x844 repair complete");
    await click("Archive");

    // True network-off reload at the root deployment shape.
    await js(`navigator.serviceWorker.ready.then(() => true)`);
    if (!(await js(`Boolean(navigator.serviceWorker.controller)`))) {
      await cdp.send("Page.reload", {}, sessionId);
      await eventually(async () => js(`Boolean(navigator.serviceWorker.controller)`), "Root service worker did not take control");
    }
    await cdp.send("Network.emulateNetworkConditions", {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
      connectionType: "none"
    }, sessionId);
    await cdp.send("Page.reload", {}, sessionId);
    await eventually(async () => js(`document.readyState === "complete" && document.querySelector("#loading")?.hidden && !document.querySelector("#wizard-screen")?.hidden`), "Offline root reload did not complete");
    check((await title()).length > 0, "service worker reloads the root app with the network truly offline");
    await layout("390x844 root offline reload");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
      connectionType: "wifi"
    }, sessionId);

    // Narrow-screen nested deployment and true network-off service-worker reload.
    await load(`${origin}/kaiwa/`, 320, 568);
    await click("Start practice");
    await click("Start");
    check(Boolean(await js(`document.querySelector(".practice-reason")`)), "320px nested route renders scheduler rationale");
    await layout("320x568 nested practice card");
    await js(`navigator.serviceWorker.ready.then(() => true)`);
    if (!(await js(`Boolean(navigator.serviceWorker.controller)`))) {
      await cdp.send("Page.reload", {}, sessionId);
      await eventually(async () => js(`Boolean(navigator.serviceWorker.controller)`), "Nested service worker did not take control");
    }
    await cdp.send("Network.emulateNetworkConditions", {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
      connectionType: "none"
    }, sessionId);
    await cdp.send("Page.reload", {}, sessionId);
    await eventually(async () => js(`document.readyState === "complete" && document.querySelector("#loading")?.hidden && !document.querySelector("#wizard-screen")?.hidden`), "Offline nested reload did not complete");
    check((await title()).length > 0, "service worker reloads the nested app with the network truly offline");
    await layout("320x568 nested offline reload");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
      connectionType: "wifi"
    }, sessionId);

    process.stdout.write("\nKaiwa browser regression passed.\n");
  } finally {
    if (socket?.readyState === WebSocket.OPEN) socket.close();
    if (browser.exitCode == null) {
      browser.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => browser.once("exit", resolve)),
        sleep(1500)
      ]);
    }
    await new Promise((resolve) => server.close(resolve));
    try {
      await rm(userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch (error) {
      console.warn(`Browser profile cleanup warning: ${error.message}`);
    }
  }
}

run().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exitCode = 1;
});
