import test from "node:test";
import assert from "node:assert/strict";

import { createKaiwaServer } from "../server.js";

async function withServer(options, callback) {
  const server = createKaiwaServer(options);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("local server keeps the offline app available without provider settings", async () => {
  await withServer({ env: {} }, async (baseUrl) => {
    const [page, config, privateFile] = await Promise.all([
      fetch(`${baseUrl}/`),
      fetch(`${baseUrl}/api/config`),
      fetch(`${baseUrl}/server.js`)
    ]);

    assert.equal(page.status, 200);
    assert.match(await page.text(), /Kaiwa — trip drill/);
    assert.deepEqual(await config.json(), {
      available: false,
      reason: "Provider environment variables are not set."
    });
    assert.equal(privateFile.status, 404);

    const roleplay = await fetch(`${baseUrl}/api/roleplay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenarioId: "essentials", history: [], userText: "test" })
    });
    assert.equal(roleplay.status, 503);
  });
});

test("configuration endpoint never returns the API key", async () => {
  const env = {
    KAIWA_LLM_BASE_URL: "http://127.0.0.1:9999/v1",
    KAIWA_LLM_API_KEY: "never-return-this",
    KAIWA_LLM_MODEL: "mock-model"
  };
  await withServer({ env }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/config`);
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.equal(text.includes("never-return-this"), false);
    assert.deepEqual(JSON.parse(text), { available: true, model: "mock-model" });
  });
});
