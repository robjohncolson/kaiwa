import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const productionUrl = "https://kaiwa-nine.vercel.app/";

test("share card and QR asset point to the Vercel production URL", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  const ui = await readFile(new URL("src/ui.js", root), "utf8");
  const svg = await readFile(new URL("qr-kaiwa.svg", root), "utf8");
  const pagesWorkflow = await readFile(new URL(".github/workflows/pages.yml", root), "utf8");

  assert.match(html, /id="wizard-screen"/);
  assert.match(ui, /image\.id = "kaiwa-share-qr"/);
  assert.match(ui, /image\.src = "\.\/qr-kaiwa\.svg"/);
  assert.ok(ui.includes(`const PRODUCTION_URL = "${productionUrl}"`));
  assert.ok(svg.includes(`aria-label="QR code linking to ${productionUrl}"`));
  assert.match(svg, /viewBox="0 0 37 37"/);
  assert.match(svg, /<rect fill="white"/);
  assert.match(svg, /<path d="M/);
  assert.match(pagesWorkflow, /cp [^\n]*qr-kaiwa\.svg[^\n]* _site\//);
});
