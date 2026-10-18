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

  describe("authorised lock-screen details", () => {
    const TOKEN = "ExponentPushToken[12345678-1234-1234-1234-123456789abc]";
    const MATCH = { matchId: "00000000-0000-0000-0000-000000000001" };

    it("shows the sender first name and preview for messages when the database supplied them", () => {
      const payload = buildPushPayload(TOKEN, "n1", "message", MATCH, {
        senderName: "Aisha",
        preview: "see you at 7?",
      });
      expect(payload.title).toBe("Aisha");
      expect(payload.body).toBe("see you at 7?");
      expect(payload.data).toEqual({ category: "message", matchId: MATCH.matchId, notificationId: "n1" });
    });

    it("uses a neutral body when only the name is permitted", () => {
      const payload = buildPushPayload(TOKEN, "n1", "message", MATCH, { senderName: "Aisha" });
      expect(payload.title).toBe("Aisha");
      expect(payload.body).toBe("Sent you a message");
    });

    it("names the match partner only in the match body", () => {
      const payload = buildPushPayload(TOKEN, "n2", "match", MATCH, { senderName: "Aisha" });
      expect(payload.title).toBe("It's a match!");
      expect(payload.body).toBe("You and Aisha matched on Chahat.");
    });

    it("never identifies the sender of a like or a call, whatever the context says", () => {
      for (const category of ["like", "call"] as const) {
        const payload = buildPushPayload(TOKEN, "n3", category, MATCH, {
          senderName: "Aisha",
          preview: "secret",
        });
        expect(JSON.stringify(payload)).not.toContain("Aisha");
        expect(JSON.stringify(payload)).not.toContain("secret");
      }
      expect(buildPushPayload(TOKEN, "n3", "like", {}, { senderName: "Aisha" }).title).toBe(
        "Someone likes you",
      );
    });

    it("sanitises and bounds names and previews", () => {
      const payload = buildPushPayload(TOKEN, "n4", "message", MATCH, {
        senderName: "  Ai\nsha\u0007  ",
        preview: "x".repeat(500),
      });
      expect(payload.title).toBe("Ai sha");
      expect(Array.from(payload.body).length).toBeLessThanOrEqual(80);
      expect(payload.body.endsWith("…")).toBe(true);
    });

    it("falls back to generic copy for missing or blank context", () => {
      const payload = buildPushPayload(TOKEN, "n5", "message", MATCH, { senderName: "  ", preview: null });
      expect(payload.title).toBe("New message");
      expect(payload.body).toBe("You received a new message.");
    });
  });
});
