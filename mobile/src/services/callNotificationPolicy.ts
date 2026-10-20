// Pure rules for the Android incoming-call notification (no React Native imports, unit tested).
// Names here must match supabase/functions/dispatch-push/policy.ts (channelId / categoryId).
import { isValidUUID } from "../utils/validation";

export const CALL_CHANNEL_ID = "calls";
export const CALL_CATEGORY_ID = "incoming_call";
export const CALL_ACTION_ANSWER = "answer";
export const CALL_ACTION_DECLINE = "decline";
/** expo-notifications' identifier for a plain tap on the notification body. */
export const NOTIFICATION_DEFAULT_ACTION = "expo.modules.notifications.actions.DEFAULT";

export type CallNotificationAction = "answer" | "decline" | "open";

export interface CallNotificationData {
  callId: string;
  matchId: string | null;
  callType: "video" | null;
}

/**
 * Validates the data of a call push. Nothing in it is trusted for authorization: the id is only used to
 * ask the server about the call, which re-checks the signed-in user. Returns null for anything that is
 * not a well-formed call notification.
 */
export function parseCallNotificationData(data: unknown): CallNotificationData | null {
  if (!data || typeof data !== "object") return null;
  const { category, callId, matchId, callType } = data as Record<string, unknown>;
  if (category !== "call" || typeof callId !== "string" || !isValidUUID(callId)) return null;
  return {
    callId: callId.toLowerCase(),
    matchId: typeof matchId === "string" && isValidUUID(matchId) ? matchId.toLowerCase() : null,
    callType: callType === "video" ? callType : null,
  };
}

/** Maps an expo-notifications action identifier to what the user did. Unknown actions are ignored. */
export function resolveCallNotificationAction(actionIdentifier: unknown): CallNotificationAction | null {
  if (actionIdentifier === CALL_ACTION_ANSWER) return "answer";
  if (actionIdentifier === CALL_ACTION_DECLINE) return "decline";
  if (actionIdentifier === NOTIFICATION_DEFAULT_ACTION) return "open";
  return null;
}

/**
 * Foreground presentation: a call push is never shown as a system notification while the app is open,
 * because the in-app incoming-call screen already rings (and a second sound would double-ring).
 */
export function isCallPushData(data: unknown): boolean {
  return parseCallNotificationData(data) !== null;
}
