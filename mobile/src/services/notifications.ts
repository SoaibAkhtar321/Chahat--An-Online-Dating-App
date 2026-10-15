// In-App & Remote Push Notification Service for Milo Native Android
// Manages device notification preferences, in-app notification inbox, and FCM token registration.

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import * as Application from "expo-application";
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

const LEGACY_STORAGE_KEY_NOTICES = "milo_notifications_inbox";
const LEGACY_STORAGE_KEY_PREFS = "milo_notification_prefs";
const LEGACY_STORAGE_KEY_FCM_TOKEN = "milo_fcm_push_token";
const noticesKey = (userId: string) => `chahat_notifications_inbox:${userId}`;
const preferencesKey = (userId: string) => `chahat_notification_prefs:${userId}`;
const pushTokenKey = (userId: string) => `chahat_expo_push_token:${userId}`;

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  matches: true,
  messages: true,
  likes: true,
};

/**
 * Loads notification preferences from local storage.
 */
export async function getNotificationPreferences(userId: string): Promise<NotificationPreferences> {
  if (!userId) throw new Error("A signed-in user is required to load notification preferences.");
  try {
    const raw = await AsyncStorage.getItem(preferencesKey(userId));
    if (!raw) return DEFAULT_PREFERENCES;
    return { ...DEFAULT_PREFERENCES, ...JSON.parse(raw) };
  } catch (err) {
    console.warn("Could not load notification preferences:", err);
    return DEFAULT_PREFERENCES;
  }
}

/**
 * Saves notification preferences.
 */
export async function saveNotificationPreferences(
  userId: string,
  prefs: NotificationPreferences,
): Promise<boolean> {
  if (!userId) return false;
  try {
    await AsyncStorage.setItem(preferencesKey(userId), JSON.stringify(prefs));
    return true;
  } catch (err) {
    console.warn("Could not save notification preferences:", err);
    return false;
  }
}

/**
 * Returns formatted time ago string from a timestamp.
 */
function formatTimeAgo(timestamp: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

/**
 * Retrieves the full notification inbox for the current device/user.
 */
export async function fetchNotificationInbox(userId: string): Promise<NoticeItem[]> {
  if (!userId) return [];
  try {
    const raw = await AsyncStorage.getItem(noticesKey(userId));
    if (!raw) return [];
    const parsed: NoticeItem[] = JSON.parse(raw);
    // Refresh timeAgo dynamically
    return parsed.map((item) => ({
      ...item,
      timeAgo: formatTimeAgo(item.timestamp),
    }));
  } catch (err) {
    console.warn("Could not fetch notification inbox:", err);
    return [];
  }
}

/**
 * Appends a new notification to the in-app inbox if user preferences permit it.
 */
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
    const newItem: NoticeItem = {
      ...notice,
      id: `notif_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      timestamp: Date.now(),
      timeAgo: "Just now",
      read: false,
    };

    const updated = [newItem, ...current].slice(0, 50); // Keep latest 50 notifications
    await AsyncStorage.setItem(noticesKey(userId), JSON.stringify(updated));
    return newItem;
  } catch (err) {
    console.warn("Could not append notification:", err);
    return null;
  }
}

/**
 * Marks a single notification as read.
 */
export async function markNotificationRead(userId: string, id: string): Promise<void> {
  if (!userId) return;
  try {
    const current = await fetchNotificationInbox(userId);
    const updated = current.map((n) => (n.id === id ? { ...n, read: true } : n));
    await AsyncStorage.setItem(noticesKey(userId), JSON.stringify(updated));
  } catch (err) {
    console.warn("Could not mark notification read:", err);
  }
}

/**
 * Marks all notifications in inbox as read.
 */
export async function markAllNotificationsRead(userId: string): Promise<void> {
  if (!userId) return;
  try {
    const current = await fetchNotificationInbox(userId);
    const updated = current.map((n) => ({ ...n, read: true }));
    await AsyncStorage.setItem(noticesKey(userId), JSON.stringify(updated));
  } catch (err) {
    console.warn("Could not mark all notifications read:", err);
  }
}

/**
 * Registers a real Expo push token with the backend. This deliberately does not
 * manufacture a token or claim success when native push registration is unavailable.
 */
export async function registerPushNotificationToken(
  userId: string,
  token: string,
): Promise<{ success: boolean; token?: string; error?: string }> {
  try {
    if (!userId || !token || !/^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,256}\]$/.test(token)) {
      return { success: false, error: "A valid Expo push token is required." };
    }
    if (Platform.OS !== "android" && Platform.OS !== "ios") {
      return { success: false, error: "Push registration is supported only on Android and iOS." };
    }
    if (!isSupabaseConfigured()) {
      return { success: false, error: "Backend connection is not configured." };
    }

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || authData.user?.id !== userId) {
      return { success: false, error: "The push token does not belong to the signed-in account." };
    }

    const key = pushTokenKey(userId);
    const previousToken = await SecureStore.getItemAsync(key);
    const { error } = await supabase.rpc("register_push_device", {
      _token: token,
      _platform: Platform.OS,
      _app_version: Application.nativeApplicationVersion ?? null,
      _previous_token: previousToken && previousToken !== token ? previousToken : null,
    });
    if (error) throw error;
    try {
      await SecureStore.setItemAsync(key, token);
    } catch (storageError) {
      const { error: rollbackError } = await supabase.rpc("unregister_push_device", {
        _token: token,
      });
      if (rollbackError) {
        console.error(
          "Could not roll back push registration after secure storage failed:",
          rollbackError,
        );
      }
      throw storageError;
    }

    return { success: true, token };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to register push token.";
    return { success: false, error: message };
  }
}

export async function unregisterPushNotificationToken(
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  if (!userId) return { success: false, error: "A signed-in user is required." };
  try {
    const token = await SecureStore.getItemAsync(pushTokenKey(userId));
    if (!token) return { success: true };
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || authData.user?.id !== userId) {
      return { success: false, error: "Cannot unregister a token for a different account." };
    }
    const { error } = await supabase.rpc("unregister_push_device", { _token: token });
    if (error) throw error;
    await SecureStore.deleteItemAsync(pushTokenKey(userId));
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to unregister push token.";
    return { success: false, error: message };
  }
}

export async function clearNotificationState(
  userId?: string,
  clearPushToken = false,
): Promise<void> {
  const keys = [LEGACY_STORAGE_KEY_NOTICES, LEGACY_STORAGE_KEY_PREFS, LEGACY_STORAGE_KEY_FCM_TOKEN];
  if (userId) keys.push(noticesKey(userId), preferencesKey(userId));
  await AsyncStorage.multiRemove(keys);
  if (clearPushToken && userId) {
    await SecureStore.deleteItemAsync(pushTokenKey(userId));
  }
}
