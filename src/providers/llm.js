export const LLM_ENV = Object.freeze({
  baseUrl: "KAIWA_LLM_BASE_URL",
  apiKey: "KAIWA_LLM_API_KEY",
  model: "KAIWA_LLM_MODEL"
});
export const ROLEPLAY_TOKEN_KEY = "kaiwa.roleplay-token.v1";

export function readRoleplayAccessToken(storage = globalThis.localStorage) {
  return storage?.getItem(ROLEPLAY_TOKEN_KEY)?.trim() ?? "";
}

export function saveRoleplayAccessToken(token, storage = globalThis.localStorage) {
  const value = String(token ?? "").trim();
  if (value) storage?.setItem(ROLEPLAY_TOKEN_KEY, value);
  else storage?.removeItem(ROLEPLAY_TOKEN_KEY);
  return value;
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    throw new Error("Roleplay proxy returned a non-JSON response.");
  }
}

export async function getRoleplayConfig(fetchImpl = fetch) {
  const response = await fetchImpl("./api/config", {
    headers: { Accept: "application/json" }
  });
  const body = await readJsonResponse(response);
  if (!response.ok) throw new Error(body.error ?? "Could not read roleplay configuration.");
  return body;
}

export async function requestRoleplay(payload, {
  fetchImpl = fetch,
  timeoutMs = 25_000,
  token = readRoleplayAccessToken()
} = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl("./api/roleplay", {
      method: "POST",
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const body = await readJsonResponse(response);
    if (!response.ok) throw new Error(body.error ?? "Roleplay request failed.");
    return body;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Roleplay timed out. The offline drill is still available.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
