import { randomUUID } from "node:crypto";

const OUTCOMES = Object.freeze(["success", "partial", "miss", "not_tested"]);

export class RoleplayInputError extends Error {}
export class RoleplayConfigError extends Error {}
export class RoleplayProviderError extends Error {}

export const ROLEPLAY_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["staffReply", "observations", "shouldAbort", "hint"],
  properties: {
    staffReply: {
      type: "object",
      additionalProperties: false,
      required: ["ja", "meaning"],
      properties: {
        ja: { type: "string", maxLength: 500 },
        meaning: { type: "string", maxLength: 500 }
      }
    },
    observations: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["skillId", "outcome"],
        properties: {
          skillId: { type: "string" },
          outcome: { type: "string", enum: OUTCOMES }
        }
      }
    },
    shouldAbort: { type: "boolean" },
    hint: { type: "string", maxLength: 500 }
  }
});

function isLoopback(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function readProviderConfig(env = process.env) {
  const baseUrl = env.KAIWA_LLM_BASE_URL?.trim();
  const apiKey = env.KAIWA_LLM_API_KEY?.trim();
  const model = env.KAIWA_LLM_MODEL?.trim();
  const configuredCount = [baseUrl, apiKey, model].filter(Boolean).length;

  if (configuredCount === 0) return null;
  if (configuredCount !== 3) {
    throw new RoleplayConfigError(
      "Roleplay needs KAIWA_LLM_BASE_URL, KAIWA_LLM_API_KEY, and KAIWA_LLM_MODEL together."
    );
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw new RoleplayConfigError("KAIWA_LLM_BASE_URL must be a valid URL.");
  }
  if (parsedUrl.protocol !== "https:" && !(parsedUrl.protocol === "http:" && isLoopback(parsedUrl.hostname))) {
    throw new RoleplayConfigError(
      "KAIWA_LLM_BASE_URL must use HTTPS (loopback HTTP is allowed for tests)."
    );
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    model
  };
}

export function roleplayStatus(env = process.env) {
  try {
    const config = readProviderConfig(env);
    return config
      ? { available: true, model: config.model }
      : { available: false, reason: "Provider environment variables are not set." };
  } catch (error) {
    return { available: false, reason: error.message };
  }
}

export function validateRoleplayInput(body, scenarios) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RoleplayInputError("Request body must be an object.");
  }
  const scenario = scenarios.find((entry) => entry.id === body.scenarioId);
  if (!scenario) throw new RoleplayInputError("Unknown scenarioId.");
  if (typeof body.userText !== "string" || body.userText.trim().length === 0 || body.userText.length > 500) {
    throw new RoleplayInputError("userText must contain 1–500 characters.");
  }
  if (!Array.isArray(body.history) || body.history.length > 12) {
    throw new RoleplayInputError("history must be an array of at most 12 messages.");
  }

  const history = body.history.map((message) => {
    if (!message || !["user", "assistant"].includes(message.role)) {
      throw new RoleplayInputError("history roles must be user or assistant.");
    }
    if (typeof message.content !== "string" || message.content.length === 0 || message.content.length > 500) {
      throw new RoleplayInputError("history content must contain 1–500 characters.");
    }
    return { role: message.role, content: message.content };
  });

  return { scenario, history, userText: body.userText.trim() };
}

function scenarioPrompt(scenario) {
  const lines = scenario.allowedUserLines
    .map((line) => `- ${line.skillId}: ${line.ja} (${line.meaning})`)
    .join("\n");
  const staffPrompts = scenario.staffPrompts.length > 0
    ? scenario.staffPrompts.map((prompt) => `- ${prompt.ja} (${prompt.meaning})`).join("\n")
    : "- No verified staff prompts are recorded. Keep any reply short and plausible.";

  return `You are the Japanese conversation partner and a conservative observation sensor for a traveler with limited Japanese.

Scenario: ${scenario.title}
Purpose: ${scenario.purpose}

Allowed traveler lines and their skill IDs:
${lines}

Verified likely partner prompts:
${staffPrompts}

Rules:
- Roleplay only this scenario. Reply as staff or host in short, natural Japanese.
- Do not add route advice, policy claims, promises, prices, or facts absent from the scenario.
- Grade only the traveler's latest message against the allowed lines.
- success means the intended fixed line was clear; partial means recognizable but flawed; miss means wrong or unusable; not_tested means no evidence.
- Include each relevant allowed skill at most once. Use shouldAbort when the exchange has moved beyond the safe closed loop.
- The hint must be an empty string when no hint is needed.
- Return JSON only, matching the supplied schema.`;
}

function validateExactKeys(value, allowed, label) {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length > 0) {
    throw new RoleplayProviderError(`${label} contained unsupported fields.`);
  }
}

export function validateRoleplayResult(value, scenario) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RoleplayProviderError("Provider result was not an object.");
  }
  validateExactKeys(value, ["staffReply", "observations", "shouldAbort", "hint"], "Provider result");

  const reply = value.staffReply;
  if (!reply || typeof reply !== "object" || Array.isArray(reply)) {
    throw new RoleplayProviderError("Provider result lacked staffReply.");
  }
  validateExactKeys(reply, ["ja", "meaning"], "staffReply");
  if (typeof reply.ja !== "string" || reply.ja.length === 0 || reply.ja.length > 500) {
    throw new RoleplayProviderError("staffReply.ja was invalid.");
  }
  if (typeof reply.meaning !== "string" || reply.meaning.length > 500) {
    throw new RoleplayProviderError("staffReply.meaning was invalid.");
  }
  if (typeof value.shouldAbort !== "boolean" || typeof value.hint !== "string" || value.hint.length > 500) {
    throw new RoleplayProviderError("Provider guidance fields were invalid.");
  }
  if (!Array.isArray(value.observations) || value.observations.length < 1 || value.observations.length > 8) {
    throw new RoleplayProviderError("Provider observations were invalid.");
  }

  const allowedSkills = new Set(scenario.allowedUserLines.map((line) => line.skillId));
  const seen = new Set();
  for (const observation of value.observations) {
    if (!observation || typeof observation !== "object" || Array.isArray(observation)) {
      throw new RoleplayProviderError("Provider observation was invalid.");
    }
    validateExactKeys(observation, ["skillId", "outcome"], "Provider observation");
    if (!allowedSkills.has(observation.skillId) || seen.has(observation.skillId)) {
      throw new RoleplayProviderError("Provider observation referenced an invalid or duplicate skill.");
    }
    if (!OUTCOMES.includes(observation.outcome)) {
      throw new RoleplayProviderError("Provider observation used an invalid outcome.");
    }
    seen.add(observation.skillId);
  }

  return {
    staffReply: { ja: reply.ja, meaning: reply.meaning },
    observations: value.observations.map(({ skillId, outcome }) => ({ skillId, outcome })),
    shouldAbort: value.shouldAbort,
    hint: value.hint
  };
}

function requestBody(config, scenario, history, userText, responseFormat) {
  const format = responseFormat === "json_schema"
    ? {
        type: "json_schema",
        json_schema: {
          name: "kaiwa_roleplay_observation",
          strict: true,
          schema: ROLEPLAY_RESPONSE_SCHEMA
        }
      }
    : { type: "json_object" };

  return {
    model: config.model,
    messages: [
      { role: "system", content: scenarioPrompt(scenario) },
      ...history,
      { role: "user", content: userText }
    ],
    response_format: format,
    temperature: 0.2
  };
}

async function providerFetch(config, body, fetchImpl, signal) {
  return fetchImpl(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "X-Client-Request-Id": randomUUID()
    },
    body: JSON.stringify(body),
    signal
  });
}

async function providerError(response) {
  const requestId = response.headers.get("x-request-id");
  const suffix = requestId ? ` Request ID: ${requestId}` : "";
  return new RoleplayProviderError(`Provider request failed with HTTP ${response.status}.${suffix}`);
}

export async function runRoleplay({
  config,
  scenario,
  history,
  userText,
  fetchImpl = fetch,
  timeoutMs = 20_000
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response = await providerFetch(
      config,
      requestBody(config, scenario, history, userText, "json_schema"),
      fetchImpl,
      controller.signal
    );

    if ([400, 422].includes(response.status)) {
      response = await providerFetch(
        config,
        requestBody(config, scenario, history, userText, "json_object"),
        fetchImpl,
        controller.signal
      );
    }
    if (!response.ok) throw await providerError(response);

    let upstream;
    try {
      upstream = await response.json();
    } catch {
      throw new RoleplayProviderError("Provider returned non-JSON HTTP content.");
    }
    const content = upstream?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new RoleplayProviderError("Provider response lacked message content.");
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new RoleplayProviderError("Provider message was not valid JSON; no grade was applied.");
    }
    return validateRoleplayResult(parsed, scenario);
  } catch (error) {
    if (error.name === "AbortError") {
      throw new RoleplayProviderError("Provider timed out; no grade was applied.");
    }
    if (error instanceof RoleplayProviderError) throw error;
    throw new RoleplayProviderError("Provider request could not be completed; no grade was applied.");
  } finally {
    clearTimeout(timeout);
  }
}
