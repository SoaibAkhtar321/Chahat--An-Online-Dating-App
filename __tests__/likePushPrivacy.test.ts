import { buildPushPayload } from "../supabase/functions/dispatch-push/policy";

describe("like push payload privacy", () => {
  const uuid = "11111111-1111-4111-8111-111111111111";
  it("is generic and carries no liker identity, even if route data or display context try to add one", () => {
    const payload = buildPushPayload(
      "ExponentPushToken[x]",
      "n1",
      "like",
      { matchId: uuid, profileId: "liker-1", name: "Secret Liker", actor_id: "liker-1" },
      { senderName: "Secret Liker", preview: "hi there" },
    );
    const json = JSON.stringify(payload);
    expect(payload.title).toBe("Someone likes you");
    expect(json).not.toMatch(/Secret Liker|liker-1|hi there/);
    expect(payload.data).toEqual({ category: "like", notificationId: "n1" });
    expect(payload.data.matchId).toBeUndefined();
  });
});
