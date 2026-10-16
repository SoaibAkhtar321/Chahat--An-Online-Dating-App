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
  /**
   * True when the call is metered and its authorised time is about to run out, so the server must
   * try to buy the next minute (extend_call_coverage) before it issues another token.
   */
  needsExtension: boolean;
}

/** Used only if an older database function does not report the lead time. */
export const DEFAULT_EXTENSION_LEAD_SECONDS = 20;

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

  // `free_seconds_remaining` is the number of authorised seconds left: the free minute, then each
  // prepaid minute. NULL means the call is unmetered (premium caller).
  const remaining = ctx.free_seconds_remaining;
  let lead = DEFAULT_EXTENSION_LEAD_SECONDS;
  if (ctx.extension_lead_seconds !== undefined && ctx.extension_lead_seconds !== null) {
    const rawLead = ctx.extension_lead_seconds;
    if (typeof rawLead !== "number" || !Number.isFinite(rawLead) || rawLead < 1 || rawLead > 50) {
      return fail(500, "internal_error", "Call state could not be read.");
    }
    lead = rawLead;
  }
  let ttlSeconds = MAX_TOKEN_TTL_SECONDS;
  let needsExtension = false;
  if (remaining !== null && remaining !== undefined) {
    if (typeof remaining !== "number" || !Number.isFinite(remaining)) {
      return fail(500, "internal_error", "Call state could not be read.");
    }
    if (remaining <= 0) return fail(410, "call_expired", "The call time allowance has ended.");
    ttlSeconds = Math.min(MAX_TOKEN_TTL_SECONDS, Math.floor(remaining));
    needsExtension = remaining <= lead && ctx.billing_exempt !== true;
  }
  return {
    ok: true,
    value: { callType: ctx.call_type, ttlSeconds: Math.max(1, ttlSeconds), needsExtension },
  };
}

export interface ExtensionOutcome {
  /** Authorised seconds remaining after the attempt; null when the call is unmetered. */
  coveredSeconds: number | null;
}

/**
 * `value` is the JSON returned by public.extend_call_coverage. Anything that is not an explicit
 * success stops the request before a token is issued; in particular running out of coins is a
 * 402 and never a silent free extension.
 */
export function parseExtensionResult(value: unknown): PolicyResult<ExtensionOutcome> {
  if (typeof value !== "object" || value === null) {
    return fail(500, "internal_error", "Call billing could not be checked.");
  }
  const v = value as Record<string, unknown>;
  if (v.ok === true) {
    const covered = v.covered_seconds_remaining;
    if (covered === null || covered === undefined) {
      if (v.exempt === true) return { ok: true, value: { coveredSeconds: null } };
      return fail(500, "internal_error", "Call billing could not be checked.");
    }
    if (typeof covered !== "number" || !Number.isFinite(covered) || covered <= 0) {
      return fail(500, "internal_error", "Call billing could not be checked.");
    }
    return { ok: true, value: { coveredSeconds: covered } };
  }
  switch (v.code) {
    case "insufficient_coins":
      return fail(402, "insufficient_coins", "Not enough coins to continue this call.");
    case "call_expired":
      return fail(410, "call_expired", "The call time allowance has ended.");
    case "call_not_active":
      return fail(410, "call_ended", "This call has already ended.");
    case "call_not_allowed":
      return fail(403, "call_not_allowed", "This call is no longer available to you.");
    case "call_not_found":
      return fail(404, "call_not_found", "Call not found.");
    default:
      return fail(500, "internal_error", "Call billing could not be checked.");
  }
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
