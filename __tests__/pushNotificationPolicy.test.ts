import {
  buildPushPayload,
  isRetryableProviderStatus,
} from "../supabase/functions/dispatch-push/policy";

describe("server push payload policy", () => {
  it("never places message text or profile details in lock-screen copy", () => {
    const payload = buildPushPayload(
      "ExponentPushToken[12345678-1234-1234-1234-123456789abc]",
      "notification-id",
      "message",
      {
        matchId: "00000000-0000-0000-0000-000000000001",
        body: "private chat content",
        senderName: "Private profile",
      },
    );
    expect(payload.body).toBe("You received a new message.");
    expect(JSON.stringify(payload)).not.toContain("private chat content");
    expect(JSON.stringify(payload)).not.toContain("Private profile");
    expect(payload.data.matchId).toBe("00000000-0000-0000-0000-000000000001");
  });

  it("drops invalid deep-link identifiers from provider payloads", () => {
    const payload = buildPushPayload("token", "event", "match", {
      matchId: "not-a-uuid",
    });
    expect(payload.data).toEqual({ category: "match", notificationId: "event" });
  });

  it("retries provider rate limits and server failures but not ordinary client failures", () => {
    expect(isRetryableProviderStatus(429)).toBe(true);
    expect(isRetryableProviderStatus(503)).toBe(true);
    expect(isRetryableProviderStatus(400)).toBe(false);
  });
});
