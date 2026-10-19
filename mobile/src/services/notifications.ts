import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { isServiceConfigured } from "../config/appConfig";
import { supabase, isSupabaseConfigured } from "./supabase";
import { hasConsent } from "./consent";
import { getActiveConversation } from "./activeConversation";
import { shouldPresentInForeground } from "./notificationPolicy";

export interface NoticeItem {
  id: string;
  kind: "match" | "message" | "like" | "safety";
  title?: string;
  text: string;
  timeAgo: string;
  timestamp: number;
  read: boolean;
  data?: {
    matchId?: string;
    senderId?: string;
    profileId?: string;
  };
}

export type LockScreenDetails = "none" | "name" | "preview";

export interface NotificationPreferences {
  matches: boolean;
  messages: boolean;
  likes: boolean;
  calls: boolean;
  /** What a lock screen may show for matches/messages: nothing, the sender's first name, or a preview. */
  lockScreenDetails: LockScreenDetails;
}

export type PushRegistrationResult =
  | {
      status:
        | "registered"
        | "disabled"
        | "consent_required"
        | "permission_denied"
        | "unsupported"
        | "not_configured";
    }
  | { status: "error"; error: string };

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  matches: true,
  messages: true,
  likes: true,
  calls: true,
  lockScreenDetails: "name",
};

const LOCK_SCREEN_DETAILS: readonly LockScreenDetails[] = ["none", "name", "preview"];

const LEGACY_STORAGE_KEY_NOTICES = "milo_notifications_inbox";
const LEGACY_STORAGE_KEY_PREFS = "milo_notification_prefs";
const LEGACY_STORAGE_KEY_FCM_TOKEN = "milo_fcm_push_token";
const PUSH_PERMISSION_PROMPT_KEY = "milo_push_permission_prompted";
const inboxKey = (userId: string) => `${LEGACY_STORAGE_KEY_NOTICES}:${userId}`;
const pushTokenKey = (userId: string) => `milo_expo_push_token:${userId}`;

function formatTimeAgo(timestamp: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

async function requireAuthenticatedUser(userId: string): Promise<void> {
  if (!userId) throw new Error("A signed-in user is required.");
  const { data, error } = await supabase.auth.getUser();
  if (error || data.user?.id !== userId) {
    throw new Error("Notification settings are limited to the signed-in account.");
  }
}

export async function getNotificationPreferences(userId: string): Promise<NotificationPreferences> {
  await requireAuthenticatedUser(userId);
  const { data, error } = await supabase
    .from("notification_preferences")
    .select("matches, messages, likes, calls, lock_screen_details")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Could not load notification preferences: ${error.message}`);
  const row = data as {
    matches?: boolean;
    messages?: boolean;
    likes?: boolean;
    calls?: boolean;
    lock_screen_details?: string;
  } | null;
  return {
    matches: row?.matches ?? DEFAULT_PREFERENCES.matches,
    messages: row?.messages ?? DEFAULT_PREFERENCES.messages,
    likes: row?.likes ?? DEFAULT_PREFERENCES.likes,
    calls: row?.calls ?? DEFAULT_PREFERENCES.calls,
    lockScreenDetails: LOCK_SCREEN_DETAILS.includes(row?.lock_screen_details as LockScreenDetails)
      ? (row?.lock_screen_details as LockScreenDetails)
      : DEFAULT_PREFERENCES.lockScreenDetails,
  };
}

export async function saveNotificationPreferences(
  userId: string,
  // lockScreenDetails and calls are optional so a partial update never overwrites them.
  prefs: Omit<NotificationPreferences, "lockScreenDetails" | "calls"> & {
    calls?: boolean;
    lockScreenDetails?: LockScreenDetails;
  },
): Promise<{ success: boolean; error?: string }> {
  if (
    typeof prefs.matches !== "boolean" ||
    typeof prefs.messages !== "boolean" ||
    typeof prefs.likes !== "boolean" ||
    (prefs.calls !== undefined && typeof prefs.calls !== "boolean") ||
    (prefs.lockScreenDetails !== undefined && !LOCK_SCREEN_DETAILS.includes(prefs.lockScreenDetails))
  ) {
    return { success: false, error: "Notification preferences are invalid." };
  }
  try {
    await requireAuthenticatedUser(userId);
    const { error } = await supabase.from("notification_preferences").upsert({
      user_id: userId,
      matches: prefs.matches,
      messages: prefs.messages,
      likes: prefs.likes,
      ...(prefs.calls !== undefined ? { calls: prefs.calls } : {}),
      ...(prefs.lockScreenDetails !== undefined
        ? { lock_screen_details: prefs.lockScreenDetails }
        : {}),
      updated_at: new Date().toISOString(),
    });
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Could not save notification preferences.",
    };
  }
}

export async function fetchNotificationInbox(userId: string): Promise<NoticeItem[]> {
  if (!userId) return [];
  try {
    const raw = await AsyncStorage.getItem(inboxKey(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("Notification inbox has an invalid format.");
    return (parsed as NoticeItem[]).map((item) => ({
      ...item,
      timeAgo: formatTimeAgo(item.timestamp),
    }));
  } catch (err) {
    console.warn("Could not fetch notification inbox:", err);
    return [];
  }
}

export async function pushNotificationToInbox(
  userId: string,
  notice: Omit<NoticeItem, "id" | "timeAgo" | "timestamp" | "read">,
): Promise<NoticeItem | null> {
  if (!userId) return null;
  try {
    const prefs = await getNotificationPreferences(userId);
    if (notice.kind === "match" && !prefs.matches) return null;
    if (notice.kind === "message" && !prefs.messages) return null;
    if (notice.kind === "like" && !prefs.likes) return null;

    const current = await fetchNotificationInbox(userId);
    const now = Date.now();
    const newItem: NoticeItem = {
      ...notice,
      id: `notif_${now}_${Math.random().toString(36).substring(7)}`,
      timestamp: now,
      timeAgo: "Just now",
      read: false,
    };
    await AsyncStorage.setItem(
      inboxKey(userId),
      JSON.stringify([newItem, ...current].slice(0, 50)),
    );
    return newItem;
  } catch (err) {
    console.warn("Could not append notification:", err);
    return null;
  }
}

export async function markNotificationRead(userId: string, id: string): Promise<void> {
  if (!userId) return;
  try {
    const current = await fetchNotificationInbox(userId);
    const updated = current.map((notice) =>
      notice.id === id ? { ...notice, read: true } : notice,
    );
    await AsyncStorage.setItem(inboxKey(userId), JSON.stringify(updated));
  } catch (err) {
    console.warn("Could not mark notification read:", err);
  }
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  if (!userId) return;
  try {
    const current = await fetchNotificationInbox(userId);
    await AsyncStorage.setItem(
      inboxKey(userId),
      JSON.stringify(current.map((notice) => ({ ...notice, read: true }))),
    );
  } catch (err) {
    console.warn("Could not mark all notifications read:", err);
  }
}

export function isExpoPushToken(token: string): boolean {
  return /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,256}\]$/.test(token);
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("default", {
    name: "Messages and connections",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#D94F70",
  });
}

export async function registerPushNotificationToken(
  userId: string,
): Promise<PushRegistrationResult> {
  try {
    // Push stays OFF until EXPO_PUBLIC_FEATURE_PUSH=true (set after FCM/EAS credentials and the
    // dispatch worker are attached; see docs/PUSH_SETUP.md). No permission prompt, no RPC.
    if (!isServiceConfigured("push")) return { status: "not_configured" };
    if (!userId) return { status: "error", error: "A signed-in account is required." };
    if (Platform.OS !== "ios" && Platform.OS !== "android") {
      return { status: "unsupported" };
    }
    if (!Device.isDevice) return { status: "unsupported" };
    if (!isSupabaseConfigured()) {
      return { status: "error", error: "Push registration requires a configured backend." };
    }

    await requireAuthenticatedUser(userId);
    // Purpose-specific consent comes first: no OS permission prompt and no token until the user has agreed to the
    // in-app notice (the server also refuses to activate a push token without it).
    if (!(await hasConsent("push_notifications"))) return { status: "consent_required" };
    const preferences = await getNotificationPreferences(userId);
    if (!preferences.matches && !preferences.messages && !preferences.likes && !preferences.calls) {
      return { status: "disabled" };
    }

    await ensureAndroidChannel();
    let permissions = await Notifications.getPermissionsAsync();
    if (!permissions.granted) {
      const prompted = await SecureStore.getItemAsync(PUSH_PERMISSION_PROMPT_KEY);
      if (!prompted && permissions.canAskAgain) {
        await SecureStore.setItemAsync(PUSH_PERMISSION_PROMPT_KEY, "1");
        permissions = await Notifications.requestPermissionsAsync();
      }
    }
    if (!permissions.granted) return { status: "permission_denied" };

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) {
      return { status: "error", error: "Expo EAS project ID is missing from app configuration." };
    }

    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    if (!isExpoPushToken(token)) {
      return { status: "error", error: "Expo returned an invalid push token." };
    }

    const key = pushTokenKey(userId);
    const previousToken = await SecureStore.getItemAsync(key);
    const { error } = await supabase.rpc("register_push_device", {
      _token: token,
      _platform: Platform.OS,
      _app_version: Application.nativeApplicationVersion ?? null,
      _previous_token: previousToken && previousToken !== token ? previousToken : null,
    });
    if (error)
      return { status: "error", error: `Could not register this device: ${error.message}` };

    try {
      await SecureStore.setItemAsync(key, token);
    } catch (storageError) {
      const rollback = isExpoPushToken(previousToken ?? "")
        ? await supabase.rpc("register_push_device", {
            _token: previousToken,
            _platform: Platform.OS,
            _app_version: Application.nativeApplicationVersion ?? null,
            _previous_token: token,
          })
        : await supabase.rpc("unregister_push_device", { _token: token });
      const rollbackError = rollback.error;
      if (rollbackError) {
        console.error(
          "Could not roll back push registration after secure storage failed:",
          rollbackError,
        );
      }
      throw storageError;
    }
    return { status: "registered" };
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error ? err.message : "Could not register push notifications.",
    };
  }
}

export async function unregisterPushNotificationToken(
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  if (!userId) return { success: false, error: "A signed-in user is required." };
  try {
    const token = await SecureStore.getItemAsync(pushTokenKey(userId));
    if (!token) return { success: true };
    await requireAuthenticatedUser(userId);
    const { error } = await supabase.rpc("unregister_push_device", { _token: token });
    if (error) throw new Error(`Could not unregister this device: ${error.message}`);
    await SecureStore.deleteItemAsync(pushTokenKey(userId));
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Could not unregister push notifications.",
    };
  }
}

export async function clearNotificationState(
  userId?: string,
  clearPushToken = false,
): Promise<void> {
  const keys = [LEGACY_STORAGE_KEY_NOTICES, LEGACY_STORAGE_KEY_PREFS, LEGACY_STORAGE_KEY_FCM_TOKEN];
  if (userId) keys.push(inboxKey(userId));
  await AsyncStorage.multiRemove(keys);
  if (clearPushToken && userId) {
    await Promise.all([
      SecureStore.deleteItemAsync(pushTokenKey(userId)),
      SecureStore.deleteItemAsync(`chahat_expo_push_token:${userId}`),
    ]);
  }
}

export async function openNotificationSettings(): Promise<void> {
  const { Linking } = await import("react-native");
  await Linking.openSettings();
}

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const present = shouldPresentInForeground(
      notification.request.content.data,
      getActiveConversation(),
    );
    return { shouldShowAlert: present, shouldPlaySound: present, shouldSetBadge: false };
  },
});
