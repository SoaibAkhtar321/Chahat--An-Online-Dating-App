import { supabase, isSupabaseConfigured } from "./supabase";
import { hasConsent } from "./consent";
import { acquireFreshFix } from "./gpsFix";
import { classifyServerError, describeServerError, type ServerLocationError } from "./locationPolicy";

export type LocationEnableResult =
  | { status: "enabled" }
  | { status: "consent_required" }
  | { status: "permission_denied" }
  | { status: "services_disabled" }
  | { status: "unsupported" }
  | { status: "mock_location" }
  | { status: "timeout" }
  | { status: "rejected"; code: ServerLocationError; message: string }
  | { status: "error"; message: string };

/**
 * Legacy coordinates-only update (the location UI uses locationSelection.selectCurrentLocation, which also sets
 * the city atomically). Shares the same fresh-fix logic, so it can no longer reuse a days-old cached position or
 * permanently stop asking for permission after the first dismissal.
 */
export async function enableLocationSharing(): Promise<LocationEnableResult> {
  if (!isSupabaseConfigured()) {
    return { status: "error", message: "Location discovery requires a configured backend." };
  }

  // Purpose-specific consent comes first: no OS permission prompt and no location read until the user has agreed to
  // the in-app notice (the server also refuses to store a location without it).
  if (!(await hasConsent("location_discovery"))) return { status: "consent_required" };

  const fix = await acquireFreshFix();
  switch (fix.status) {
    case "ok":
      break;
    case "permission_denied":
      return { status: "permission_denied" };
    case "unsupported":
    case "services_disabled":
    case "mock_location":
    case "timeout":
      return { status: fix.status };
    case "too_imprecise":
      return { status: "rejected", code: "location_too_imprecise", message: describeServerError("location_too_imprecise") };
    case "invalid":
      return { status: "error", message: "The device returned invalid coordinates." };
    default:
      return { status: "error", message: fix.message };
  }

  try {
    const { error } = await supabase.rpc("set_my_discovery_location", {
      _latitude: fix.fix.latitude,
      _longitude: fix.fix.longitude,
      _accuracy_m: fix.fix.accuracyM,
    });
    if (error) {
      const code = classifyServerError(error.message);
      // Never include coordinates or raw provider output in messages.
      return { status: "rejected", code, message: describeServerError(code) };
    }
    return { status: "enabled" };
  } catch {
    return { status: "error", message: "Could not determine your location." };
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
    case "consent_required":
      return "Location sharing is switched off. Turn it on in Settings > Discovery & Privacy to see people near you.";
    case "permission_denied":
      return "Location permission was not granted. Enable it in system settings to see people near you.";
    case "services_disabled":
      return "Location services are switched off on this device. Turn them on and try again.";
    case "unsupported":
      return "Nearby discovery is only available in the mobile app.";
    case "mock_location":
      return "Mock locations are not allowed. Turn off any location-spoofing app and try again.";
    case "timeout":
      return "We couldn't get a fresh location fix. Move near a window or outdoors and try again.";
    case "rejected":
      return result.message;
    default:
      return result.message || "Something went wrong while updating your location. Please try again.";
  }
}
