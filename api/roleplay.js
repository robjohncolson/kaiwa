import contentPack from "../data/scenarios.json" with { type: "json" };
import {
  readProviderConfig,
  RoleplayConfigError,
  RoleplayInputError,
  RoleplayProviderError,
  runRoleplay,
  validateRoleplayInput
} from "../server/roleplay.js";
import {
  authorizeRoleplayRequest,
  createRoleplayRateLimiter,
  readRoleplayRateLimit,
  RoleplayAccessError,
  roleplayClientKey
} from "../server/security.js";

const limiter = createRoleplayRateLimiter({ limit: readRoleplayRateLimit() });

function errorResponse(status, message, retryAfter = null) {
  const headers = { "Cache-Control": "no-store" };
  if (retryAfter) headers["Retry-After"] = String(retryAfter);
  return Response.json({ error: message }, {
    status,
    headers
  });
}

export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return errorResponse(405, "Method not allowed.");
    }

    try {
      authorizeRoleplayRequest(request);
      limiter.check(roleplayClientKey(request));
      const contentLength = Number(request.headers.get("content-length") ?? 0);
      if (contentLength > 32 * 1024) {
        throw new RoleplayInputError("Request body is too large.");
      }
      let body;
      try {
        const raw = await request.text();
        if (new TextEncoder().encode(raw).byteLength > 32 * 1024) {
          throw new RoleplayInputError("Request body is too large.");
        }
        body = JSON.parse(raw);
      } catch {
        throw new RoleplayInputError("Request body must be valid JSON and under 32 KB.");
      }

      const config = readProviderConfig();
      if (!config) throw new RoleplayConfigError("Routed roleplay is not configured.");
      const input = validateRoleplayInput(body, contentPack.scenarios);
      const result = await runRoleplay({ config, ...input });
      return Response.json(result, {
        headers: { "Cache-Control": "no-store" }
      });
    } catch (error) {
      if (error instanceof RoleplayAccessError) return errorResponse(error.status, error.message, error.retryAfter);
      if (error instanceof RoleplayInputError) return errorResponse(400, error.message);
      if (error instanceof RoleplayConfigError) return errorResponse(503, error.message);
      if (error instanceof RoleplayProviderError) return errorResponse(502, error.message);
      console.error("Kaiwa Vercel function error", error);
      return errorResponse(500, "Unexpected server error.");
    }
  }
};
