import * as fs from "fs";
import * as path from "path";

const mockRpc = jest.fn();
let mockConfigured = true;
let mockHasConsent = true;

jest.mock("expo-location", () => ({
  Accuracy: { Balanced: 3, High: 4 },
  enableNetworkProviderAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  hasServicesEnabledAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
}));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
}));
// Purpose-specific location consent (Step 3) is exercised in consent.test.ts; here it is a controllable gate.
jest.mock("../mobile/src/services/consent", () => ({
  hasConsent: async () => mockHasConsent,
}));
jest.mock("../mobile/src/services/supabase", () => ({
  isSupabaseConfigured: () => mockConfigured,
  supabase: { rpc: (...a: unknown[]) => mockRpc(...a) },
}));

import * as ExpoLocation from "expo-location";
import {
  describeLocationResult,
  enableLocationSharing,
  getDistanceTo,
  getMyLocationStatus,
  setDistanceSharing,
} from "../mobile/src/services/location";
import {
  classifyServerError,
  describeServerError,
  formatDistanceLabel,
} from "../mobile/src/services/locationPolicy";

const loc = ExpoLocation as unknown as Record<string, jest.Mock>;

function fix(over: Record<string, unknown> = {}) {
  return {
    coords: { latitude: 18.520411, longitude: 73.856744, accuracy: 24.6 },
    timestamp: Date.now(),
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockConfigured = true;
  mockHasConsent = true;
  loc.getForegroundPermissionsAsync.mockResolvedValue({ status: "granted", canAskAgain: true });
  loc.hasServicesEnabledAsync.mockResolvedValue(true);
  loc.getCurrentPositionAsync.mockResolvedValue(fix());
  mockRpc.mockResolvedValue({ data: "2026-01-01T00:00:00Z", error: null });
});

describe("formatDistanceLabel", () => {
  it("formats bucketed distances and hides unknown ones", () => {
    expect(formatDistanceLabel(null)).toBeNull();
    expect(formatDistanceLabel(undefined)).toBeNull();
    expect(formatDistanceLabel(NaN)).toBeNull();
    expect(formatDistanceLabel(-1)).toBeNull();
    expect(formatDistanceLabel(2)).toBe("Less than 2 km away");
    expect(formatDistanceLabel(5)).toBe("~5 km away");
    expect(formatDistanceLabel(120)).toBe("~120 km away");
  });
});

describe("classifyServerError", () => {
  it("maps known server messages and defaults to unknown", () => {
    expect(classifyServerError("rate_limited")).toBe("rate_limited");
    expect(classifyServerError("ERROR: implausible_movement")).toBe("implausible_movement");
    expect(classifyServerError("location_too_imprecise")).toBe("location_too_imprecise");
    expect(classifyServerError("Invalid coordinates")).toBe("invalid_coordinates");
    expect(classifyServerError("Active profile required")).toBe("profile_required");
    expect(classifyServerError("Authentication required")).toBe("authentication_required");
    expect(classifyServerError("boom")).toBe("unknown");
    expect(classifyServerError(null)).toBe("unknown");
  });
  it("every code has user-facing copy", () => {
    for (const c of [
      "rate_limited", "implausible_movement", "location_too_imprecise", "invalid_coordinates",
      "profile_required", "authentication_required", "unknown",
    ] as const) {
      expect(describeServerError(c).length).toBeGreaterThan(10);
    }
  });
});

describe("enableLocationSharing", () => {
  it("does not prompt for permission or read the location until location consent is granted", async () => {
    mockHasConsent = false;
    expect(await enableLocationSharing()).toEqual({ status: "consent_required" });
    expect(loc.getForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(loc.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(loc.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("sends the real device fix and its rounded accuracy to the server", async () => {
    expect(await enableLocationSharing()).toEqual({ status: "enabled" });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith("set_my_discovery_location", {
      _latitude: 18.520411,
      _longitude: 73.856744,
      _accuracy_m: 25,
    });
  });

  it("does nothing when the backend is not configured", async () => {
    mockConfigured = false;
    expect((await enableLocationSharing()).status).toBe("error");
    expect(loc.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("reports permission denial without reading a position", async () => {
    loc.getForegroundPermissionsAsync.mockResolvedValue({ status: "denied", canAskAgain: false });
    expect(await enableLocationSharing()).toEqual({ status: "permission_denied" });
    expect(loc.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("reports disabled location services", async () => {
    loc.hasServicesEnabledAsync.mockResolvedValue(false);
    expect(await enableLocationSharing()).toEqual({ status: "services_disabled" });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects mock-location fixes without contacting the server", async () => {
    loc.getCurrentPositionAsync.mockResolvedValue(fix({ mocked: true }));
    expect(await enableLocationSharing()).toEqual({ status: "mock_location" });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects invalid device coordinates before any server call", async () => {
    loc.getCurrentPositionAsync.mockResolvedValue(fix({ coords: { latitude: 99, longitude: 0, accuracy: 5 } }));
    expect((await enableLocationSharing()).status).toBe("error");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("surfaces server rejections as typed outcomes without leaking coordinates", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "rate_limited" } });
    const out = await enableLocationSharing();
    expect(out).toMatchObject({ status: "rejected", code: "rate_limited" });
    expect(JSON.stringify(out)).not.toMatch(/18\.52|73\.85/);
  });

  it("never leaks coordinates in thrown-error results", async () => {
    mockRpc.mockRejectedValue(new Error("network down"));
    const out = await enableLocationSharing();
    expect(out.status).toBe("error");
    expect(JSON.stringify(out)).not.toMatch(/18\.52|73\.85/);
  });

  it("every outcome has user-facing copy", () => {
    const outcomes = [
      { status: "enabled" },
      { status: "permission_denied" },
      { status: "services_disabled" },
      { status: "unsupported" },
      { status: "mock_location" },
      { status: "timeout" },
      { status: "rejected", code: "rate_limited", message: "You've updated your location too often." },
      { status: "error", message: "Location request timed out." },
    ] as const;
    for (const o of outcomes) expect(describeLocationResult(o as never).length).toBeGreaterThan(5);
  });
});

describe("privacy RPC wrappers", () => {
  it("maps status, sharing and distance RPCs", async () => {
    mockRpc.mockResolvedValueOnce({
      data: { has_location: true, stale: false, share_distance: false, updated_at: "x" },
      error: null,
    });
    expect(await getMyLocationStatus()).toEqual({ hasLocation: true, stale: false, shareDistance: false });
    mockRpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await setDistanceSharing(false)).toBe(true);
    expect(mockRpc).toHaveBeenLastCalledWith("set_distance_sharing", { _share: false });
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    expect(await setDistanceSharing(true)).toBe(false);
    mockRpc.mockResolvedValueOnce({ data: 5, error: null });
    expect(await getDistanceTo("abc")).toBe(5);
    expect(mockRpc).toHaveBeenLastCalledWith("get_distance_to", { _id: "abc" });
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await getDistanceTo("abc")).toBeNull();
  });
});

describe("static privacy guarantees", () => {
  const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

  it("the location service does not persist or log coordinates and calls no third-party geocoder", () => {
    const src = read("mobile/src/services/location.ts");
    expect(src).not.toMatch(/AsyncStorage|localStorage/);
    expect(src).not.toMatch(/console\.(log|warn|error|info)/);
    expect(src).not.toMatch(/nominatim|googleapis|mapbox|here\.com|fetch\(/i);
    expect(src).not.toMatch(/requestBackgroundPermissionsAsync|watchPositionAsync/);
  });

  it("onboarding uses the real location service (no simulated grant, no third-party geocoder)", () => {
    const onboarding = read("mobile/app/onboarding/index.tsx");
    expect(onboarding).not.toMatch(/nominatim/i);
    expect(onboarding).not.toMatch(/navigator\.geolocation/);
    expect(onboarding).not.toMatch(/Location permission granted\./);
    expect(onboarding).toMatch(/LocationPicker/);
    expect(onboarding).not.toMatch(/useState\(profile\?\.city \|\| "Mumbai"\)/);
  });

  it("the selection and GPS services store nothing on the device, log nothing and use no geocoder at all", () => {
    for (const f of ["mobile/src/services/locationSelection.ts", "mobile/src/services/gpsFix.ts"]) {
      const src = read(f);
      expect(src).not.toMatch(/AsyncStorage|localStorage|SecureStore/);
      expect(src).not.toMatch(/console\.(log|warn|error|info)/);
      expect(src).not.toMatch(/nominatim|googleapis|mapbox|here\.com|fetch\(/i);
      expect(src).not.toMatch(/requestBackgroundPermissionsAsync|watchPositionAsync/);
      // The server resolves the place from the snapped position; the OS geocoder is never handed a position.
      expect(src).not.toMatch(/reverseGeocodeAsync|geocodeAsync/);
    }
  });

  it("there is no hardcoded supported-city list or default city in the app", () => {
    expect(fs.existsSync(path.join(__dirname, "..", "mobile/src/constants/cities.ts"))).toBe(false);
    for (const f of [
      "mobile/src/services/locationSelectionPolicy.ts",
      "mobile/src/services/locationSelection.ts",
      "mobile/src/components/location/LocationPicker.tsx",
      "mobile/app/onboarding/index.tsx",
      "mobile/src/types/index.ts",
    ]) {
      const src = read(f);
      expect(src).not.toMatch(/SUPPORTED_CITIES|POPULAR_CITIES|export const CITIES/);
      expect(src).not.toMatch(/["']Pune["']/);
    }
  });

  it("Expo config requests foreground-only location without a paid API key", () => {
    const app = JSON.parse(read("mobile/app.json")).expo;
    const plugin = app.plugins.find((p: unknown) => Array.isArray(p) && p[0] === "expo-location");
    expect(plugin[1].isAndroidBackgroundLocationEnabled).toBe(false);
    expect(app.android.permissions).not.toContain("android.permission.ACCESS_BACKGROUND_LOCATION");
  });

  it("expo-location is pinned to the SDK 54 line in both manifests", () => {
    for (const p of ["package.json", "mobile/package.json"]) {
      expect(JSON.parse(read(p)).dependencies["expo-location"]).toBe("~19.0.8");
    }
  });

  it("no screen renders a raw distanceKm number (labels go through formatDistanceLabel)", () => {
    for (const f of [
      "mobile/src/components/discovery/DiscoveryCard.tsx",
      "mobile/app/profile/[id].tsx",
    ]) {
      expect(read(f)).not.toMatch(/\{[^}]*distanceKm\}\s*km/);
      expect(read(f)).toMatch(/formatDistanceLabel/);
    }
  });
});

describe("hardening migration (static)", () => {
  const dir = path.join(__dirname, "../supabase/migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const name = "20260101002600_location_privacy_hardening.sql";
  const sql = fs.readFileSync(path.join(dir, name), "utf8");

  it("has a unique timestamp that sorts after every earlier migration", () => {
    const stamps = files.map((f) => f.split("_")[0]);
    expect(new Set(stamps).size).toBe(stamps.length);
    expect(files).toContain("20260101001900_location_discovery.sql");
    expect(files.indexOf(name)).toBeGreaterThan(files.indexOf("20260101002500_voice_messages_and_chat_storage.sql"));
  });

  it("snaps coordinates, bounds accuracy, rate limits and guards implausible movement", () => {
    expect(sql).toMatch(/round\(_latitude::numeric, 2\)/);
    expect(sql).toMatch(/_accuracy_m > 5000/);
    expect(sql).toMatch(/rate_limited/);
    expect(sql).toMatch(/implausible_movement/);
  });

  it("keeps new tables and helpers closed to clients, and client RPCs authenticated-only", () => {
    expect(sql).toMatch(/ALTER TABLE public\.discovery_location_settings ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/REVOKE ALL ON public\.discovery_location_settings FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.haversine_km[^;]*authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_distance_to\(text\) TO authenticated/);
    expect(sql).not.toMatch(/GRANT EXECUTE[^;]*\bTO\b[^;]*\banon\b/);
  });

  it("never returns exact metres or coordinates from the feed", () => {
    expect(sql).toMatch(/coalesce\(s\.bucket_km, 0\) \* 1000 AS order_distance_m/);
    expect(sql).not.toMatch(/round\(r?\.?exact_distance_m\)/);
  });

  it("removes location data when a profile is purged", () => {
    expect(sql).toMatch(/AFTER DELETE\s+ON public\.profiles/);
    expect(sql).toMatch(/DELETE FROM public\.discovery_locations WHERE user_id = OLD\.user_id/);
  });

  it("does not touch purchase, call or notification objects", () => {
    expect(sql).not.toMatch(/subscription|google_play|video_call|call_session|wallet|push_|notification/i);
  });
});
