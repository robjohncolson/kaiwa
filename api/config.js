import { roleplayStatus } from "../server/roleplay.js";

export default {
  fetch(request) {
    if (request.method !== "GET") {
      return Response.json({ error: "Method not allowed." }, { status: 405 });
    }
    return Response.json(roleplayStatus(), {
      headers: { "Cache-Control": "no-store" }
    });
  }
};
