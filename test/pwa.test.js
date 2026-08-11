import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("manifest assets exist and the offline shell covers browser dependencies", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.webmanifest", root), "utf8"));
  const worker = await readFile(new URL("service-worker.js", root), "utf8");
  const shell = [
    "index.html",
    "styles.css",
    "manifest.webmanifest",
    "icon.svg",
    "qr-kaiwa.svg",
    "data/scenarios.json",
    "data/missions.json",
    "data/tree.json",
    "data/readings.json",
    "src/mastery.js",
    "src/field.js",
    "src/map.js",
    "src/mission.js",
    "src/providers/llm.js",
    "src/production.js",
    "src/repair.js",
    "src/readings.js",
    "src/scheduler.js",
    "src/session.js",
    "src/store.js",
    "src/ui.js",
    "src/wizard.js"
  ];

  assert.equal(manifest.display, "standalone");
  for (const path of shell) {
    await access(new URL(path, root));
    assert.ok(worker.includes(`"./${path}"`), `Offline shell is missing ${path}`);
  }
  assert.match(worker, /pathname\.startsWith\(API_PATH\)/);
});
