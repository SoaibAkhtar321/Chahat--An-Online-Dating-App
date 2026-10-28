// The one place that changes where a member is located. Every change goes through the atomic
// set_my_location_selection RPC (mode + city + snapped coordinates in one transaction). City search runs on the
// server (search_cities over the city_centroids gazetteer) and, for "Use My Current Location", the server
// resolves the nearest place from the snapped position. Nothing is persisted on the device, no coordinates are
// logged, and no geocoder (platform or third party) is contacted.
import { supabase, isSupabaseConfigured } from "./supabase";
import { hasConsent } from "./consent";
import { acquireFreshFix, type PermissionPrecision } from "./gpsFix";
import { classifyServerError, describeServerError, type ServerLocationError } from "./locationPolicy";
import {
  parseCitySearchResults,
  parseLocationSelection,
  prepareSearchQuery,
  type CitySearchResult,
  type LocationSelection,
} from "./locationSelectionPolicy";

export type SelectionResult =
  | { status: "saved"; city: string; precision?: PermissionPrecision }
  | { status: "consent_required" }
  | { status: "permission_denied"; canAskAgain: boolean }
  | { status: "services_disabled" }
  | { status: "unsupported" }
  | { status: "mock_location" }
  | { status: "timeout" }
  | { status: "city_unresolved" }
  | { status: "rejected"; code: ServerLocationError; message: string }
  | { status: "error"; message: string };

export type CitySearchResponse =
  | { status: "ok"; results: CitySearchResult[] }
  | { status: "too_short" }
  | { status: "error"; message: string };

const SEARCH_LIMIT = 10;

export async function loadLocationSelection(): Promise<LocationSelection | null> {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await supabase.rpc("get_my_location_selection");
  if (error) return null;
  return parseLocationSelection(data);
}

/** Server-side search over every Indian city/town in the gazetteer. Returns names and states only. */
export async function searchCities(query: string): Promise<CitySearchResponse> {
  const q = prepareSearchQuery(query);
  if (!q) return { status: "too_short" };
  if (!isSupabaseConfigured()) return { status: "error", message: "City search needs a configured backend." };
  try {
    const { data, error } = await supabase.rpc("search_cities", { _query: q, _limit: SEARCH_LIMIT });
    if (error) return { status: "error", message: "Couldn't search cities right now. Check your connection and try again." };
    return { status: "ok", results: parseCitySearchResults(data) };
  } catch {
    return { status: "error", message: "Couldn't search cities right now. Check your connection and try again." };
  }
}

function rejected(message: string | undefined): SelectionResult {
  const code = classifyServerError(message);
  if (code === "no_city_nearby") return { status: "city_unresolved" };
  // Never include coordinates or raw provider output in messages.
  return { status: "rejected", code, message: describeServerError(code) };
}

/** Manual mode: a place chosen from search_cities results. The server validates it and clears stored coordinates. */
export async function selectCityManually(cityName: string): Promise<SelectionResult> {
  if (!isSupabaseConfigured()) return { status: "error", message: "Location needs a configured backend." };
  const name = (cityName ?? "").replace(/\s+/g, " ").trim();
  if (!name || name.length > 80) {
    return { status: "rejected", code: "unknown_city", message: describeServerError("unknown_city") };
  }
  const { data, error } = await supabase.rpc("set_my_location_selection", { _mode: "manual", _city: name });
  if (error) return rejected(error.message);
  const saved = (data as { city?: unknown } | null)?.city;
  return { status: "saved", city: typeof saved === "string" && saved ? saved : name };
}

/**
 * Current-location mode. Consent first, then permission (only because the member tapped the button), then a fresh
 * fix (see gpsFix.ts) and one atomic write; the server picks the nearest place. If nothing can be determined the
 * member is told so and nothing is saved; no city or coordinates are ever invented.
 */
export async function selectCurrentLocation(): Promise<SelectionResult> {
  if (!isSupabaseConfigured()) return { status: "error", message: "Location needs a configured backend." };
  if (!(await hasConsent("location_discovery"))) return { status: "consent_required" };

  const fix = await acquireFreshFix();
  switch (fix.status) {
    case "ok":
      break;
    case "unsupported":
    case "services_disabled":
    case "mock_location":
    case "timeout":
      return { status: fix.status };
    case "permission_denied":
      return { status: "permission_denied", canAskAgain: fix.canAskAgain };
    case "too_imprecise":
      return { status: "rejected", code: "location_too_imprecise", message: describeServerError("location_too_imprecise") };
    case "invalid":
      return { status: "rejected", code: "invalid_coordinates", message: describeServerError("invalid_coordinates") };
    default:
      return { status: "error", message: fix.message };
  }

  try {
    const { data, error } = await supabase.rpc("set_my_location_selection", {
      _mode: "current",
      _city: null,
      _latitude: fix.fix.latitude,
      _longitude: fix.fix.longitude,
      _accuracy_m: fix.fix.accuracyM,
    });
    if (error) return rejected(error.message);
    const city = (data as { city?: unknown } | null)?.city;
    if (typeof city !== "string" || !city) return { status: "city_unresolved" };
    return { status: "saved", city, precision: fix.fix.precision };
  } catch {
    return { status: "error", message: "We couldn't save your location. Check your connection and try again." };
  }
}

/** Whether the UI should offer "Try again" for this outcome. */
export function isRetryable(result: SelectionResult): boolean {
  return (
    result.status === "timeout" ||
    result.status === "error" ||
    (result.status === "permission_denied" && result.canAskAgain) ||
    (result.status === "rejected" && (result.code === "location_too_imprecise" || result.code === "unknown"))
  );
}

/** User-facing copy for every outcome (search remains available whatever happens). */
export function describeSelectionResult(result: SelectionResult): string {
  switch (result.status) {
    case "saved":
      return result.precision === "approximate"
        ? `Location set to ${result.city} (approximate location).`
        : `Location set to ${result.city}.`;
    case "consent_required":
      return "Location sharing is off. You can still search for your city below.";
    case "permission_denied":
      return result.canAskAgain
        ? "Location permission wasn't granted. Tap Try again, or search for your city below."
        : "Location permission is blocked. Open app settings to allow it, or search for your city below.";
    case "services_disabled":
      return "Location is switched off on this phone. Turn it on in settings, or search for your city below.";
    case "unsupported":
      return "Detecting your location is only available in the mobile app. Search for your city instead.";
    case "mock_location":
      return "Mock locations aren't allowed. Turn off any location-spoofing app, or search for your city.";
    case "timeout":
      return "We couldn't get a fresh location fix. Move near a window or outdoors and tap Try again, or search for your city.";
    case "city_unresolved":
      return "We couldn't match your location to a place in India. Search for your city below.";
    case "rejected":
      return result.message;
    default:
      return result.message || "Something went wrong while detecting your location. Search for your city below.";
  }
}
