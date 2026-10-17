export type NotificationCategory = "like" | "match" | "message" | "call";

export interface PushPayload {
  to: string;
  sound: "default";
  title: string;
  body: string;
  data: {
    category: NotificationCategory;
    matchId?: string;
    callId?: string;
    notificationId: string;
  };
  channelId: "default";
  priority: "high";
  ttl: number;
}

export function buildPushPayload(
  token: string,
  notificationId: string,
  category: NotificationCategory,
  routeData: Record<string, unknown>,
): PushPayload {
  const copy = {
    like: { title: "Someone likes you", body: "Open Chahat to see who." },
    match: { title: "It's a match!", body: "You have a new connection on Chahat." },
    message: { title: "New message", body: "You received a new message." },
    call: { title: "Incoming call", body: "Someone is calling you on Chahat." },
  }[category];
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const callId =
    category === "call" && typeof routeData.callId === "string" && UUID.test(routeData.callId)
      ? routeData.callId
      : undefined;

  const matchId =
    (category === "match" || category === "message" || category === "call") &&
    typeof routeData.matchId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(routeData.matchId)
      ? routeData.matchId
      : undefined;

  return {
    to: token,
    sound: "default",
    title: copy.title,
    body: copy.body,
    data: {
      category,
      ...(matchId ? { matchId } : {}),
      ...(callId ? { callId } : {}),
      notificationId,
    },
    channelId: "default",
    priority: "high",
    // A ringing push is worthless once the invitation expires (60 s), so the provider must drop it.
    ttl: category === "call" ? 60 : 60 * 60,
  };
}

export function isRetryableProviderStatus(status: number): boolean {
  return status === 429 || status >= 500;
}
