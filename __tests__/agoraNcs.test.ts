// Agora channel-event webhook: signature, parsing, idempotent hand-off, retry semantics.
// DB-side reconciliation rules are covered by supabase/tests/74_agora_channel_events.sql.
import { createHmac } from "crypto";
import { handleNcs, parseChannelEvent, verifyAgoraSignature } from "../supabase/functions/agora-ncs/policy";

const SECRET = "test-signing-secret-123";
const CALL = "5f0e8a52-6c1b-4e8e-9d2f-0a3b4c5d6e7f";
const USER = "11111111-1111-4111-8111-111111111111";
const event = (over: Record<string, unknown> = {}, payload: Record<string, unknown> = {}) =>
  JSON.stringify({
    noticeId: "n-1", productId: 1, eventType: 107, notifyMs: 1793160000000,
    payload: { channelName: `call_${CALL}`, uid: 12345, account: USER, clientSeq: 7, ts: 1793160000, platform: 1, ...payload },
    ...over,
  });
const sign = (body: string, alg: "sha256" | "sha1" = "sha256", secret = SECRET) =>
  createHmac(alg, secret).update(body).digest("hex");

describe("verifyAgoraSignature", () => {
  it("accepts a correct V2 (HMAC-SHA256, hex) signature", async () => {
    const body = event();
    expect(await verifyAgoraSignature(body, { v2: sign(body), v1: null }, SECRET)).toBe(true);
  });
  it("rejects a wrong secret, a tampered body, and a missing signature", async () => {
    const body = event();
    expect(await verifyAgoraSignature(body, { v2: sign(body, "sha256", "other-secret-xyz"), v1: null }, SECRET)).toBe(false);
    expect(await verifyAgoraSignature(body + " ", { v2: sign(body), v1: null }, SECRET)).toBe(false);
    expect(await verifyAgoraSignature(body, { v2: null, v1: null }, SECRET)).toBe(false);
  });
  it("requires V2 when present (a valid V1 cannot rescue a bad V2)", async () => {
    const body = event();
    expect(await verifyAgoraSignature(body, { v2: "00".repeat(32), v1: sign(body, "sha1") }, SECRET)).toBe(false);
    expect(await verifyAgoraSignature(body, { v2: null, v1: sign(body, "sha1") }, SECRET)).toBe(true);
  });
  it("never verifies with an empty/short secret", async () => {
    const body = event();
    expect(await verifyAgoraSignature(body, { v2: sign(body, "sha256", ""), v1: null }, "")).toBe(false);
  });
});

describe("parseChannelEvent", () => {
  it("parses communication-mode join (107) and leave (108)", () => {
    expect(parseChannelEvent(JSON.parse(event()))).toEqual({
      noticeId: "n-1", eventType: 107, channelName: `call_${CALL}`, account: USER, clientSeq: 7, tsSeconds: 1793160000,
    });
    expect(parseChannelEvent(JSON.parse(event({ eventType: 108 })))?.eventType).toBe(108);
  });
  it("ignores other products, event types, channels and missing fields", () => {
    expect(parseChannelEvent(JSON.parse(event({ productId: 3 })))).toBeNull();
    expect(parseChannelEvent(JSON.parse(event({ eventType: 101 })))).toBeNull();
    expect(parseChannelEvent(JSON.parse(event({}, { channelName: "lobby" })))).toBeNull();
    expect(parseChannelEvent(JSON.parse(event({}, { account: undefined })))).toBeNull();
    expect(parseChannelEvent(JSON.parse(event({}, { clientSeq: "7" })))).toBeNull();
    expect(parseChannelEvent(JSON.parse(event({ noticeId: "" })))).toBeNull();
    expect(parseChannelEvent([])).toBeNull();
  });
});

describe("handleNcs", () => {
  const headersFor = (body: string) => ({ v2: sign(body), v1: null });

  it("records a signed event and answers 200", async () => {
    const record = jest.fn().mockResolvedValue({ ok: true });
    const body = event();
    const res = await handleNcs(body, headersFor(body), { secret: SECRET, record });
    expect(res.status).toBe(200);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ noticeId: "n-1", eventType: 107 }));
  });
  it("401 and nothing recorded for an unsigned or forged request", async () => {
    const record = jest.fn();
    const body = event();
    expect((await handleNcs(body, { v2: null, v1: null }, { secret: SECRET, record })).status).toBe(401);
    expect((await handleNcs(body, { v2: sign(event({ eventType: 108 })), v1: null }, { secret: SECRET, record })).status).toBe(401);
    expect(record).not.toHaveBeenCalled();
  });
  it("503 when the secret is not configured (never accepts unauthenticated events)", async () => {
    const record = jest.fn();
    const body = event();
    expect((await handleNcs(body, headersFor(body), { secret: undefined, record })).status).toBe(503);
    expect(record).not.toHaveBeenCalled();
  });
  it("200 ignored for signed but irrelevant events (no retry storm)", async () => {
    const record = jest.fn();
    const body = event({ eventType: 101 });
    const res = await handleNcs(body, headersFor(body), { secret: SECRET, record });
    expect(res).toEqual({ status: 200, body: { ok: true, status: "ignored" } });
    expect(record).not.toHaveBeenCalled();
  });
  it("500 when the database write fails, so Agora retries", async () => {
    const body = event();
    expect((await handleNcs(body, headersFor(body), { secret: SECRET, record: jest.fn().mockResolvedValue({ ok: false }) })).status).toBe(500);
    expect((await handleNcs(body, headersFor(body), { secret: SECRET, record: jest.fn().mockRejectedValue(new Error("x")) })).status).toBe(500);
  });
  it("413 for oversized bodies, and never echoes the payload", async () => {
    const body = "x".repeat(20000);
    const res = await handleNcs(body, headersFor(body), { secret: SECRET, record: jest.fn() });
    expect(res.status).toBe(413);
    expect(JSON.stringify(res.body)).not.toContain(USER);
  });
});
