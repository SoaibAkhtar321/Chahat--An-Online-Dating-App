import { handleIssueCallToken, type IssueCallTokenDeps } from "../supabase/functions/issue-call-token/handler";
import {
  evaluateJoinContext,
  parseExtensionResult,
} from "../supabase/functions/issue-call-token/policy";
import type { CallProvider } from "../supabase/functions/_shared/callProvider";

const CALL_ID = "0b6d2f84-5a37-4c1e-9d0f-6a1c2e3f4a5b";
const USER_ID = "60000000-0000-0000-0000-000000000001";

const ctx = (over: Record<string, unknown> = {}) => ({
  found: true,
  status: "accepted",
  call_type: "video",
  eligible: true,
  accepted: true,
  free_seconds_remaining: 45,
  billing_exempt: false,
  extension_lead_seconds: 20,
  ...over,
});

function provider(): CallProvider {
  return {
    name: "fake",
    configured: true,
    ensureRoom: jest.fn(async () => ({ ok: true as const, value: { roomId: "room-1" } })),
    issueJoinToken: jest.fn(async () => ({
      ok: true as const,
      value: { roomId: "room-1", token: "t", expiresAt: "2026-10-16T12:02:00Z" },
    })),
    endRoom: jest.fn(async () => ({ ok: true as const, value: undefined })),
  };
}

function deps(over: Partial<IssueCallTokenDeps> = {}) {
  return {
    verifyUser: jest.fn(async () => USER_ID as string | null),
    consumeRateLimit: jest.fn(async () => ({ allowed: true, retry_after_seconds: 30 }) as unknown),
    getJoinContext: jest.fn(async () => ctx() as unknown),
    extendCoverage: jest.fn(
      async () => ({ ok: true, extended: true, exempt: false, covered_seconds_remaining: 85 }) as unknown,
    ),
    provider: provider(),
    logError: jest.fn(),
    ...over,
  };
}

async function run(d: IssueCallTokenDeps) {
  const res = await handleIssueCallToken(
    new Request("https://x.test/issue-call-token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer good.jwt-token" },
      body: JSON.stringify({ call_id: CALL_ID }),
    }),
    d,
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe("billing policy", () => {
  it("asks for an extension only for metered calls close to the end of their authorised time", () => {
    expect(evaluateJoinContext(ctx({ free_seconds_remaining: 45 }))).toMatchObject({ ok: true, value: { needsExtension: false } });
    expect(evaluateJoinContext(ctx({ free_seconds_remaining: 20 }))).toMatchObject({ ok: true, value: { needsExtension: true } });
    expect(evaluateJoinContext(ctx({ free_seconds_remaining: 3 }))).toMatchObject({ ok: true, value: { needsExtension: true } });
    expect(evaluateJoinContext(ctx({ free_seconds_remaining: null, billing_exempt: true }))).toMatchObject({
      ok: true,
      value: { needsExtension: false, ttlSeconds: 120 },
    });
    expect(evaluateJoinContext(ctx({ free_seconds_remaining: 3, billing_exempt: true }))).toMatchObject({
      ok: true,
      value: { needsExtension: false },
    });
  });

  it("fails closed on a malformed lead time", () => {
    for (const lead of ["20", 0, 51, NaN]) {
      expect(evaluateJoinContext(ctx({ extension_lead_seconds: lead }))).toMatchObject({ ok: false, error: { status: 500 } });
    }
  });

  it("parses extension results strictly", () => {
    expect(parseExtensionResult({ ok: true, covered_seconds_remaining: 80 })).toEqual({ ok: true, value: { coveredSeconds: 80 } });
    expect(parseExtensionResult({ ok: true, exempt: true, covered_seconds_remaining: null })).toEqual({ ok: true, value: { coveredSeconds: null } });
    expect(parseExtensionResult({ ok: false, code: "insufficient_coins" })).toMatchObject({ ok: false, error: { status: 402, code: "insufficient_coins" } });
    expect(parseExtensionResult({ ok: false, code: "call_expired" })).toMatchObject({ ok: false, error: { status: 410 } });
    expect(parseExtensionResult({ ok: false, code: "call_not_active" })).toMatchObject({ ok: false, error: { status: 410 } });
    expect(parseExtensionResult({ ok: false, code: "call_not_allowed" })).toMatchObject({ ok: false, error: { status: 403 } });
    expect(parseExtensionResult({ ok: false, code: "call_not_found" })).toMatchObject({ ok: false, error: { status: 404 } });
    for (const bad of [null, "x", {}, { ok: false }, { ok: true }, { ok: true, covered_seconds_remaining: 0 }, { ok: true, covered_seconds_remaining: "9" }, { ok: false, code: "weird" }]) {
      expect(parseExtensionResult(bad)).toMatchObject({ ok: false, error: { status: 500 } });
    }
  });
});

describe("issue-call-token billing flow", () => {
  it("does not bill when plenty of authorised time remains", async () => {
    const d = deps();
    const r = await run(d);
    expect(r.status).toBe(200);
    expect(d.extendCoverage).not.toHaveBeenCalled();
    expect(d.provider.issueJoinToken).toHaveBeenCalledWith(expect.objectContaining({ ttlSeconds: 45 }));
  });

  it("buys the next minute with the VERIFIED user id and bounds the token by the covered time", async () => {
    const d = deps({ getJoinContext: jest.fn(async () => ctx({ free_seconds_remaining: 10 })) });
    const r = await run(d);
    expect(r.status).toBe(200);
    expect(d.extendCoverage).toHaveBeenCalledWith(CALL_ID, USER_ID);
    expect(d.provider.issueJoinToken).toHaveBeenCalledWith(expect.objectContaining({ ttlSeconds: 85 }));
  });

  it("no coins: no extension is bought, but the token still covers the time already authorised (never more)", async () => {
    const d = deps({
      getJoinContext: jest.fn(async () => ctx({ free_seconds_remaining: 10 })),
      extendCoverage: jest.fn(async () => ({ ok: false, code: "insufficient_coins", covered_seconds_remaining: 10 })),
    });
    const r = await run(d);
    expect(r.status).toBe(200);
    expect(d.provider.issueJoinToken).toHaveBeenCalledWith(expect.objectContaining({ ttlSeconds: 10 }));
  });

  it("no time left at all: 410, no token", async () => {
    const d = deps({ getJoinContext: jest.fn(async () => ctx({ free_seconds_remaining: 0 })) });
    const r = await run(d);
    expect(r.status).toBe(410);
    expect(d.provider.issueJoinToken).not.toHaveBeenCalled();
  });

  it("fails closed when billing throws or answers nonsense, without leaking details", async () => {
    for (const extend of [
      jest.fn(async () => {
        throw new Error("secret db detail");
      }),
      jest.fn(async () => "garbage" as unknown),
      jest.fn(async () => ({ ok: true }) as unknown),
    ]) {
      const d = deps({ getJoinContext: jest.fn(async () => ctx({ free_seconds_remaining: 10 })), extendCoverage: extend });
      const r = await run(d);
      expect(r.status).toBe(500);
      expect(JSON.stringify(r.body)).not.toContain("secret");
      expect(d.provider.issueJoinToken).not.toHaveBeenCalled();
    }
  });

  it("never bills when no provider is configured", async () => {
    const d = deps({
      getJoinContext: jest.fn(async () => ctx({ free_seconds_remaining: 10 })),
      provider: { ...provider(), configured: false },
    });
    const r = await run(d);
    expect(r.status).toBe(503);
    expect(d.extendCoverage).not.toHaveBeenCalled();
  });

  it("never bills when the provider cannot prepare a room", async () => {
    const p = provider();
    p.ensureRoom = jest.fn(async () => ({ ok: false as const, code: "provider_error" as const, message: "x" }));
    const d = deps({ getJoinContext: jest.fn(async () => ctx({ free_seconds_remaining: 10 })), provider: p });
    const r = await run(d);
    expect(r.status).toBe(502);
    expect(d.extendCoverage).not.toHaveBeenCalled();
  });

  it("never bills an exempt (premium) caller", async () => {
    const d = deps({
      getJoinContext: jest.fn(async () => ctx({ free_seconds_remaining: null, billing_exempt: true })),
    });
    const r = await run(d);
    expect(r.status).toBe(200);
    expect(d.extendCoverage).not.toHaveBeenCalled();
    expect(d.provider.issueJoinToken).toHaveBeenCalledWith(expect.objectContaining({ ttlSeconds: 120 }));
  });

  it("does not bill unauthenticated, rate-limited or unauthorised requests", async () => {
    const limited = deps({ consumeRateLimit: jest.fn(async () => ({ allowed: false, retry_after_seconds: 5 })) });
    expect((await run(limited)).status).toBe(429);
    const stranger = deps({ getJoinContext: jest.fn(async () => ({ found: false })) });
    expect((await run(stranger)).status).toBe(404);
    const anon = deps({ verifyUser: jest.fn(async () => null) });
    expect((await run(anon)).status).toBe(401);
    for (const d of [limited, stranger, anon]) expect(d.extendCoverage).not.toHaveBeenCalled();
  });

  it("maps a mid-call exemption (premium upgrade) to a full-length token", async () => {
    const d = deps({
      getJoinContext: jest.fn(async () => ctx({ free_seconds_remaining: 10 })),
      extendCoverage: jest.fn(async () => ({ ok: true, exempt: true, covered_seconds_remaining: null })),
    });
    const r = await run(d);
    expect(r.status).toBe(200);
    expect(d.provider.issueJoinToken).toHaveBeenCalledWith(expect.objectContaining({ ttlSeconds: 120 }));
  });
});
