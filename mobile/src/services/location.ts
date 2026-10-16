import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { supabase, isSupabaseConfigured } from "./supabase";
import {
  isValidCoordinates,
  isFreshLocation,
  classifyServerError,
  describeServerError,
  type ServerLocationError,
} from "./locationPolicy";

const PERMISSION_ATTEMPT_KEY = "milo_location_permission_attempted";
const LOCATION_TIMEOUT_MS = 12_000;

export type LocationEnableResult =
  | { status: "enabled" }
  | { status: "permission_denied" }
  | { status: "services_disabled" }
  | { status: "unsupported" }
  | { status: "mock_location" }
  | { status: "rejected"; code: ServerLocationError; message: string }
  | { status: "error"; message: string };

/** The OS-reported accuracy ceiling the server accepts (see set_my_discovery_location). */
const MAX_ACCURACY_M = 5000;

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
        requiredAccuracy: MAX_ACCURACY_M,
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

    // Android only: refuse fixes from a mock-location provider (the server also guards against crude spoofing).
    if ((position as { mocked?: boolean }).mocked === true) return { status: "mock_location" };

    const accuracy = position.coords.accuracy;
    const { error } = await supabase.rpc("set_my_discovery_location", {
      _latitude: coordinates.latitude,
      _longitude: coordinates.longitude,
      _accuracy_m:
        typeof accuracy === "number" && Number.isFinite(accuracy) ? Math.max(0, Math.round(accuracy)) : null,
    });
    if (error) {
      const code = classifyServerError(error.message);
      // Never include coordinates or raw provider output in messages.
      return { status: "rejected", code, message: describeServerError(code) };
    }
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

export interface MyLocationStatus {
  hasLocation: boolean;
  stale: boolean;
  shareDistance: boolean;
}

export async function getMyLocationStatus(): Promise<MyLocationStatus | null> {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await supabase.rpc("get_my_location_status");
  if (error || !data) return null;
  const d = data as Record<string, unknown>;
  return {
    hasLocation: d.has_location === true,
    stale: d.stale === true,
    shareDistance: d.share_distance !== false,
  };
}

/** Whether other members may see an approximate distance to me. Stored server-side. */
export async function setDistanceSharing(share: boolean): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  const { error } = await supabase.rpc("set_distance_sharing", { _share: share });
  return !error;
}

/** Bucketed distance (km) to another member, or null when unknown / hidden / blocked. */
export async function getDistanceTo(profileId: string): Promise<number | null> {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await supabase.rpc("get_distance_to", { _id: profileId });
  if (error || typeof data !== "number") return null;
  return data;
}

/** User-facing copy for non-success results (single source of truth for all screens). */
export function describeLocationResult(result: LocationEnableResult): string {
  switch (result.status) {
    case "enabled":
      return "Location updated.";
    case "permission_denied":
      return "Location permission was not granted. Enable it in system settings to see people near you.";
    case "services_disabled":
      return "Location services are switched off on this device. Turn them on and try again.";
    case "unsupported":
      return "Nearby discovery is only available in the mobile app.";
    case "mock_location":
      return "Mock locations are not allowed. Turn off any location-spoofing app and try again.";
    case "rejected":
      return result.message;
    default:
      return result.message || "Something went wrong while updating your location. Please try again.";
  }
}
