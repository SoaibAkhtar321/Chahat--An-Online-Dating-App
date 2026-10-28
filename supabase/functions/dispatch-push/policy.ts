export type NotificationCategory = "like" | "match" | "message" | "call" | "missed_call";

export interface PushPayload {
  to: string;
  sound: "default";
  title: string;
  body: string;
  data: {
    category: NotificationCategory;
    matchId?: string;
    callId?: string;
    callType?: "audio" | "video";
    notificationId: string;
  };
  // Calls use their own high-importance channel and the Answer/Decline action category the app registers
  // (mobile/src/services/callNotificationPolicy.ts keeps these names in sync).
  channelId: "default" | "calls_ring";
  categoryId?: "incoming_call";
  priority: "high";
  ttl: number;
}

/**
 * Lock-screen details the database already authorised for this recipient
 * (get_push_display_context honours notification_preferences.lock_screen_details).
 * Never taken from route_data, and ignored for likes and calls so a sender can never be identified.
 */
export interface PushDisplayContext {
  senderName?: string | null;
  preview?: string | null;
}

const MAX_NAME = 20;
const MAX_PREVIEW = 80;

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : text;
}

export function buildPushPayload(
  token: string,
  notificationId: string,
  category: NotificationCategory,
  routeData: Record<string, unknown>,
  display: PushDisplayContext = {},
): PushPayload {
  const copy = {
    like: { title: "Someone likes you", body: "Open Chahat to see who." },
    match: { title: "It's a match!", body: "You have a new connection on Chahat." },
    message: { title: "New message", body: "You received a new message." },
    call: { title: "Incoming call", body: "Someone is calling you on Chahat." },
    // No caller name (same lock-screen rule as the ringing push); tapping opens the chat to call back.
    missed_call: { title: "Missed call", body: "You missed a call on Chahat. Tap to call back." },
  }[category];
  const name =
    category === "match" || category === "message" ? cleanText(display.senderName, MAX_NAME) : undefined;
  if (category === "match" && name) {
    copy.body = `You and ${name} matched on Chahat.`;
  }
  if (category === "message" && name) {
    copy.title = name;
    copy.body = cleanText(display.preview, MAX_PREVIEW) ?? "Sent you a message";
  }
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const callId =
    (category === "call" || category === "missed_call") && typeof routeData.callId === "string" && UUID.test(routeData.callId)
      ? routeData.callId
      : undefined;

  const matchId =
    (category === "match" || category === "message" || category === "call" || category === "missed_call") &&
    typeof routeData.matchId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(routeData.matchId)
      ? routeData.matchId
      : undefined;

  // Only the two known call types are ever forwarded; anything else is dropped, never echoed.
  const callType =
    (category === "call" || category === "missed_call") && (routeData.callType === "audio" || routeData.callType === "video")
      ? routeData.callType
      : undefined;
  if (category === "call" && callType) {
    copy.title = callType === "video" ? "Incoming video call" : "Incoming audio call";
  }
  if (category === "missed_call" && callType) {
    copy.title = callType === "video" ? "Missed video call" : "Missed audio call";
  }

  return {
    to: token,
    sound: "default",
    title: copy.title,
    body: copy.body,
    data: {
      category,
      ...(matchId ? { matchId } : {}),
      ...(callId ? { callId } : {}),
      ...(callType ? { callType } : {}),
      notificationId,
    },
    channelId: category === "call" ? "calls_ring" : "default",
    ...(category === "call" ? { categoryId: "incoming_call" as const } : {}),
    priority: "high",
    // A ringing push is worthless once the invitation expires (60 s), so the provider must drop it.
    ttl: category === "call" ? 60 : 60 * 60,
  };
}

export function isRetryableProviderStatus(status: number): boolean {
  return status === 429 || status >= 500;
}
