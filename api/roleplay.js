import contentPack from "../data/scenarios.json" with { type: "json" };
import {
  readProviderConfig,
  RoleplayConfigError,
  RoleplayInputError,
  RoleplayProviderError,
  runRoleplay,
  validateRoleplayInput
} from "../server/roleplay.js";

function errorResponse(status, message) {
  return Response.json({ error: message }, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return errorResponse(405, "Method not allowed.");
    }

    try {
      const contentLength = Number(request.headers.get("content-length") ?? 0);
      if (contentLength > 32 * 1024) {
        throw new RoleplayInputError("Request body is too large.");
      }
      let body;
      try {
        body = await request.json();
      } catch {
        throw new RoleplayInputError("Request body must be valid JSON.");
      }

      const config = readProviderConfig();
      if (!config) throw new RoleplayConfigError("Routed roleplay is not configured.");
      const input = validateRoleplayInput(body, contentPack.scenarios);
      const result = await runRoleplay({ config, ...input });
      return Response.json(result, {
        headers: { "Cache-Control": "no-store" }
      });
    } catch (error) {
      if (error instanceof RoleplayInputError) return errorResponse(400, error.message);
      if (error instanceof RoleplayConfigError) return errorResponse(503, error.message);
      if (error instanceof RoleplayProviderError) return errorResponse(502, error.message);
      console.error("Kaiwa Vercel function error", error);
      return errorResponse(500, "Unexpected server error.");
    }
  }
};
