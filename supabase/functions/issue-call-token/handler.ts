// Request handling for issue-call-token with every external dependency injected, so the full
// authorization flow can be unit tested without Deno, Supabase or a call provider.
import type { CallProvider } from "../_shared/callProvider.ts";
import {
  evaluateJoinContext,
  extractBearerToken,
  parseCallTokenRequest,
  parseRateLimit,
} from "./policy.ts";

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export interface IssueCallTokenDeps {
  /** Validates the JWT with Supabase Auth. Returns the user id, or null if invalid. */
  verifyUser(token: string): Promise<string | null>;
  /** Calls consume_call_token_rate_limit; resolves to the raw JSON or throws on failure. */
  consumeRateLimit(userId: string): Promise<unknown>;
  /** Calls get_call_join_context; resolves to the raw JSON or throws on failure. */
  getJoinContext(callId: string, userId: string): Promise<unknown>;
  provider: CallProvider;
  logError?(message: string): void;
}

const json = (status: number, body: Record<string, unknown>, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store", ...extra },
  });
const failure = (status: number, code: string, error: string, extra: Record<string, string> = {}) =>
  json(status, { success: false, code, error }, extra);

const UNAVAILABLE = "Calling is not available right now.";

export async function handleIssueCallToken(
  request: Request,
  deps: IssueCallTokenDeps,
): Promise<Response> {
  const log = deps.logError ?? (() => undefined);
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return failure(405, "method_not_allowed", "Method not allowed.");

  // 1. Authenticate. Identity comes only from the verified JWT.
  const token = extractBearerToken(request.headers.get("Authorization"));
  if (!token) return failure(401, "unauthenticated", "Sign in to join a call.");
  let userId: string | null = null;
  try {
    userId = await deps.verifyUser(token);
  } catch {
    return failure(401, "unauthenticated", "Sign in to join a call.");
  }
  if (!userId) return failure(401, "unauthenticated", "Sign in to join a call.");

  // 2. Validate the request shape. call_id only; forged identities are rejected.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure(400, "invalid_request", "Request body must be valid JSON.");
  }
  const parsed = parseCallTokenRequest(body);
  if (!parsed.ok) return failure(parsed.error.status, parsed.error.code, parsed.error.message);

  // 3. Server-enforced rate limit, before any call lookup so probing is throttled too.
  let limit;
  try {
    limit = parseRateLimit(await deps.consumeRateLimit(userId));
  } catch {
    limit = null;
  }
  if (!limit) {
    log("Call token rate limit check failed.");
    return failure(500, "internal_error", UNAVAILABLE);
  }
  if (!limit.allowed) {
    return failure(429, "rate_limited", "Too many call attempts. Try again shortly.", {
      "Retry-After": String(limit.retryAfterSeconds),
    });
  }

  // 4. Authorise against the database.
  let context: unknown;
  try {
    context = await deps.getJoinContext(parsed.value.callId, userId);
  } catch {
    log("Call join context lookup failed.");
    return failure(500, "internal_error", UNAVAILABLE);
  }
  const decision = evaluateJoinContext(context);
  if (!decision.ok) return failure(decision.error.status, decision.error.code, decision.error.message);

  // 5. Provider. Without one configured we say so plainly; nothing is simulated.
  const provider = deps.provider;
  if (!provider.configured) {
    return failure(503, "provider_not_configured", "Audio and video calling is not configured yet.");
  }
  try {
    const room = await provider.ensureRoom({
      callId: parsed.value.callId,
      callType: decision.value.callType,
    });
    if (!room.ok) {
      log(`Call provider could not prepare a room: ${room.code}`);
      return failure(502, "provider_error", "Could not start the call. Please try again.");
    }
    const grant = await provider.issueJoinToken({
      roomId: room.value.roomId,
      participantId: userId,
      callType: decision.value.callType,
      ttlSeconds: decision.value.ttlSeconds,
    });
    if (!grant.ok) {
      log(`Call provider could not issue a token: ${grant.code}`);
      return failure(502, "provider_error", "Could not start the call. Please try again.");
    }
    return json(200, {
      success: true,
      provider: provider.name,
      room_id: grant.value.roomId,
      token: grant.value.token,
      expires_at: grant.value.expiresAt,
      call_type: decision.value.callType,
    });
  } catch {
    log("Call provider threw an unexpected error.");
    return failure(502, "provider_error", "Could not start the call. Please try again.");
  }
}
