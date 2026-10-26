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
  CALL_RINGTONE_FILE,
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
    // A ~30 s ringtone bundled with the app (like a phone call), not the short default notification beep.
    sound: CALL_RINGTONE_FILE,
    audioAttributes: {
      usage: Notifications.AndroidAudioUsage.NOTIFICATION_RINGTONE,
      contentType: Notifications.AndroidAudioContentType.SONIFICATION,
    },
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

let ringSound: { stopAsync(): Promise<unknown>; unloadAsync(): Promise<unknown> } | null = null;
let ringToken = 0;

/**
 * In-app ring while the app is open: the bundled ringtone on a loop plus vibration, like a normal call.
 * Audio problems never throw; the vibration still runs.
 */
export function startInAppRing(): void {
  if (Platform.OS === "android") Vibration.vibrate(RING_PATTERN, true);
  const token = ++ringToken;
  void (async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Audio } = require("expo-av");
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, shouldDuckAndroid: false });
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const asset = require("../../assets/sounds/chahat_ringtone.wav");
      const { sound } = await Audio.Sound.createAsync(asset, { shouldPlay: true, isLooping: true, volume: 1 });
      if (token !== ringToken) {
        await sound.unloadAsync();
        return;
      }
      ringSound = sound;
    } catch {
      // No audio module (Expo Go / tests) or the file could not play: vibration only.
    }
  })();
}

export function stopInAppRing(): void {
  ringToken++;
  Vibration.cancel();
  const sound = ringSound;
  ringSound = null;
  if (sound) void sound.stopAsync().then(() => sound.unloadAsync()).catch(() => undefined);
}
