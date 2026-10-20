jest.mock("../mobile/src/services/supabase", () => ({
  isSupabaseConfigured: jest.fn().mockReturnValue(true),
  supabase: { functions: { invoke: jest.fn() } },
}));

import { requestCallToken } from "../mobile/src/services/callToken";

const okBody = {
  success: true,
  provider: "fake",
  room_id: "room-1",
  token: "join-token",
  expires_at: "2026-10-16T12:02:00Z",
  call_type: "video",
};

const httpError = (code: string | null) => ({
  context: { json: async () => (code ? { success: false, code } : Promise.reject(new Error("no body"))) },
});

describe("requestCallToken", () => {
  it("sends only the call id and returns the validated grant", async () => {
    const invoke = jest.fn(async () => ({ data: okBody, error: null }));
    await expect(requestCallToken("call-1", invoke)).resolves.toEqual({
      provider: "fake",
      roomId: "room-1",
      token: "join-token",
      expiresAt: "2026-10-16T12:02:00Z",
      callType: "video",
    });
    expect(invoke).toHaveBeenCalledWith("call-1");
  });

  it.each([
    ["unauthenticated", "unauthenticated"],
    ["rate_limited", "rate_limited"],
    ["provider_not_configured", "provider_not_configured"],
    ["provider_error", "provider_error"],
    ["call_not_found", "call_unavailable"],
    ["call_not_allowed", "call_unavailable"],
    ["call_not_accepted", "call_unavailable"],
    ["call_ended", "call_unavailable"],
    ["call_expired", "call_unavailable"],
    ["something_new", "provider_error"],
  ])("maps server code %s to %s", async (serverCode, expected) => {
    const invoke = jest.fn(async () => ({ data: null, error: httpError(serverCode) }));
    await expect(requestCallToken("call-1", invoke)).rejects.toMatchObject({ code: expected });
  });

  it("reports network failures when no server code is available", async () => {
    await expect(
      requestCallToken("call-1", jest.fn(async () => ({ data: null, error: httpError(null) }))),
    ).rejects.toMatchObject({ code: "network" });
    await expect(
      requestCallToken("call-1", jest.fn(async () => ({ data: null, error: new Error("offline") }))),
    ).rejects.toMatchObject({ code: "network" });
    await expect(
      requestCallToken("call-1", jest.fn(async () => {
        throw new Error("offline");
      })),
    ).rejects.toMatchObject({ code: "network" });
  });

  it("rejects malformed success responses instead of trusting them", async () => {
    for (const data of [
      null,
      {},
      { ...okBody, success: false },
      { ...okBody, token: "" },
      { ...okBody, token: 5 },
      { ...okBody, call_type: "screen" },
      { ...okBody, call_type: "audio" }, // voice-only calls are not supported
      { ...okBody, room_id: undefined },
    ]) {
      await expect(
        requestCallToken("call-1", jest.fn(async () => ({ data, error: null }))),
      ).rejects.toMatchObject({ code: "provider_error" });
    }
  });

  it("does not call the network when the backend or call id is missing", async () => {
    const invoke = jest.fn();
    await expect(requestCallToken("call-1", invoke, false)).rejects.toMatchObject({ code: "network" });
    await expect(requestCallToken("", invoke, true)).rejects.toMatchObject({ code: "call_unavailable" });
    expect(invoke).not.toHaveBeenCalled();
  });
});
