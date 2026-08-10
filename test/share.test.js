import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const productionUrl = "https://kaiwa-nine.vercel.app/";

test("share card and QR asset point to the Vercel production URL", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  const svg = await readFile(new URL("qr-kaiwa.svg", root), "utf8");
  const pagesWorkflow = await readFile(new URL(".github/workflows/pages.yml", root), "utf8");

  assert.match(html, /id="kaiwa-share"/);
  assert.match(html, /<img[^>]*id="kaiwa-share-qr"[^>]*src="\.\/qr-kaiwa\.svg"[^>]*>/);
  assert.equal(html.split(`href="${productionUrl}"`).length - 1, 2);
  assert.ok(svg.includes(`aria-label="QR code linking to ${productionUrl}"`));
  assert.match(svg, /viewBox="0 0 37 37"/);
  assert.match(svg, /<rect fill="white"/);
  assert.match(svg, /<path d="M/);
  assert.match(pagesWorkflow, /cp [^\n]*qr-kaiwa\.svg[^\n]* _site\//);
});
