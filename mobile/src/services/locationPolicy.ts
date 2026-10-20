export interface Coordinates {
  latitude: number;
  longitude: number;
}

export function isValidCoordinates(value: Coordinates): boolean {
  return (
    Number.isFinite(value.latitude) &&
    Number.isFinite(value.longitude) &&
    value.latitude >= -90 &&
    value.latitude <= 90 &&
    value.longitude >= -180 &&
    value.longitude <= 180
  );
}

export function distanceKm(from: Coordinates, to: Coordinates): number {
  if (!isValidCoordinates(from) || !isValidCoordinates(to)) {
    throw new Error("Coordinates must be valid latitude and longitude values.");
  }
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(from.latitude)) *
      Math.cos(radians(to.latitude)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isFreshLocation(timestamp: number, now = Date.now()): boolean {
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= 72 * 60 * 60 * 1000;
}

export type ServerLocationError =
  | "rate_limited"
  | "implausible_movement"
  | "location_too_imprecise"
  | "invalid_coordinates"
  | "profile_required"
  | "consent_required"
  | "authentication_required"
  | "unknown_city"
  | "city_mismatch"
  | "unknown";

/** Maps a server error message from the location RPCs to a typed code (never echoes coordinates). */
export function classifyServerError(message: string | undefined | null): ServerLocationError {
  const m = (message ?? "").toLowerCase();
  if (m.includes("consent_required")) return "consent_required";
  if (m.includes("unknown_city")) return "unknown_city";
  if (m.includes("city_mismatch")) return "city_mismatch";
  if (m.includes("rate_limited")) return "rate_limited";
  if (m.includes("implausible_movement")) return "implausible_movement";
  if (m.includes("location_too_imprecise")) return "location_too_imprecise";
  if (m.includes("invalid coordinates")) return "invalid_coordinates";
  if (m.includes("active profile required")) return "profile_required";
  if (m.includes("authentication required")) return "authentication_required";
  return "unknown";
}

export function describeServerError(code: ServerLocationError): string {
  switch (code) {
    case "rate_limited":
      return "You've updated your location too often. Please try again in a while.";
    case "implausible_movement":
      return "That location change doesn't look right. Please try again later.";
    case "location_too_imprecise":
      return "Your device's location is too imprecise right now. Try again with a better signal.";
    case "invalid_coordinates":
      return "Your device returned an invalid location. Please try again.";
    case "consent_required":
      return "Location sharing is switched off. Turn it on in Settings > Discovery & Privacy to use it.";
    case "profile_required":
      return "Finish setting up your profile before sharing your location.";
    case "authentication_required":
      return "Please sign in again to update your location.";
    case "unknown_city":
      return "That city isn't supported yet. Pick one from the list.";
    case "city_mismatch":
      return "Your device location doesn't match that city. Choose the city you are in, or search for one.";
    default:
      return "We couldn't save your location. Please try again.";
  }
}

/**
 * Distance label shown to members. Values are already bucketed by the server; null means unknown, hidden by the
 * other member, or blocked, in which case no distance is shown.
 */
export function formatDistanceLabel(
  km: number | null | undefined,
  basis: "device" | "city" | null | undefined = "device",
): string | null {
  if (km == null || !Number.isFinite(km) || km < 0) return null;
  // City-level distances are measured between city centres, so they are never presented as exact.
  if (basis === "city") return km <= 5 ? "In your area" : `About ${Math.round(km)} km away (city to city)`;
  if (km <= 2) return "Less than 2 km away";
  return `~${Math.round(km)} km away`;
}
