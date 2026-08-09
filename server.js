import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  readProviderConfig,
  roleplayStatus,
  RoleplayConfigError,
  RoleplayInputError,
  RoleplayProviderError,
  runRoleplay,
  validateRoleplayInput
} from "./server/roleplay.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const contentPack = JSON.parse(await readFile(path.join(ROOT, "data/scenarios.json"), "utf8"));

const MIME_TYPES = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8"
});

const ROOT_FILES = new Set([
  "icon.svg",
  "index.html",
  "manifest.webmanifest",
  "service-worker.js",
  "styles.css"
]);

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32 * 1024) throw new RoleplayInputError("Request body is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RoleplayInputError("Request body must be valid JSON.");
  }
}

function staticRelativePath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  if (!ROOT_FILES.has(relative) && !relative.startsWith("src/") && !relative.startsWith("data/")) {
    return null;
  }
  const resolved = path.resolve(ROOT, relative);
  return resolved.startsWith(`${ROOT}${path.sep}`) ? resolved : null;
}

async function serveStatic(request, response, pathname) {
  const filePath = staticRelativePath(pathname);
  if (!filePath) {
    response.writeHead(404).end("Not found");
    return;
  }
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      "Cache-Control": path.basename(filePath) === "service-worker.js" ? "no-cache" : "no-cache",
      "Content-Length": fileStat.size,
      "Content-Type": MIME_TYPES[path.extname(filePath)] ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff"
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404).end("Not found");
  }
}

export function createKaiwaServer({ env = process.env, fetchImpl = fetch } = {}) {
  return createServer(async (request, response) => {
    const url = new URL(request.url, "http://kaiwa.local");
    try {
      if (request.method === "GET" && url.pathname === "/api/config") {
        sendJson(response, 200, roleplayStatus(env));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/roleplay") {
        const config = readProviderConfig(env);
        if (!config) throw new RoleplayConfigError("Routed roleplay is not configured.");
        const input = validateRoleplayInput(await readJsonBody(request), contentPack.scenarios);
        const result = await runRoleplay({ config, ...input, fetchImpl });
        sendJson(response, 200, result);
        return;
      }
      if (!["GET", "HEAD"].includes(request.method)) {
        sendJson(response, 405, { error: "Method not allowed." });
        return;
      }
      await serveStatic(request, response, url.pathname);
    } catch (error) {
      if (error instanceof RoleplayInputError) sendJson(response, 400, { error: error.message });
      else if (error instanceof RoleplayConfigError) sendJson(response, 503, { error: error.message });
      else if (error instanceof RoleplayProviderError) sendJson(response, 502, { error: error.message });
      else {
        console.error("Kaiwa server error", error);
        sendJson(response, 500, { error: "Unexpected server error." });
      }
    }
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.KAIWA_PORT ?? 4173);
  const host = process.env.KAIWA_HOST ?? "127.0.0.1";
  const server = createKaiwaServer();
  server.listen(port, host, () => {
    const status = roleplayStatus();
    console.log(`Kaiwa listening on http://${host}:${port}`);
    console.log(status.available ? `Routed roleplay enabled (${status.model}).` : `Routed roleplay disabled: ${status.reason}`);
  });
}
