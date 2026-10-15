export type NotificationCategory = "like" | "match" | "message";

export interface PushPayload {
  to: string;
  sound: "default";
  title: string;
  body: string;
  data: {
    category: NotificationCategory;
    matchId?: string;
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
  }[category];

  const matchId =
    (category === "match" || category === "message") &&
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
      notificationId,
    },
    channelId: "default",
    priority: "high",
    ttl: 60 * 60,
  };
}

export function isRetryableProviderStatus(status: number): boolean {
  return status === 429 || status >= 500;
}
