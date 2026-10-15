import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { supabase, isSupabaseConfigured } from "./supabase";
import { isValidCoordinates, isFreshLocation } from "./locationPolicy";

const PERMISSION_ATTEMPT_KEY = "milo_location_permission_attempted";
const LOCATION_TIMEOUT_MS = 12_000;

export type LocationEnableResult =
  | { status: "enabled" }
  | { status: "permission_denied" }
  | { status: "services_disabled" }
  | { status: "unsupported" }
  | { status: "error"; message: string };

async function withinTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Location request timed out.")), LOCATION_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function enableLocationSharing(): Promise<LocationEnableResult> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return { status: "unsupported" };
  if (!isSupabaseConfigured()) {
    return { status: "error", message: "Location discovery requires a configured backend." };
  }

  try {
    let permission = await Location.getForegroundPermissionsAsync();
    if (permission.status !== "granted") {
      const attempted = await SecureStore.getItemAsync(PERMISSION_ATTEMPT_KEY);
      if (permission.canAskAgain && attempted !== "1") {
        await SecureStore.setItemAsync(PERMISSION_ATTEMPT_KEY, "1");
        permission = await Location.requestForegroundPermissionsAsync();
      }
    }
    if (permission.status !== "granted") return { status: "permission_denied" };
    if (!(await Location.hasServicesEnabledAsync())) return { status: "services_disabled" };

    let position: Location.LocationObject;
    try {
      position = await withinTimeout(
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      );
    } catch (error) {
      const cached = await Location.getLastKnownPositionAsync({
        maxAge: 72 * 60 * 60 * 1000,
        requiredAccuracy: 10_000,
      });
      if (!cached || !isFreshLocation(cached.timestamp)) throw error;
      position = cached;
    }

    const coordinates = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    };
    if (!isValidCoordinates(coordinates)) {
      return { status: "error", message: "The device returned invalid coordinates." };
    }

    const { error } = await supabase.rpc("set_my_discovery_location", {
      _latitude: coordinates.latitude,
      _longitude: coordinates.longitude,
    });
    if (error) return { status: "error", message: `Could not enable location discovery: ${error.message}` };
    return { status: "enabled" };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Could not determine your location.",
    };
  }
}

export async function disableLocationSharing(): Promise<void> {
  if (!isSupabaseConfigured()) throw new Error("Location discovery requires a configured backend.");
  const { error } = await supabase.rpc("clear_my_discovery_location");
  if (error) throw new Error(`Could not disable location discovery: ${error.message}`);
}

export async function isLocationSharingEnabled(): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  const { data, error } = await supabase.rpc("has_my_discovery_location");
  if (error) throw new Error(`Could not load location-sharing status: ${error.message}`);
  return data === true;
}
