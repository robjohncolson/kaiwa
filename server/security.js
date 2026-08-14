export class RoleplayAccessError extends Error {
  constructor(status, message, retryAfter = null) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function headerValue(request, name) {
  if (typeof request?.headers?.get === "function") return request.headers.get(name);
  const value = request?.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value ?? null;
}

function timingSafeEqualText(left, right) {
  const a = String(left ?? "");
  const b = String(right ?? "");
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a.charCodeAt(index % Math.max(1, a.length)) || 0)
      ^ (b.charCodeAt(index % Math.max(1, b.length)) || 0);
  }
  return difference === 0;
}

export function readRoleplayAccessToken(env = process.env) {
  const token = env.KAIWA_ROLEPLAY_TOKEN?.trim();
  if (!token || token.length < 16) {
    throw new RoleplayAccessError(503, "Roleplay needs KAIWA_ROLEPLAY_TOKEN with at least 16 characters.");
  }
  return token;
}

function requestOrigin(request) {
  const origin = headerValue(request, "origin");
  if (!origin) return null;
  try {
    return new URL(origin).origin;
  } catch {
    throw new RoleplayAccessError(403, "Request origin is invalid.");
  }
}

function allowedOrigins(request, env) {
  const configured = env.KAIWA_ALLOWED_ORIGINS
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (configured?.length) {
    try {
      return new Set(configured.map((value) => new URL(value).origin));
    } catch {
      throw new RoleplayAccessError(503, "KAIWA_ALLOWED_ORIGINS contains an invalid URL.");
    }
  }
  const host = headerValue(request, "x-forwarded-host") ?? headerValue(request, "host");
  if (!host) return new Set();
  const protocol = headerValue(request, "x-forwarded-proto") ?? (host.startsWith("127.0.0.1") || host.startsWith("localhost") ? "http" : "https");
  return new Set([`${protocol}://${host}`]);
}

export function authorizeRoleplayRequest(request, env = process.env) {
  const expected = readRoleplayAccessToken(env);
  const authorization = headerValue(request, "authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!timingSafeEqualText(supplied, expected)) {
    throw new RoleplayAccessError(401, "A valid roleplay access token is required.");
  }
  const origin = requestOrigin(request);
  if (origin && !allowedOrigins(request, env).has(origin)) {
    throw new RoleplayAccessError(403, "This origin is not allowed to use roleplay.");
  }
  return true;
}

export function roleplayClientKey(request) {
  const forwarded = headerValue(request, "x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request?.socket?.remoteAddress || "unknown";
}

export function readRoleplayRateLimit(env = process.env) {
  const value = Number(env.KAIWA_ROLEPLAY_RATE_LIMIT ?? 10);
  return Number.isInteger(value) && value >= 1 && value <= 60 ? value : 10;
}

export function createRoleplayRateLimiter({ limit = 10, windowMs = 60_000 } = {}) {
  const buckets = new Map();
  return {
    check(key, now = Date.now()) {
      const current = buckets.get(key);
      const bucket = !current || now >= current.resetAt
        ? { count: 0, resetAt: now + windowMs }
        : current;
      bucket.count += 1;
      buckets.set(key, bucket);
      if (buckets.size > 1_000) {
        for (const [candidate, value] of buckets) {
          if (now >= value.resetAt) buckets.delete(candidate);
        }
      }
      if (bucket.count > limit) {
        const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
        throw new RoleplayAccessError(429, "Roleplay rate limit reached. Try again shortly.", retryAfter);
      }
      return { remaining: Math.max(0, limit - bucket.count), resetAt: bucket.resetAt };
    }
  };
}
