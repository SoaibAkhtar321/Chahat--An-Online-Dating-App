import { AgoraCallProvider, createAgoraProviderFactory } from "../supabase/functions/_shared/agoraProvider";
import { resolveCallProvider } from "../supabase/functions/_shared/callProvider";

const CALL = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const HEX = "a".repeat(32);
const build = jest.fn(() => "tok");

describe("AgoraCallProvider", () => {
  const p = new AgoraCallProvider(HEX, HEX, build, () => 1_000_000);
  beforeEach(() => build.mockClear());

  it("derives the room from the call id and rejects non-uuids", async () => {
    expect(await p.ensureRoom({ callId: CALL, callType: "video" })).toEqual({ ok: true, value: { roomId: `call_${CALL}` } });
    expect((await p.ensureRoom({ callId: "x", callType: "video" })).ok).toBe(false);
  });
  it("caps ttl at 120s and binds token to channel + user", async () => {
    const r = await p.issueJoinToken({ roomId: `call_${CALL}`, participantId: USER, callType: "video", ttlSeconds: 9999 });
    expect(r).toEqual({ ok: true, value: { roomId: `call_${CALL}`, token: "tok", expiresAt: new Date(1_120_000).toISOString() } });
    expect(build).toHaveBeenCalledWith(expect.objectContaining({ channel: `call_${CALL}`, account: USER, ttlSeconds: 120 }));
  });
  it("rejects bad participant and surfaces builder failure generically", async () => {
    expect((await p.issueJoinToken({ roomId: `call_${CALL}`, participantId: "bob", callType: "audio", ttlSeconds: 30 })).ok).toBe(false);
    build.mockImplementationOnce(() => { throw new Error("secret detail"); });
    const r = await p.issueJoinToken({ roomId: `call_${CALL}`, participantId: USER, callType: "audio", ttlSeconds: 30 });
    expect(r).toEqual({ ok: false, code: "provider_error", message: "Token generation failed." });
  });
  it("endRoom is idempotent", async () => {
    expect((await p.endRoom()).ok).toBe(true);
    expect((await p.endRoom()).ok).toBe(true);
  });
  it("factory needs both credentials; resolve falls back to not-configured", () => {
    const f = createAgoraProviderFactory(build);
    expect(f({ AGORA_APP_ID: HEX })).toBeNull();
    expect(resolveCallProvider({ CALL_PROVIDER: "agora" }, { agora: f }).configured).toBe(false);
    expect(resolveCallProvider({ CALL_PROVIDER: "agora", AGORA_APP_ID: HEX, AGORA_APP_CERTIFICATE: HEX }, { agora: f }).name).toBe("agora");
  });
});
