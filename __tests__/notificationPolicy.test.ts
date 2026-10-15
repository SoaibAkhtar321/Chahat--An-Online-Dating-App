import { resolveNotificationDestination } from "../mobile/src/services/notificationPolicy";

const match = {
  id: "00000000-0000-4000-8000-000000000001",
  user_a: "user-a",
  user_b: "user-b",
};

describe("notification destination authorization", () => {
  it("routes like notifications to the account's likes screen", () => {
    expect(resolveNotificationDestination("like", null, "user-a")).toEqual({
      kind: "likes",
    });
  });

  it("opens a chat only when the authenticated user belongs to the valid match", () => {
    expect(resolveNotificationDestination("message", match.id, "user-a", match)).toEqual({
      kind: "chat",
      matchId: match.id,
    });
    expect(resolveNotificationDestination("match", match.id, "stranger", match)).toBeNull();
  });

  it("rejects malformed, mismatched, or unsupported notification destinations", () => {
    expect(resolveNotificationDestination("message", "not-a-uuid", "user-a", match)).toBeNull();
    expect(resolveNotificationDestination("message", match.id, "user-a", null)).toBeNull();
    expect(resolveNotificationDestination("safety", match.id, "user-a", match)).toBeNull();
  });
});
