import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { supabase, isSupabaseConfigured } from "./supabase";

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

export interface NotificationPreferences {
  matches: boolean;
  messages: boolean;
  likes: boolean;
}

export type PushRegistrationResult =
  | { status: "registered" | "disabled" | "permission_denied" | "unsupported" }
  | { status: "error"; error: string };

const STORAGE_KEY_NOTICES = "milo_notifications_inbox";
const PUSH_PERMISSION_PROMPT_KEY = "milo_push_permission_prompted";
const PUSH_TOKEN_KEY = (userId: string) => `milo_expo_push_token:${userId}`;

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  matches: true,
  messages: true,
  likes: true,
};

const INITIAL_NOTICES: NoticeItem[] = [
  {
    id: "notif_welcome_1",
    kind: "safety",
    title: "Welcome to Chahat",
    text: "Complete photo verification to unlock your verified badge and get more responses.",
    timeAgo: "Just now",
    timestamp: Date.now() - 3600000,
    read: false,
  },
];

const inboxKey = (userId: string) => `${STORAGE_KEY_NOTICES}:${userId}`;

function formatTimeAgo(timestamp: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

async function authenticatedUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Sign in to manage notification settings.");
  return data.user.id;
}

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  const userId = await authenticatedUserId();
  const { data, error } = await supabase
    .from("notification_preferences")
    .select("matches, messages, likes")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Could not load notification preferences: ${error.message}`);
  return { ...DEFAULT_PREFERENCES, ...(data ?? {}) };
}

export async function saveNotificationPreferences(
  prefs: NotificationPreferences,
): Promise<{ success: boolean; error?: string }> {
  try {
    const userId = await authenticatedUserId();
    const { error } = await supabase.from("notification_preferences").upsert({
      user_id: userId,
      matches: prefs.matches,
      messages: prefs.messages,
      likes: prefs.likes,
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

export async function fetchNotificationInbox(): Promise<NoticeItem[]> {
  const userId = await authenticatedUserId();
  const key = inboxKey(userId);
  const raw = await AsyncStorage.getItem(key);
  if (!raw) {
    await AsyncStorage.setItem(key, JSON.stringify(INITIAL_NOTICES));
    return INITIAL_NOTICES;
  }
  try {
    const parsed: NoticeItem[] = JSON.parse(raw);
    return parsed.map((item) => ({ ...item, timeAgo: formatTimeAgo(item.timestamp) }));
  } catch (err) {
    console.warn("Could not parse notification inbox:", err);
    return [];
  }
}

export async function pushNotificationToInbox(
  notice: Omit<NoticeItem, "id" | "timeAgo" | "timestamp" | "read">,
): Promise<NoticeItem | null> {
  try {
    const userId = await authenticatedUserId();
    const prefs = await getNotificationPreferences();
    if (notice.kind === "match" && !prefs.matches) return null;
    if (notice.kind === "message" && !prefs.messages) return null;
    if (notice.kind === "like" && !prefs.likes) return null;

    const key = inboxKey(userId);
    const current = await fetchNotificationInbox();
    const now = Date.now();
    const newItem: NoticeItem = {
      ...notice,
      id: `notif_${now}_${Math.random().toString(36).substring(7)}`,
      timestamp: now,
      timeAgo: "Just now",
      read: false,
    };
    await AsyncStorage.setItem(key, JSON.stringify([newItem, ...current].slice(0, 50)));
    return newItem;
  } catch (err) {
    console.warn("Could not append notification:", err);
    return null;
  }
}

export async function markNotificationRead(id: string): Promise<void> {
  const userId = await authenticatedUserId();
  const key = inboxKey(userId);
  const current = await fetchNotificationInbox();
  await AsyncStorage.setItem(
    key,
    JSON.stringify(
      current.map((notice) => (notice.id === id ? { ...notice, read: true } : notice)),
    ),
  );
}

export async function markAllNotificationsRead(): Promise<void> {
  const userId = await authenticatedUserId();
  const key = inboxKey(userId);
  const current = await fetchNotificationInbox();
  await AsyncStorage.setItem(
    key,
    JSON.stringify(current.map((notice) => ({ ...notice, read: true }))),
  );
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
    if (!userId) return { status: "error", error: "A signed-in account is required." };
    if (Platform.OS === "web" || (Platform.OS !== "ios" && Platform.OS !== "android")) {
      return { status: "unsupported" };
    }
    if (!Device.isDevice) return { status: "unsupported" };
    if (!isSupabaseConfigured()) {
      return {
        status: "error",
        error: "Push registration requires a configured Supabase project.",
      };
    }

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || authData.user?.id !== userId) {
      return { status: "error", error: "Push registration is limited to the signed-in account." };
    }

    const preferences = await getNotificationPreferences();
    if (!preferences.matches && !preferences.messages && !preferences.likes) {
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

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) {
      return { status: "error", error: "Expo EAS project ID is missing from app configuration." };
    }

    const { data: tokenData } = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenData;
    if (!isExpoPushToken(token)) {
      return { status: "error", error: "Expo returned an invalid push token." };
    }
    const tokenKey = PUSH_TOKEN_KEY(userId);
    const previousToken = await SecureStore.getItemAsync(tokenKey);
    const { error } = await supabase.rpc("register_push_device", {
      _token: token,
      _platform: Platform.OS,
      _app_version: Application.nativeApplicationVersion ?? null,
      _previous_token: previousToken,
    });
    if (error)
      return { status: "error", error: `Could not register this device: ${error.message}` };

    await SecureStore.setItemAsync(tokenKey, token);
    return { status: "registered" };
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error ? err.message : "Could not register push notifications.",
    };
  }
}

export async function unregisterPushNotificationToken(userId: string): Promise<void> {
  if (Platform.OS === "web" || !userId) return;
  const tokenKey = PUSH_TOKEN_KEY(userId);
  const token = await SecureStore.getItemAsync(tokenKey);
  if (!token) return;
  const { error } = await supabase.rpc("unregister_push_device", { _token: token });
  if (error) throw new Error(`Could not unregister this device: ${error.message}`);
  await SecureStore.deleteItemAsync(tokenKey);
}

export async function openNotificationSettings(): Promise<void> {
  const { Linking } = await import("react-native");
  await Linking.openSettings();
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});
