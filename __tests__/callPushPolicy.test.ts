import { buildPushPayload } from "../supabase/functions/dispatch-push/policy";

const CALL = "11111111-1111-4111-8111-111111111111";
const MATCH = "22222222-2222-4222-8222-222222222222";

describe("call push payload", () => {
  it("is short-lived and carries only ids, never provider data", () => {
    const p = buildPushPayload("ExponentPushToken[abc]", "n1", "call", {
      callId: CALL, matchId: MATCH, callType: "video", token: "secret", roomId: "r",
    });
    expect(p.ttl).toBe(60);
    expect(p.title).toBe("Incoming call");
    expect(p.data).toEqual({ category: "call", matchId: MATCH, callId: CALL, notificationId: "n1" });
    expect(JSON.stringify(p)).not.toMatch(/secret|roomId|callType/);
  });
  it("drops malformed ids instead of forwarding them", () => {
    const p = buildPushPayload("ExponentPushToken[abc]", "n1", "call", { callId: "x", matchId: "y" });
    expect(p.data).toEqual({ category: "call", notificationId: "n1" });
  });
  it("leaves other categories unchanged (1h ttl, no callId)", () => {
    const p = buildPushPayload("ExponentPushToken[abc]", "n1", "message", { matchId: MATCH, callId: CALL });
    expect(p.ttl).toBe(3600);
    expect(p.data).toEqual({ category: "message", matchId: MATCH, notificationId: "n1" });
  });
});
