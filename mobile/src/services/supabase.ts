import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Secure storage adapter for React Native mobile using hardware-backed SecureStore on device
const ExpoSecureStoreAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      if (Platform.OS === "web") {
        return await AsyncStorage.getItem(key);
      }
      return await SecureStore.getItemAsync(key);
    } catch (error) {
      console.error("Could not read persisted Supabase session:", error);
      throw error;
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    try {
      if (Platform.OS === "web") {
        await AsyncStorage.setItem(key, value);
      } else {
        await SecureStore.setItemAsync(key, value);
      }
    } catch (error) {
      console.error("Could not persist Supabase session:", error);
      throw error;
    }
  },
  removeItem: async (key: string): Promise<void> => {
    try {
      if (Platform.OS === "web") {
        await AsyncStorage.removeItem(key);
      } else {
        await SecureStore.deleteItemAsync(key);
      }
    } catch (error) {
      console.error("Could not clear persisted Supabase session:", error);
      throw error;
    }
  },
};

// Target configuration variables for Expo client
const rawUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() || "";
// Support EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY (standard) with fallback to EXPO_PUBLIC_SUPABASE_ANON_KEY
const rawKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
  "";

export function isSupabaseConfigured(): boolean {
  return Boolean(
    rawUrl &&
    rawKey &&
    !rawUrl.includes("placeholder") &&
    !rawUrl.includes("your-project") &&
    !rawKey.includes("placeholder") &&
    !rawKey.includes("your-supabase"),
  );
}

export function getConfigStatus(): { configured: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!rawUrl || rawUrl.includes("placeholder") || rawUrl.includes("your-project")) {
    missing.push("EXPO_PUBLIC_SUPABASE_URL");
  }
  if (!rawKey || rawKey.includes("placeholder") || rawKey.includes("your-supabase")) {
    missing.push("EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  }
  return {
    configured: missing.length === 0,
    missing,
  };
}

const supabaseUrl = isSupabaseConfigured() ? rawUrl : "https://placeholder-milo.supabase.co";
const supabaseKey = isSupabaseConfigured() ? rawKey : "placeholder-publishable-key";

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
