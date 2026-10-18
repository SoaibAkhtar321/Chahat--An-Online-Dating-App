import {
  resolveNotificationDestination,
  shouldPresentInForeground,
} from "../mobile/src/services/notificationPolicy";
import {
  clearActiveConversation,
  getActiveConversation,
  setActiveConversation,
} from "../mobile/src/services/activeConversation";

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

describe("foreground presentation", () => {
  const open = "00000000-0000-4000-8000-0000000000AA";
  const other = "00000000-0000-4000-8000-0000000000BB";

  it("suppresses message and match alerts for the conversation already on screen", () => {
    expect(shouldPresentInForeground({ category: "message", matchId: open }, open.toLowerCase())).toBe(false);
    expect(shouldPresentInForeground({ category: "match", matchId: open }, open)).toBe(false);
  });

  it("still presents other conversations, likes, and anything unparseable", () => {
    expect(shouldPresentInForeground({ category: "message", matchId: other }, open)).toBe(true);
    expect(shouldPresentInForeground({ category: "like" }, open)).toBe(true);
    expect(shouldPresentInForeground({ category: "message", matchId: open }, null)).toBe(true);
    expect(shouldPresentInForeground(undefined, open)).toBe(true);
    expect(shouldPresentInForeground("junk", open)).toBe(true);
  });

  it("tracks the active conversation and ignores a stale blur", () => {
    setActiveConversation(open);
    expect(getActiveConversation()).toBe(open.toLowerCase());
    setActiveConversation(other);
    clearActiveConversation(open);
    expect(getActiveConversation()).toBe(other.toLowerCase());
    clearActiveConversation(other);
    expect(getActiveConversation()).toBeNull();
    setActiveConversation("");
    expect(getActiveConversation()).toBeNull();
  });
});
