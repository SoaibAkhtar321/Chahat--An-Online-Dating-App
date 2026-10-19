// Android side effects for the incoming-call notification: the ringing channel, the Answer/Decline
// action buttons, clearing stale call notifications, and the in-app ring. Pure rules live in
// callNotificationPolicy.ts; orchestration lives in incomingCallController.ts.
import * as Notifications from "expo-notifications";
import { Platform, Vibration } from "react-native";
import {
  CALL_ACTION_ANSWER,
  CALL_ACTION_DECLINE,
  CALL_CATEGORY_ID,
  CALL_CHANNEL_ID,
  parseCallNotificationData,
} from "./callNotificationPolicy";

/**
 * Registers the high-importance "calls" channel and the Answer/Decline category. Safe to call repeatedly.
 * Needs no permission. It must run before the first call push arrives, so the app does it at sign-in.
 *
 * Answer opens the app (the call has to be joined by the app anyway). Decline does not: from a running
 * app it declines silently. If Android has killed the process, expo-notifications can only hand the tap
 * to JavaScript the next time the app starts, so a Decline from a dead process is best-effort and the
 * invitation otherwise expires on the server (docs/CALLS.md, "Android limits").
 */
export async function ensureCallNotificationSetup(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(CALL_CHANNEL_ID, {
    name: "Incoming calls",
    description: "Rings when someone you matched with calls you.",
    importance: Notifications.AndroidImportance.MAX,
    sound: "default",
    vibrationPattern: [0, 800, 600, 800, 600, 800],
    enableVibrate: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    bypassDnd: false,
    showBadge: false,
  });
  await Notifications.setNotificationCategoryAsync(CALL_CATEGORY_ID, [
    { identifier: CALL_ACTION_ANSWER, buttonTitle: "Answer", options: { opensAppToForeground: true } },
    {
      identifier: CALL_ACTION_DECLINE,
      buttonTitle: "Decline",
      options: { opensAppToForeground: false, isDestructive: true },
    },
  ]);
}

/** Dismisses presented call notifications: those for `callId`, or every call notification when omitted. */
export async function dismissCallNotifications(callId?: string): Promise<void> {
  if (Platform.OS !== "android") return;
  const presented = await Notifications.getPresentedNotificationsAsync();
  await Promise.all(
    presented
      .filter((notification) => {
        const data = parseCallNotificationData(notification.request.content.data);
        return data !== null && (!callId || data.callId === callId.toLowerCase());
      })
      .map((notification) => Notifications.dismissNotificationAsync(notification.request.identifier)),
  );
}

const RING_PATTERN = [0, 800, 600];

/** In-app ring while the app is open. Uses the vibrator only; the push channel provides the sound. */
export function startInAppRing(): void {
  if (Platform.OS === "android") Vibration.vibrate(RING_PATTERN, true);
}

export function stopInAppRing(): void {
  Vibration.cancel();
}
