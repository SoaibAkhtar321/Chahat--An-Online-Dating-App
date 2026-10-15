// Pure, dependency-free decision logic for issue-call-token so it can be unit tested in Jest.
// The database function get_call_join_context supplies facts; this module decides.

export const MAX_TOKEN_TTL_SECONDS = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PolicyError {
  status: number;
  code: string;
  message: string;
}
export type PolicyResult<T> = { ok: true; value: T } | { ok: false; error: PolicyError };

const fail = (status: number, code: string, message: string): { ok: false; error: PolicyError } => ({
  ok: false,
  error: { status, code, message },
});

export function extractBearerToken(header: string | null | undefined): string | null {
  const match = /^Bearer\s+([A-Za-z0-9._~+/=-]+)$/.exec((header ?? "").trim());
  return match ? match[1] : null;
}

/** Only `call_id` is accepted. Any client-supplied identity (participant, user, role) is rejected. */
export function parseCallTokenRequest(body: unknown): PolicyResult<{ callId: string }> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail(400, "invalid_request", "Request body must be a JSON object.");
  }
  const keys = Object.keys(body);
  if (keys.some((key) => key !== "call_id")) {
    return fail(400, "invalid_request", "Only call_id may be supplied.");
  }
  const callId = (body as Record<string, unknown>).call_id;
  if (typeof callId !== "string" || !UUID.test(callId)) {
    return fail(400, "invalid_request", "call_id must be a valid call identifier.");
  }
  return { ok: true, value: { callId: callId.toLowerCase() } };
}

export interface JoinDecision {
  callType: "audio" | "video";
  ttlSeconds: number;
}

/**
 * `context` is the JSON returned by public.get_call_join_context(call_id, authenticated_user_id).
 * Non-participants and unknown calls are indistinguishable (404) so call ids cannot be probed.
 */
export function evaluateJoinContext(context: unknown): PolicyResult<JoinDecision> {
  if (typeof context !== "object" || context === null) {
    return fail(500, "internal_error", "Call state could not be read.");
  }
  const ctx = context as Record<string, unknown>;
  if (ctx.found !== true) return fail(404, "call_not_found", "Call not found.");
  if (ctx.eligible !== true) {
    return fail(403, "call_not_allowed", "This call is no longer available to you.");
  }
  switch (ctx.status) {
    case "accepted":
      break;
    case "pending":
      return fail(409, "call_not_accepted", "The call has not been accepted yet.");
    case "declined":
    case "cancelled":
    case "timed_out":
    case "ended":
      return fail(410, "call_ended", "This call has already ended.");
    default:
      return fail(500, "internal_error", "Call state could not be read.");
  }
  if (ctx.accepted !== true) return fail(409, "call_not_accepted", "The call has not been accepted yet.");
  if (ctx.call_type !== "audio" && ctx.call_type !== "video") {
    return fail(500, "internal_error", "Call state could not be read.");
  }

  const remaining = ctx.free_seconds_remaining;
  let ttlSeconds = MAX_TOKEN_TTL_SECONDS;
  if (remaining !== null && remaining !== undefined) {
    if (typeof remaining !== "number" || !Number.isFinite(remaining)) {
      return fail(500, "internal_error", "Call state could not be read.");
    }
    if (remaining <= 0) return fail(410, "call_expired", "The call time allowance has ended.");
    ttlSeconds = Math.min(MAX_TOKEN_TTL_SECONDS, Math.floor(remaining));
  }
  return { ok: true, value: { callType: ctx.call_type, ttlSeconds: Math.max(1, ttlSeconds) } };
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function parseRateLimit(value: unknown): RateLimitResult | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.allowed !== "boolean") return null;
  const retry = typeof v.retry_after_seconds === "number" ? v.retry_after_seconds : 60;
  return { allowed: v.allowed, retryAfterSeconds: Math.max(1, Math.ceil(retry)) };
}
