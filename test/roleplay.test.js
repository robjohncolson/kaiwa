import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  readProviderConfig,
  RoleplayConfigError,
  RoleplayProviderError,
  roleplayStatus,
  runRoleplay,
  validateRoleplayInput,
  validateRoleplayResult
} from "../server/roleplay.js";

const content = JSON.parse(
  await readFile(new URL("../data/scenarios.json", import.meta.url), "utf8")
);
const scenario = content.scenarios.find((entry) => entry.id === "shimamura-pickup");
const config = {
  baseUrl: "https://provider.example/v1",
  apiKey: "fake-test-key",
  model: "test-model"
};
const validResult = {
  staffReply: {
    ja: "お名前は？",
    parts: [
      { text: "お名前", reading: "おなまえ" },
      { text: "は？", reading: "" }
    ],
    meaning: "Your name?"
  },
  observations: [{ skillId: "shimamura.pickup", outcome: "success" }],
  shouldAbort: false,
  hint: ""
};

function completion(result = validResult, status = 200) {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(result) } }]
  }), { status, headers: { "Content-Type": "application/json" } });
}

test("provider configuration is optional but must be complete and secure", () => {
  assert.equal(readProviderConfig({}), null);
  assert.equal(roleplayStatus({}).available, false);
  assert.throws(
    () => readProviderConfig({ KAIWA_LLM_BASE_URL: "https://example.com/v1" }),
    RoleplayConfigError
  );
  assert.throws(
    () => readProviderConfig({
      KAIWA_LLM_BASE_URL: "http://provider.example/v1",
      KAIWA_LLM_API_KEY: "secret",
      KAIWA_LLM_MODEL: "model"
    }),
    /HTTPS/
  );
});

test("client roleplay input is bounded to known scenarios and short history", () => {
  const input = validateRoleplayInput({
    scenarioId: scenario.id,
    history: [{ role: "assistant", content: "いらっしゃいませ。" }],
    userText: "受け取りに来ました。"
  }, content.scenarios);
  assert.equal(input.scenario.id, scenario.id);
  assert.throws(
    () => validateRoleplayInput({ scenarioId: "missing", history: [], userText: "test" }, content.scenarios),
    /Unknown scenario/
  );
});

test("provider observations may reference only scenario skills", () => {
  assert.deepEqual(validateRoleplayResult(validResult, scenario), validResult);
  assert.throws(
    () => validateRoleplayResult({
      ...validResult,
      observations: [{ skillId: "hotel.checkout", outcome: "success" }]
    }, scenario),
    RoleplayProviderError
  );
  assert.throws(
    () => validateRoleplayResult({ ...validResult, surprise: true }, scenario),
    /unsupported fields/
  );
  assert.throws(
    () => validateRoleplayResult({
      ...validResult,
      staffReply: { ja: "お名前は？", parts: [{ text: "お名前は？", reading: "" }], meaning: "Your name?" }
    }, scenario),
    /needs a kana reading/
  );
});

test("roleplay requests strict structured output without exposing the key to the result", async () => {
  let request;
  const result = await runRoleplay({
    config,
    scenario,
    history: [],
    userText: "福岡店から取り寄せたカシオ SXC-1 を受け取りに来ました。",
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return completion();
    }
  });

  assert.deepEqual(result, validResult);
  assert.equal(request.url, "https://provider.example/v1/chat/completions");
  assert.equal(request.options.headers.Authorization, "Bearer fake-test-key");
  assert.equal(request.body.response_format.type, "json_schema");
  assert.equal(JSON.stringify(result).includes("fake-test-key"), false);
});

test("unsupported JSON schema mode falls back once to JSON object mode", async () => {
  const formats = [];
  const result = await runRoleplay({
    config,
    scenario,
    history: [],
    userText: "入荷していますか？",
    fetchImpl: async (_url, options) => {
      formats.push(JSON.parse(options.body).response_format.type);
      return formats.length === 1
        ? new Response("{}", { status: 400 })
        : completion({
            ...validResult,
            observations: [{ skillId: "shimamura.stock_check", outcome: "success" }]
          });
    }
  });

  assert.deepEqual(formats, ["json_schema", "json_object"]);
  assert.equal(result.observations[0].skillId, "shimamura.stock_check");
});

test("non-JSON model prose is rejected rather than graded", async () => {
  await assert.rejects(
    runRoleplay({
      config,
      scenario,
      history: [],
      userText: "test",
      fetchImpl: async () => new Response(JSON.stringify({
        choices: [{ message: { content: "Looks good to me!" } }]
      }), { status: 200 })
    }),
    /not valid JSON; no grade was applied/
  );
});
