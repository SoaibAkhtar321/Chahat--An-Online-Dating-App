// Pure rules for the single "Your location" selection (Phase 5). No React Native imports.
// The server owns the state (get_my_location_selection); nothing here is persisted on the device.
import { SUPPORTED_CITIES, type CityInfo } from "../constants/cities";
import { distanceKm, isValidCoordinates, type Coordinates } from "./locationPolicy";

/** Must equal the server's tolerance in set_my_location_selection (city_mismatch above this). */
export const MAX_CITY_DISTANCE_KM = 150;

export type LocationMode = "manual" | "current";

export interface LocationSelection {
  mode: LocationMode;
  /** Canonical supported city, or null when the member has not chosen one (never defaulted). */
  city: string | null;
  hasLocation: boolean;
  stale: boolean;
  shareDistance: boolean;
}

/** Common alternative names, mapped to the supported city they refer to. */
const ALIASES: Record<string, string> = {
  bangalore: "Bengaluru",
  bengaluru: "Bengaluru",
  "bengaluru urban": "Bengaluru",
  bombay: "Mumbai",
  "mumbai suburban": "Mumbai",
  "new delhi": "Delhi",
  "delhi ncr": "Delhi",
  "central delhi": "Delhi",
  gurgaon: "Gurugram",
  calcutta: "Kolkata",
  madras: "Chennai",
  mysore: "Mysuru",
  mangalore: "Mangaluru",
  cochin: "Kochi",
  trivandrum: "Thiruvananthapuram",
  vizag: "Visakhapatnam",
  baroda: "Vadodara",
  panjim: "Panaji",
  poona: "Pune",
  benares: "Varanasi",
  banaras: "Varanasi",
};

export function normalizeCityName(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

const BY_KEY = new Map<string, CityInfo>(SUPPORTED_CITIES.map((c) => [normalizeCityName(c.name), c]));

/** Exact (case-insensitive) lookup of a supported city, including common aliases. */
export function findSupportedCity(value: string | null | undefined): CityInfo | null {
  const key = normalizeCityName(value);
  if (!key) return null;
  const direct = BY_KEY.get(key);
  if (direct) return direct;
  const alias = ALIASES[key];
  return alias ? (BY_KEY.get(normalizeCityName(alias)) ?? null) : null;
}

/** First candidate string (e.g. reverse-geocoder city, subregion, district) that names a supported city. */
export function matchCityFromCandidates(candidates: Array<string | null | undefined>): CityInfo | null {
  for (const candidate of candidates) {
    const hit = findSupportedCity(candidate);
    if (hit) return hit;
  }
  return null;
}

/** Nearest supported city to a point, or null when none is within `maxKm`. Never invents a city. */
export function nearestSupportedCity(point: Coordinates, maxKm: number = MAX_CITY_DISTANCE_KM): CityInfo | null {
  if (!isValidCoordinates(point)) return null;
  let best: CityInfo | null = null;
  let bestKm = Infinity;
  for (const city of SUPPORTED_CITIES) {
    const km = distanceKm(point, { latitude: city.latitude, longitude: city.longitude });
    if (km < bestKm) {
      best = city;
      bestKm = km;
    }
  }
  return best && bestKm <= maxKm ? best : null;
}

/** Case-insensitive search over supported cities: prefix matches first, then substring matches. */
export function searchCities(query: string, limit = 8): CityInfo[] {
  const q = normalizeCityName(query);
  if (!q) return [];
  // Typing an alternative name ("bang", "gurg") finds the supported city it refers to.
  const aliasTargets = Object.entries(ALIASES)
    .filter(([alias]) => alias.startsWith(q))
    .map(([, target]) => findSupportedCity(target))
    .filter((c): c is CityInfo => c !== null);
  const starts: CityInfo[] = [];
  const contains: CityInfo[] = [];
  for (const city of SUPPORTED_CITIES) {
    const name = normalizeCityName(city.name);
    if (name.startsWith(q)) starts.push(city);
    else if (name.includes(q)) contains.push(city);
  }
  const out = [...starts, ...aliasTargets, ...contains];
  return out.filter((c, i) => out.indexOf(c) === i).slice(0, limit);
}

/** Strict parse of get_my_location_selection(); malformed responses return null (the UI then shows an error). */
export function parseLocationSelection(data: unknown): LocationSelection | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.mode !== "manual" && d.mode !== "current") return null;
  const city = typeof d.city === "string" && findSupportedCity(d.city) ? (findSupportedCity(d.city) as CityInfo).name : null;
  return {
    mode: d.mode,
    city,
    hasLocation: d.has_location === true,
    stale: d.stale === true,
    shareDistance: d.share_distance !== false,
  };
}

/** "Selected city: Mumbai" / "No city selected yet". */
export function describeSelection(selection: LocationSelection | null): string {
  if (!selection || !selection.city) return "No city selected yet";
  return `Selected city: ${selection.city}`;
}

/** Which mode the UI highlights; stale device location is still "current" but flagged for refresh. */
export function describeMode(selection: LocationSelection | null): string {
  if (!selection || !selection.city) return "Choose how Chahat should find people near you.";
  if (selection.mode === "current") {
    return selection.stale
      ? "Using your current location. It is out of date, so tap Use my current location to refresh it."
      : "Using your current location (approximate, about 1 km).";
  }
  return "Using the city you selected. Distances are shown city to city, not exact.";
}
