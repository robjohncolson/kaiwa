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
    const [page, qr, config, privateFile] = await Promise.all([
      fetch(`${baseUrl}/`),
      fetch(`${baseUrl}/qr-kaiwa.svg`),
      fetch(`${baseUrl}/api/config`),
      fetch(`${baseUrl}/server.js`)
    ]);

    assert.equal(page.status, 200);
    assert.match(await page.text(), /Kaiwa — trip drill/);
    assert.equal(qr.status, 200);
    assert.match(qr.headers.get("content-type"), /^image\/svg\+xml/);
    assert.match(await qr.text(), /kaiwa-nine\.vercel\.app/);
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
    KAIWA_LLM_MODEL: "mock-model",
    KAIWA_ROLEPLAY_TOKEN: "local-test-token-123456"
  };
  await withServer({ env }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/config`);
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.equal(text.includes("never-return-this"), false);
    assert.equal(text.includes("local-test-token-123456"), false);
    assert.deepEqual(JSON.parse(text), { available: true, model: "mock-model", authRequired: true });
  });
});

test("roleplay requires its bearer token and rate-limits an authenticated client", async () => {
  const env = {
    KAIWA_LLM_BASE_URL: "http://127.0.0.1:9999/v1",
    KAIWA_LLM_API_KEY: "provider-secret",
    KAIWA_LLM_MODEL: "mock-model",
    KAIWA_ROLEPLAY_TOKEN: "local-test-token-123456",
    KAIWA_ROLEPLAY_RATE_LIMIT: "2"
  };
  const providerResult = {
    staffReply: {
      ja: "ありがとうございました。",
      parts: [{ text: "ありがとうございました。", reading: "" }],
      meaning: "Thank you very much."
    },
    observations: [{ skillId: "polite.basics", outcome: "success" }],
    shouldAbort: false,
    hint: ""
  };
  const fetchImpl = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(providerResult) } }]
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  const request = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenarioId: "essentials", history: [], userText: "ありがとうございました。" })
  };

  await withServer({ env, fetchImpl }, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/roleplay`, request)).status, 401);
    const authorized = {
      ...request,
      headers: { ...request.headers, Authorization: `Bearer ${env.KAIWA_ROLEPLAY_TOKEN}` }
    };
    assert.equal((await fetch(`${baseUrl}/api/roleplay`, {
      ...authorized,
      headers: { ...authorized.headers, Origin: "https://attacker.example" }
    })).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/roleplay`, authorized)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/roleplay`, authorized)).status, 200);
    const limited = await fetch(`${baseUrl}/api/roleplay`, authorized);
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) >= 1);
  });
});
