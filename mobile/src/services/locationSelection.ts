// Phase 5: the one place that changes where a member is located. Every change goes through the atomic
// set_my_location_selection RPC (mode + city + rounded coordinates in one transaction). Nothing here is
// persisted on the device, no coordinates are logged, and no paid or third-party geocoder is contacted:
// reverse geocoding uses the Android platform geocoder via expo-location, with a bundled nearest-city fallback.
import * as Location from "expo-location";
import { Platform } from "react-native";
import { supabase, isSupabaseConfigured } from "./supabase";
import { hasConsent } from "./consent";
import {
  classifyServerError,
  describeServerError,
  isFreshLocation,
  isValidCoordinates,
  type ServerLocationError,
} from "./locationPolicy";
import {
  findSupportedCity,
  matchCityFromCandidates,
  nearestSupportedCity,
  parseLocationSelection,
  type LocationSelection,
} from "./locationSelectionPolicy";

const LOCATION_TIMEOUT_MS = 12_000;
const GEOCODE_TIMEOUT_MS = 6_000;
const MAX_ACCURACY_M = 5000;

export type SelectionResult =
  | { status: "saved"; city: string }
  | { status: "consent_required" }
  | { status: "permission_denied"; canAskAgain: boolean }
  | { status: "services_disabled" }
  | { status: "unsupported" }
  | { status: "mock_location" }
  | { status: "city_unresolved" }
  | { status: "rejected"; code: ServerLocationError; message: string }
  | { status: "error"; message: string };

function withinTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** Rounds to 0.01 degrees (about 1 km), the same precision the server stores. */
function snap(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function loadLocationSelection(): Promise<LocationSelection | null> {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await supabase.rpc("get_my_location_selection");
  if (error) return null;
  return parseLocationSelection(data);
}

/** Manual mode: choose a supported city. Clears any stored coordinates on the server, atomically. */
export async function selectCityManually(cityName: string): Promise<SelectionResult> {
  if (!isSupabaseConfigured()) return { status: "error", message: "Location needs a configured backend." };
  const city = findSupportedCity(cityName);
  if (!city) {
    return { status: "rejected", code: "unknown_city", message: describeServerError("unknown_city") };
  }
  const { error } = await supabase.rpc("set_my_location_selection", { _mode: "manual", _city: city.name });
  if (error) {
    const code = classifyServerError(error.message);
    return { status: "rejected", code, message: describeServerError(code) };
  }
  return { status: "saved", city: city.name };
}

/** Resolve a supported city for a position: platform reverse geocoder first, then nearest bundled city. */
async function resolveCity(latitude: number, longitude: number): Promise<string | null> {
  try {
    // Only the ~1 km rounded position is handed to the OS geocoder.
    const places = await withinTimeout(
      Location.reverseGeocodeAsync({ latitude: snap(latitude), longitude: snap(longitude) }),
      GEOCODE_TIMEOUT_MS,
      "Reverse geocoding timed out.",
    );
    const candidates = (places ?? []).flatMap((p) => [p.city, p.subregion, p.district]);
    const hit = matchCityFromCandidates(candidates);
    if (hit) return hit.name;
  } catch {
    // Geocoder unavailable (no Google Play services, offline, timeout): use the bundled fallback below.
  }
  return nearestSupportedCity({ latitude, longitude })?.name ?? null;
}

/**
 * Current-location mode. Consent first, then permission (only because the member tapped the button),
 * then a fix, a supported city, and one atomic write. If no supported city can be determined the member is
 * told so and nothing is saved; no city or coordinates are ever invented.
 */
export async function selectCurrentLocation(): Promise<SelectionResult> {
  if (Platform.OS !== "android" && Platform.OS !== "ios") return { status: "unsupported" };
  if (!isSupabaseConfigured()) return { status: "error", message: "Location needs a configured backend." };
  if (!(await hasConsent("location_discovery"))) return { status: "consent_required" };

  try {
    let permission = await Location.getForegroundPermissionsAsync();
    if (permission.status !== "granted" && permission.canAskAgain) {
      permission = await Location.requestForegroundPermissionsAsync();
    }
    if (permission.status !== "granted") {
      return { status: "permission_denied", canAskAgain: permission.canAskAgain === true };
    }
    if (!(await Location.hasServicesEnabledAsync())) return { status: "services_disabled" };

    let position: Location.LocationObject;
    try {
      position = await withinTimeout(
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        LOCATION_TIMEOUT_MS,
        "Location request timed out.",
      );
    } catch (error) {
      const cached = await Location.getLastKnownPositionAsync({
        maxAge: 72 * 60 * 60 * 1000,
        requiredAccuracy: MAX_ACCURACY_M,
      });
      if (!cached || !isFreshLocation(cached.timestamp)) throw error;
      position = cached;
    }

    const coordinates = { latitude: position.coords.latitude, longitude: position.coords.longitude };
    if (!isValidCoordinates(coordinates)) {
      return { status: "error", message: "The device returned invalid coordinates." };
    }
    if ((position as { mocked?: boolean }).mocked === true) return { status: "mock_location" };

    const city = await resolveCity(coordinates.latitude, coordinates.longitude);
    if (!city) return { status: "city_unresolved" };

    const accuracy = position.coords.accuracy;
    const { error } = await supabase.rpc("set_my_location_selection", {
      _mode: "current",
      _city: city,
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
    return { status: "saved", city };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Could not determine your location.",
    };
  }
}

/** User-facing copy for every non-saved outcome (manual search always remains available). */
export function describeSelectionResult(result: SelectionResult): string {
  switch (result.status) {
    case "saved":
      return `Location set to ${result.city}.`;
    case "consent_required":
      return "Location sharing is off. You can still search for your city below.";
    case "permission_denied":
      return result.canAskAgain
        ? "Location permission wasn't granted. You can try again or search for your city below."
        : "Location permission is blocked. Open system settings to allow it, or search for your city below.";
    case "services_disabled":
      return "Location services are switched off on this device. Turn them on, or search for your city below.";
    case "unsupported":
      return "Detecting your location is only available in the mobile app. Search for your city instead.";
    case "mock_location":
      return "Mock locations aren't allowed. Turn off any location-spoofing app, or search for your city.";
    case "city_unresolved":
      return "We couldn't match your location to a supported city. Search for your city below.";
    case "rejected":
      return result.message;
    default:
      return result.message || "Something went wrong while detecting your location. Search for your city below.";
  }
}
