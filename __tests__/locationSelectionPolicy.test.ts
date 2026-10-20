import * as fs from "fs";
import * as path from "path";
import { POPULAR_CITIES, SUPPORTED_CITIES } from "../mobile/src/constants/cities";
import {
  MAX_CITY_DISTANCE_KM,
  describeMode,
  describeSelection,
  findSupportedCity,
  matchCityFromCandidates,
  nearestSupportedCity,
  parseLocationSelection,
  searchCities,
} from "../mobile/src/services/locationSelectionPolicy";
import { describeServerError, classifyServerError, formatDistanceLabel } from "../mobile/src/services/locationPolicy";

describe("bundled city list", () => {
  it("is identical to the server's city_centroids seed (same names, same coordinates)", () => {
    const sql = fs.readFileSync(
      path.join(__dirname, "..", "supabase/migrations/20260101004300_location_selection_and_city_anchor.sql"),
      "utf8",
    );
    const rows = [...sql.matchAll(/\('([^']+)', '([^']+)', (-?[0-9.]+), (-?[0-9.]+)\)/g)].map((m) => ({
      key: m[1],
      name: m[2],
      latitude: Number(m[3]),
      longitude: Number(m[4]),
    }));
    expect(rows.length).toBe(SUPPORTED_CITIES.length);
    for (const row of rows) {
      expect(row.key).toBe(row.name.toLowerCase());
      const city = SUPPORTED_CITIES.find((c) => c.name === row.name);
      expect(city).toBeDefined();
      expect(city).toMatchObject({ latitude: row.latitude, longitude: row.longitude });
    }
  });
  it("has unique names and every popular city is a supported city (chips use the same selection path)", () => {
    const names = SUPPORTED_CITIES.map((c) => c.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    for (const popular of POPULAR_CITIES) expect(findSupportedCity(popular)).not.toBeNull();
  });
  it("includes Mumbai and Pune so Pune-to-Mumbai (about 120 km) falls inside the default 150 km maximum radius", () => {
    expect(findSupportedCity("Mumbai")).not.toBeNull();
    expect(findSupportedCity("Pune")).not.toBeNull();
  });
});

describe("city lookup and search", () => {
  it("matches case-insensitively and through common aliases, never inventing cities", () => {
    expect(findSupportedCity("  pune ")?.name).toBe("Pune");
    expect(findSupportedCity("Bangalore")?.name).toBe("Bengaluru");
    expect(findSupportedCity("Gurgaon")?.name).toBe("Gurugram");
    expect(findSupportedCity("Atlantis")).toBeNull();
    expect(findSupportedCity("")).toBeNull();
    expect(findSupportedCity(null)).toBeNull();
  });
  it("searches prefix matches first, then substrings, with a limit", () => {
    expect(searchCities("pun")[0].name).toBe("Pune");
    expect(searchCities("mum").map((c) => c.name)).toContain("Mumbai");
    expect(searchCities("navi")[0].name).toBe("Navi Mumbai");
    expect(searchCities("bang")[0].name).toBe("Bengaluru");
    expect(searchCities("a", 3).length).toBeLessThanOrEqual(3);
    expect(searchCities("   ")).toEqual([]);
    expect(searchCities("zzzz")).toEqual([]);
  });
  it("takes the first reverse-geocoder candidate that names a supported city", () => {
    expect(matchCityFromCandidates([null, "Haveli", "Pune", "Mumbai"])?.name).toBe("Pune");
    expect(matchCityFromCandidates(["Nowhere", undefined])).toBeNull();
  });
});

describe("nearest-city fallback", () => {
  it("returns the nearest supported city within the server tolerance", () => {
    expect(nearestSupportedCity({ latitude: 18.55, longitude: 73.9 })?.name).toBe("Pune");
    expect(nearestSupportedCity({ latitude: 19.1, longitude: 72.9 })?.name).toBe("Mumbai");
  });
  it("returns null instead of fabricating a city when nothing is close enough or the input is invalid", () => {
    expect(nearestSupportedCity({ latitude: 0, longitude: 0 })).toBeNull();
    expect(nearestSupportedCity({ latitude: NaN, longitude: 73 })).toBeNull();
    expect(nearestSupportedCity({ latitude: 95, longitude: 73 })).toBeNull();
  });
  it("uses the same tolerance as the server (150 km)", () => {
    expect(MAX_CITY_DISTANCE_KM).toBe(150);
    const sql = fs.readFileSync(
      path.join(__dirname, "..", "supabase/migrations/20260101004300_location_selection_and_city_anchor.sql"),
      "utf8",
    );
    expect(sql).toMatch(/> 150 THEN\s+RAISE EXCEPTION 'city_mismatch'/);
  });
});

describe("selection parsing and copy", () => {
  it("parses a server selection and never trusts an unsupported city name", () => {
    expect(
      parseLocationSelection({ mode: "current", city: "Pune", has_location: true, stale: false, share_distance: true }),
    ).toEqual({ mode: "current", city: "Pune", hasLocation: true, stale: false, shareDistance: true });
    expect(parseLocationSelection({ mode: "manual", city: "Atlantis", has_location: false })?.city).toBeNull();
    expect(parseLocationSelection({ mode: "manual", city: null })?.city).toBeNull();
  });
  it("rejects malformed responses", () => {
    expect(parseLocationSelection(null)).toBeNull();
    expect(parseLocationSelection({ mode: "gps", city: "Pune" })).toBeNull();
    expect(parseLocationSelection("x")).toBeNull();
  });
  it("shows the selection at the top and never defaults to a city", () => {
    expect(describeSelection(null)).toBe("No city selected yet");
    expect(describeSelection({ mode: "manual", city: null, hasLocation: false, stale: false, shareDistance: true })).toBe(
      "No city selected yet",
    );
    expect(describeSelection({ mode: "manual", city: "Mumbai", hasLocation: false, stale: false, shareDistance: true })).toBe(
      "Selected city: Mumbai",
    );
  });
  it("makes the active mode and stale state clear", () => {
    const base = { city: "Pune", hasLocation: true, shareDistance: true };
    expect(describeMode({ ...base, mode: "current", stale: false })).toMatch(/current location/i);
    expect(describeMode({ ...base, mode: "current", stale: true })).toMatch(/out of date/i);
    expect(describeMode({ ...base, mode: "manual", hasLocation: false, stale: false })).toMatch(/city to city/i);
  });
  it("has user-facing copy for the new server errors", () => {
    expect(classifyServerError("unknown_city")).toBe("unknown_city");
    expect(classifyServerError("city_mismatch")).toBe("city_mismatch");
    expect(describeServerError("unknown_city")).toMatch(/supported/i);
    expect(describeServerError("city_mismatch")).toMatch(/match/i);
  });
});

describe("distance labels never pretend to be exact", () => {
  it("keeps the device wording and labels city-level distances as approximate", () => {
    expect(formatDistanceLabel(1)).toBe("Less than 2 km away");
    expect(formatDistanceLabel(12)).toBe("~12 km away");
    expect(formatDistanceLabel(120, "city")).toBe("About 120 km away (city to city)");
    expect(formatDistanceLabel(5, "city")).toBe("In your area");
    expect(formatDistanceLabel(null, "city")).toBeNull();
  });
});
