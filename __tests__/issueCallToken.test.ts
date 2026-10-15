import { handleIssueCallToken, type IssueCallTokenDeps } from "../supabase/functions/issue-call-token/handler";
import {
  MAX_TOKEN_TTL_SECONDS,
  evaluateJoinContext,
  extractBearerToken,
  parseCallTokenRequest,
} from "../supabase/functions/issue-call-token/policy";
import type { CallProvider } from "../supabase/functions/_shared/callProvider";

const CALL_ID = "0b6d2f84-5a37-4c1e-9d0f-6a1c2e3f4a5b";
const USER_ID = "60000000-0000-0000-0000-000000000001";

const acceptedContext = {
  found: true,
  status: "accepted",
  call_type: "video",
  eligible: true,
  accepted: true,
  free_seconds_remaining: null,
};

function makeProvider(overrides: Partial<CallProvider> = {}): CallProvider {
  return {
    name: "fake",
    configured: true,
    ensureRoom: jest.fn(async () => ({ ok: true as const, value: { roomId: "room-1" } })),
    issueJoinToken: jest.fn(async () => ({
      ok: true as const,
      value: { roomId: "room-1", token: "join-token", expiresAt: "2026-10-16T12:02:00Z" },
    })),
    endRoom: jest.fn(async () => ({ ok: true as const, value: undefined })),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<IssueCallTokenDeps> = {}) {
  const deps = {
    verifyUser: jest.fn(async () => USER_ID as string | null),
    consumeRateLimit: jest.fn(async () => ({ allowed: true, retry_after_seconds: 30 }) as unknown),
    getJoinContext: jest.fn(async () => acceptedContext as unknown),
    provider: makeProvider(),
    logError: jest.fn(),
    ...overrides,
  };
  return deps;
}

function post(body: unknown, headers: Record<string, string> = { Authorization: "Bearer good.jwt-token" }) {
  return new Request("https://x.test/issue-call-token", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function run(request: Request, deps: IssueCallTokenDeps) {
  const response = await handleIssueCallToken(request, deps);
  return { status: response.status, headers: response.headers, body: await response.json().catch(() => null) };
}

describe("issue-call-token policy", () => {
  it("accepts only a valid call_id", () => {
    expect(parseCallTokenRequest({ call_id: CALL_ID.toUpperCase() })).toEqual({
      ok: true,
      value: { callId: CALL_ID },
    });
    for (const bad of [null, [], "x", {}, { call_id: 5 }, { call_id: "not-a-uuid" }]) {
      expect(parseCallTokenRequest(bad)).toMatchObject({ ok: false, error: { status: 400 } });
    }
  });

  it("rejects any client-supplied identity fields", () => {
    for (const extra of ["participant_id", "user_id", "role", "caller_id"]) {
      expect(parseCallTokenRequest({ call_id: CALL_ID, [extra]: USER_ID })).toMatchObject({
        ok: false,
        error: { status: 400, code: "invalid_request" },
      });
    }
  });

  it("extracts bearer tokens strictly", () => {
    expect(extractBearerToken("Bearer abc.def-ghi")).toBe("abc.def-ghi");
    expect(extractBearerToken("bearer")).toBeNull();
    expect(extractBearerToken("Basic abc")).toBeNull();
    expect(extractBearerToken("Bearer a b")).toBeNull();
    expect(extractBearerToken(null)).toBeNull();
  });

  it("caps token lifetime and follows the remaining free allowance", () => {
    expect(evaluateJoinContext(acceptedContext)).toEqual({
      ok: true,
      value: { callType: "video", ttlSeconds: MAX_TOKEN_TTL_SECONDS },
    });
    expect(evaluateJoinContext({ ...acceptedContext, free_seconds_remaining: 45.4 })).toMatchObject({
      ok: true,
      value: { ttlSeconds: 45 },
    });
    expect(evaluateJoinContext({ ...acceptedContext, free_seconds_remaining: 9999 })).toMatchObject({
      ok: true,
      value: { ttlSeconds: MAX_TOKEN_TTL_SECONDS },
    });
    expect(evaluateJoinContext({ ...acceptedContext, free_seconds_remaining: 0 })).toMatchObject({
      ok: false,
      error: { status: 410, code: "call_expired" },
    });
  });

  it("fails closed on malformed or unknown database output", () => {
    for (const bad of [
      null,
      "x",
      { found: true, eligible: true, status: "weird", accepted: true, call_type: "audio" },
      { ...acceptedContext, call_type: "screen" },
      { ...acceptedContext, free_seconds_remaining: "9" },
      { ...acceptedContext, accepted: false },
    ]) {
      expect(evaluateJoinContext(bad).ok).toBe(false);
    }
  });
});

describe("issue-call-token handler", () => {
  it("answers CORS preflight and rejects other methods", async () => {
    const deps = makeDeps();
    expect((await handleIssueCallToken(new Request("https://x.test", { method: "OPTIONS" }), deps)).status).toBe(200);
    const get = await run(new Request("https://x.test", { method: "GET" }), deps);
    expect(get.status).toBe(405);
  });

  it("rejects unauthenticated requests before touching the database", async () => {
    const deps = makeDeps();
    const missing = await run(post({ call_id: CALL_ID }, {}), deps);
    expect(missing).toMatchObject({ status: 401, body: { code: "unauthenticated" } });
    expect(deps.verifyUser).not.toHaveBeenCalled();

    deps.verifyUser.mockResolvedValueOnce(null);
    expect((await run(post({ call_id: CALL_ID }), deps)).status).toBe(401);
    deps.verifyUser.mockRejectedValueOnce(new Error("auth down"));
    expect((await run(post({ call_id: CALL_ID }), deps)).status).toBe(401);
    expect(deps.consumeRateLimit).not.toHaveBeenCalled();
    expect(deps.getJoinContext).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON, bad ids and forged participant ids", async () => {
    const deps = makeDeps();
    expect((await run(post("{not json"), deps)).status).toBe(400);
    expect((await run(post({ call_id: "nope" }), deps)).status).toBe(400);
    const forged = await run(post({ call_id: CALL_ID, participant_id: "someone-else" }), deps);
    expect(forged).toMatchObject({ status: 400, body: { code: "invalid_request" } });
    expect(deps.getJoinContext).not.toHaveBeenCalled();
    expect(deps.provider.issueJoinToken).not.toHaveBeenCalled();
  });

  it("enforces the rate limit before any call lookup", async () => {
    const deps = makeDeps({
      consumeRateLimit: jest.fn(async () => ({ allowed: false, retry_after_seconds: 17 })),
    });
    const result = await run(post({ call_id: CALL_ID }), deps);
    expect(result.status).toBe(429);
    expect(result.body.code).toBe("rate_limited");
    expect(result.headers.get("Retry-After")).toBe("17");
    expect(deps.getJoinContext).not.toHaveBeenCalled();
  });

  it("fails closed when the rate limiter errors or answers nonsense", async () => {
    for (const consumeRateLimit of [
      jest.fn(async () => {
        throw new Error("db down");
      }),
      jest.fn(async () => ({ nope: true })),
      jest.fn(async () => null),
    ]) {
      const deps = makeDeps({ consumeRateLimit });
      expect((await run(post({ call_id: CALL_ID }), deps)).status).toBe(500);
      expect(deps.getJoinContext).not.toHaveBeenCalled();
    }
  });

  it("treats unrelated users and unknown calls identically (404)", async () => {
    const deps = makeDeps({ getJoinContext: jest.fn(async () => ({ found: false })) });
    const result = await run(post({ call_id: CALL_ID }), deps);
    expect(result).toMatchObject({ status: 404, body: { code: "call_not_found" } });
    expect(deps.provider.ensureRoom).not.toHaveBeenCalled();
  });

  it("passes the VERIFIED user id, never a body value, to the database and provider", async () => {
    const deps = makeDeps();
    await run(post({ call_id: CALL_ID }), deps);
    expect(deps.getJoinContext).toHaveBeenCalledWith(CALL_ID, USER_ID);
    expect(deps.provider.issueJoinToken).toHaveBeenCalledWith(
      expect.objectContaining({ participantId: USER_ID }),
    );
  });

  it.each([
    ["ineligible participants", { ...acceptedContext, eligible: false }, 403, "call_not_allowed"],
    ["pending (unaccepted) calls", { ...acceptedContext, status: "pending", accepted: false }, 409, "call_not_accepted"],
    ["ended calls", { ...acceptedContext, status: "ended" }, 410, "call_ended"],
    ["declined calls", { ...acceptedContext, status: "declined" }, 410, "call_ended"],
    ["cancelled calls", { ...acceptedContext, status: "cancelled" }, 410, "call_ended"],
    ["timed-out invitations", { ...acceptedContext, status: "timed_out" }, 410, "call_ended"],
    ["expired free allowance", { ...acceptedContext, free_seconds_remaining: 0 }, 410, "call_expired"],
  ])("refuses %s without issuing a token", async (_label, context, status, code) => {
    const deps = makeDeps({ getJoinContext: jest.fn(async () => context) });
    const result = await run(post({ call_id: CALL_ID }), deps);
    expect(result).toMatchObject({ status, body: { success: false, code } });
    expect(deps.provider.ensureRoom).not.toHaveBeenCalled();
    expect(deps.provider.issueJoinToken).not.toHaveBeenCalled();
  });

  it("returns a clear provider-not-configured result and never simulates success", async () => {
    const deps = makeDeps({ provider: makeProvider({ configured: false }) });
    const result = await run(post({ call_id: CALL_ID }), deps);
    expect(result).toMatchObject({ status: 503, body: { success: false, code: "provider_not_configured" } });
    expect(result.body.token).toBeUndefined();
    expect(deps.provider.ensureRoom).not.toHaveBeenCalled();
  });

  it("hides provider error details from the client", async () => {
    const secretDetail = "AGORA_APP_CERTIFICATE=abc123";
    const room = makeDeps({
      provider: makeProvider({
        ensureRoom: jest.fn(async () => ({ ok: false as const, code: "provider_error" as const, message: secretDetail })),
      }),
    });
    const token = makeDeps({
      provider: makeProvider({
        issueJoinToken: jest.fn(async () => ({ ok: false as const, code: "provider_error" as const, message: secretDetail })),
      }),
    });
    const thrown = makeDeps({
      provider: makeProvider({
        issueJoinToken: jest.fn(async () => {
          throw new Error(secretDetail);
        }),
      }),
    });
    for (const deps of [room, token, thrown]) {
      const result = await run(post({ call_id: CALL_ID }), deps);
      expect(result).toMatchObject({ status: 502, body: { code: "provider_error" } });
      expect(JSON.stringify(result.body)).not.toContain("abc123");
      expect(deps.logError.mock.calls.flat().join(" ")).not.toContain("abc123");
    }
  });

  it("returns only the minimum join information on success", async () => {
    const deps = makeDeps({ getJoinContext: jest.fn(async () => ({ ...acceptedContext, free_seconds_remaining: 30 })) });
    const result = await run(post({ call_id: CALL_ID }), deps);
    expect(result.status).toBe(200);
    expect(Object.keys(result.body).sort()).toEqual(
      ["call_type", "expires_at", "provider", "room_id", "success", "token"].sort(),
    );
    expect(deps.provider.issueJoinToken).toHaveBeenCalledWith(expect.objectContaining({ ttlSeconds: 30 }));
    expect(result.headers.get("Cache-Control")).toBe("no-store");
  });
});
