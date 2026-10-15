import { isValidUUID } from "../utils/validation";

export type NotificationDestination = { kind: "likes" } | { kind: "chat"; matchId: string };

export function resolveNotificationDestination(
  category: unknown,
  matchId: unknown,
  userId: string,
  match?: { id: string; user_a: string; user_b: string } | null,
): NotificationDestination | null {
  if (category === "like") return { kind: "likes" };
  if (
    (category !== "match" && category !== "message") ||
    typeof matchId !== "string" ||
    !isValidUUID(matchId) ||
    !match ||
    match.id !== matchId ||
    (match.user_a !== userId && match.user_b !== userId)
  ) {
    return null;
  }
  return { kind: "chat", matchId };
}
