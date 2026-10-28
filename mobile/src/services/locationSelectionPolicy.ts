// Pure rules for the single "Your location" selection. No React Native imports.
// The server owns the state (get_my_location_selection) and the list of places (search_cities over the
// city_centroids gazetteer); there is no city list in the app and nothing here is persisted on the device.

export type LocationMode = "manual" | "current";

export interface LocationSelection {
  mode: LocationMode;
  /** The selected place exactly as the server stores it, or null when none is chosen (never defaulted). */
  city: string | null;
  /** State / union territory of the selected place, when known. */
  state: string | null;
  hasLocation: boolean;
  stale: boolean;
  shareDistance: boolean;
}

export interface CitySearchResult {
  /** Exact value to send back to set_my_location_selection, e.g. "Kushinagar" or "Gorakhpur, Uttar Pradesh". */
  name: string;
  state: string | null;
}

/** search_cities returns nothing below this; the client does not call it either. */
export const MIN_SEARCH_LENGTH = 2;
export const MAX_SEARCH_LENGTH = 80;

export function normalizeCityName(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Trimmed query, or null when it is too short / too long to search. */
export function prepareSearchQuery(query: string | null | undefined): string | null {
  const q = (query ?? "").replace(/\s+/g, " ").trim();
  if (q.length < MIN_SEARCH_LENGTH || q.length > MAX_SEARCH_LENGTH) return null;
  return q;
}

const cleanText = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max ? v.trim() : null;

/** Strict parse of search_cities rows. Anything malformed is dropped; duplicates are removed. */
export function parseCitySearchResults(data: unknown): CitySearchResult[] {
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  const out: CitySearchResult[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const name = cleanText(r.name, 80);
    if (!name) continue;
    const key = normalizeCityName(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, state: cleanText(r.state, 60) });
  }
  return out;
}

/** Second line under a search result: the state, unless the name already carries it ("Gorakhpur, Uttar Pradesh"). */
export function describeSearchResult(result: CitySearchResult): string | null {
  if (!result.state) return null;
  return normalizeCityName(result.name).endsWith(`, ${normalizeCityName(result.state)}`) ? null : result.state;
}

/** Strict parse of get_my_location_selection(); malformed responses return null (the UI then shows an error). */
export function parseLocationSelection(data: unknown): LocationSelection | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.mode !== "manual" && d.mode !== "current") return null;
  return {
    mode: d.mode,
    city: cleanText(d.city, 80),
    state: cleanText(d.state, 60),
    hasLocation: d.has_location === true,
    stale: d.stale === true,
    shareDistance: d.share_distance !== false,
  };
}

/** "Selected city: Kushinagar" / "No city selected yet". */
export function describeSelection(selection: LocationSelection | null): string {
  if (!selection || !selection.city) return "No city selected yet";
  return `Selected city: ${selection.city}`;
}

/** Which mode the UI highlights; stale device location is still "current" but flagged for refresh. */
export function describeMode(selection: LocationSelection | null): string {
  if (!selection || !selection.city) return "Choose how Chahat should find people near you.";
  if (selection.mode === "current") {
    return selection.stale
      ? "Using your current location. It is out of date, so tap Use My Current Location to refresh it."
      : "Using your current location (approximate, about 1 km).";
  }
  return "Using the city you selected. Distances are shown city to city, not exact.";
}
