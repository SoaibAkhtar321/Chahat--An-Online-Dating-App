import * as fs from "fs";
import * as path from "path";
import {
  MIN_SEARCH_LENGTH,
  describeMode,
  describeSearchResult,
  describeSelection,
  parseCitySearchResults,
  parseLocationSelection,
  prepareSearchQuery,
} from "../mobile/src/services/locationSelectionPolicy";
import { describeServerError, classifyServerError, formatDistanceLabel } from "../mobile/src/services/locationPolicy";

const migration = () =>
  fs.readFileSync(path.join(__dirname, "..", "supabase/migrations/20260101005700_dynamic_city_search.sql"), "utf8");

describe("server gazetteer (20260101005700)", () => {
  const sql = migration();
  const rows = [...sql.matchAll(/^ {2}\('([^']+)', '((?:[^']|'')+)', (-?[0-9.]+), (-?[0-9.]+), '((?:[^']|'')+)'\)/gm)].map(
    (m) => ({ key: m[1], name: m[2].replace(/''/g, "'"), latitude: Number(m[3]), longitude: Number(m[4]), state: m[5] }),
  );

  it("seeds thousands of Indian places, including the towns the old list missed", () => {
    expect(rows.length).toBeGreaterThan(4000);
    const names = new Set(rows.map((r) => r.name));
    for (const n of ["Greater Noida", "Kushinagar", "Gorakhpur, Uttar Pradesh", "Gorakhpur, Haryana"]) {
      expect(names.has(n)).toBe(true);
    }
    // Kolkata stays the curated row (not duplicated by the gazetteer)
    expect(names.has("Kolkata")).toBe(false);
    expect(sql).toMatch(/ON CONFLICT \(name_key\) DO NOTHING;\s+-- never overwrite curated rows/);
  });

  it("every row is a normalised, unique key inside India's bounding box", () => {
    const keys = new Set<string>();
    for (const r of rows) {
      expect(r.key).toBe(r.name.replace(/''/g, "'").replace(/\s+/g, " ").trim().toLowerCase());
      expect(keys.has(r.key)).toBe(false);
      keys.add(r.key);
      expect(r.latitude).toBeGreaterThan(6);
      expect(r.latitude).toBeLessThan(37.5);
      expect(r.longitude).toBeGreaterThan(68);
      expect(r.longitude).toBeLessThan(97.5);
    }
  });

  it("keeps the city_mismatch tolerance (150 km) and the existing RPC signature", () => {
    expect(sql).toMatch(/> 150 THEN\s+RAISE EXCEPTION 'city_mismatch'/);
    expect(sql).toMatch(
      /FUNCTION public\.set_my_location_selection\(\s*_mode text,\s*_city text,\s*_latitude double precision DEFAULT NULL,\s*_longitude double precision DEFAULT NULL,\s*_accuracy_m integer DEFAULT NULL\s*\)/,
    );
    expect(sql).not.toMatch(/CREATE TABLE[^;]*discovery_locations/i);
  });

  it("search_cities is authenticated-only and returns no coordinates", () => {
    expect(sql).toMatch(/RETURNS TABLE \(name text, state text\)/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.search_cities\(text, integer\) FROM PUBLIC, anon;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.search_cities\(text, integer\) TO authenticated;/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.nearest_city_centroid[\s\S]*FROM PUBLIC, anon, authenticated;/);
  });

  it("the feed gives manual (city-anchored) viewers city-to-city distances only", () => {
    expect(sql).toMatch(/CASE WHEN loc\.user_id IS NOT NULL AND _anchor_basis = 'device' THEN/);
  });
});

describe("search query and results", () => {
  it("does not search below the minimum length", () => {
    expect(MIN_SEARCH_LENGTH).toBe(2);
    expect(prepareSearchQuery("")).toBeNull();
    expect(prepareSearchQuery("  k ")).toBeNull();
    expect(prepareSearchQuery("  greater   noida ")).toBe("greater noida");
    expect(prepareSearchQuery("a".repeat(81))).toBeNull();
  });

  it("parses rows strictly, dropping malformed and duplicate entries", () => {
    expect(
      parseCitySearchResults([
        { name: "Kushinagar", state: "Uttar Pradesh" },
        { name: "kushinagar", state: "Uttar Pradesh" },
        { name: "", state: "X" },
        { name: 5 },
        null,
        { name: "Gorakhpur, Uttar Pradesh", state: "Uttar Pradesh", latitude: 26.7 },
      ]),
    ).toEqual([
      { name: "Kushinagar", state: "Uttar Pradesh" },
      { name: "Gorakhpur, Uttar Pradesh", state: "Uttar Pradesh" },
    ]);
    expect(parseCitySearchResults(null)).toEqual([]);
    expect(parseCitySearchResults({})).toEqual([]);
  });

  it("never carries coordinates through to the UI", () => {
    const [r] = parseCitySearchResults([{ name: "Greater Noida", state: "Uttar Pradesh", latitude: 28.49, longitude: 77.53 }]);
    expect(Object.keys(r).sort()).toEqual(["name", "state"]);
  });

  it("shows the state under a result unless the name already includes it", () => {
    expect(describeSearchResult({ name: "Kushinagar", state: "Uttar Pradesh" })).toBe("Uttar Pradesh");
    expect(describeSearchResult({ name: "Gorakhpur, Uttar Pradesh", state: "Uttar Pradesh" })).toBeNull();
    expect(describeSearchResult({ name: "Kolkata", state: null })).toBeNull();
  });
});

describe("selection parsing and copy", () => {
  it("parses any server-stored place (no client allow-list) and its state", () => {
    expect(
      parseLocationSelection({
        mode: "current",
        city: "Kushinagar",
        state: "Uttar Pradesh",
        has_location: true,
        stale: false,
        share_distance: true,
      }),
    ).toEqual({ mode: "current", city: "Kushinagar", state: "Uttar Pradesh", hasLocation: true, stale: false, shareDistance: true });
    expect(parseLocationSelection({ mode: "manual", city: null })?.city).toBeNull();
    expect(parseLocationSelection({ mode: "manual", city: "   " })?.city).toBeNull();
    expect(parseLocationSelection({ mode: "manual", city: "x".repeat(81) })?.city).toBeNull();
  });
  it("rejects malformed responses", () => {
    expect(parseLocationSelection(null)).toBeNull();
    expect(parseLocationSelection({ mode: "gps", city: "Pune" })).toBeNull();
    expect(parseLocationSelection("x")).toBeNull();
  });
  it("shows the selection at the top and never defaults to a city", () => {
    const base = { state: null, hasLocation: false, stale: false, shareDistance: true };
    expect(describeSelection(null)).toBe("No city selected yet");
    expect(describeSelection({ ...base, mode: "manual", city: null })).toBe("No city selected yet");
    expect(describeSelection({ ...base, mode: "manual", city: "Greater Noida" })).toBe("Selected city: Greater Noida");
  });
  it("makes the active mode and stale state clear", () => {
    const base = { city: "Kolkata", state: "West Bengal", hasLocation: true, shareDistance: true };
    expect(describeMode({ ...base, mode: "current", stale: false })).toMatch(/current location/i);
    expect(describeMode({ ...base, mode: "current", stale: true })).toMatch(/out of date/i);
    expect(describeMode({ ...base, mode: "manual", hasLocation: false, stale: false })).toMatch(/city to city/i);
  });
  it("has user-facing copy for the server errors", () => {
    expect(classifyServerError("unknown_city")).toBe("unknown_city");
    expect(classifyServerError("city_mismatch")).toBe("city_mismatch");
    expect(classifyServerError("ERROR: no_city_nearby")).toBe("no_city_nearby");
    expect(describeServerError("unknown_city")).toMatch(/search/i);
    expect(describeServerError("city_mismatch")).toMatch(/match/i);
    expect(describeServerError("no_city_nearby")).toMatch(/search/i);
  });
});

describe("distance labels never pretend to be exact and never show 0 km", () => {
  it("keeps the device wording and labels city-level distances as approximate", () => {
    expect(formatDistanceLabel(2)).toBe("Less than 2 km away");
    expect(formatDistanceLabel(12)).toBe("~12 km away");
    expect(formatDistanceLabel(120, "city")).toBe("About 120 km away (city to city)");
    expect(formatDistanceLabel(5, "city")).toBe("In your area");
  });
  it("missing or zero distance shows nothing (no fabricated '0 km')", () => {
    for (const basis of ["device", "city", null, undefined] as const) {
      expect(formatDistanceLabel(0, basis)).toBeNull();
      expect(formatDistanceLabel(-3, basis)).toBeNull();
      expect(formatDistanceLabel(null, basis)).toBeNull();
      expect(formatDistanceLabel(undefined, basis)).toBeNull();
      expect(formatDistanceLabel(NaN, basis)).toBeNull();
      expect(formatDistanceLabel("12" as unknown as number, basis)).toBeNull();
    }
  });
});
