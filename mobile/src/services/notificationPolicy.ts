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
    (category !== "match" && category !== "message" && category !== "missed_call") ||
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

/**
 * Foreground presentation: stay quiet when the push is about the conversation that is already open
 * (the message or match is visible on screen). Everything else is presented normally.
 */
export function shouldPresentInForeground(data: unknown, activeMatchId: string | null): boolean {
  if (!data || typeof data !== "object") return true;
  const { category, matchId } = data as { category?: unknown; matchId?: unknown };
  // The in-app incoming-call screen already rings; a system notification and sound would double-ring.
  if (category === "call") return false;
  if (!activeMatchId) return true;
  if (
    (category === "message" || category === "match" || category === "missed_call") &&
    typeof matchId === "string" &&
    matchId.toLowerCase() === activeMatchId.toLowerCase()
  ) {
    return false;
  }
  return true;
}
