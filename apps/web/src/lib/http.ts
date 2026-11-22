import { timingSafeEqual } from "node:crypto";
import { BookingError, type BookingErrorCode } from "@rmc/core";
import { ZodError, type ZodTypeAny, type z } from "zod";

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

const STATUS: Record<BookingErrorCode, number> = {
  SLOT_TAKEN: 409,
  NOT_FOUND: 404,
  HOLD_USED: 409,
  POLICY: 403,
  INVALID_STATE: 409,
};

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

/**
 * Turns any error into a safe response. Only error names and codes are logged:
 * database and validation errors can contain patient data (SEC-07).
 */
export function errorResponse(name: string, err: unknown): Response {
  if (err instanceof ApiError) return json({ error: err.code, message: err.message }, err.status);
  if (err instanceof BookingError) return json({ error: err.code, message: err.message }, STATUS[err.code]);
  if (err instanceof ZodError) {
    // Paths and rule messages only. Never the submitted values.
    return json({ error: "VALIDATION", issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, 400);
  }
  const message = err instanceof Error ? err.message : "";
  if (/^(DATABASE_URL|STRIPE_[A-Z_]+|CRON_SECRET) is not set$/.test(message)) {
    console.error(`[api:${name}] not configured: ${message}`); // names an env var, contains no data
    return json({ error: "NOT_CONFIGURED", message: "This feature is not available yet." }, 503);
  }
  console.error(`[api:${name}] unexpected ${err instanceof Error ? err.name : typeof err}`);
  return json({ error: "SERVER_ERROR", message: "Something went wrong. Please try again or call the clinic." }, 500);
}

export function route<C = unknown>(name: string, fn: (req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      return errorResponse(name, err);
    }
  };
}

const MAX_BODY_BYTES = 100_000;

export async function readJson<S extends ZodTypeAny>(req: Request, schema: S): Promise<z.output<S>> {
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new ApiError(413, "TOO_LARGE", "Request is too large");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ApiError(400, "BAD_JSON", "Body must be valid JSON");
  }
  return schema.parse(body);
}

export function clientIp(req: Request): string {
  return (
    req.headers.get("x-nf-client-connection-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

// ---- Rate limiting (SEC-06). In memory: a first line of defence per server instance.
// Turnstile and the database exclusion constraint are the real protections.
const hits = new Map<string, number[]>();

export function __resetRateLimits(): void {
  hits.clear();
}

export function rateLimit(req: Request, bucket: string, limit: number, windowMs = 60_000): void {
  const key = `${bucket}:${clientIp(req)}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    throw new ApiError(429, "RATE_LIMITED", "Too many requests. Please wait a moment and try again.");
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k);
}

/** Booking manage token: header for API calls, never logged. */
export function manageToken(req: Request, allowQuery = false): string {
  const h = req.headers.get("x-manage-token");
  if (h) return h;
  if (allowQuery) return new URL(req.url).searchParams.get("token") ?? "";
  return "";
}

/** SEC: scheduled jobs are protected by a shared secret, compared in constant time. */
export function requireCron(req: Request): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET is not set");
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ApiError(401, "UNAUTHORIZED", "Unauthorized");
}
