const mockRpc = jest.fn();
let mockConfigured = true;
let mockConsent = true;

jest.mock("expo-location", () => ({
  Accuracy: { Balanced: 3, High: 4 },
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  hasServicesEnabledAsync: jest.fn(),
  enableNetworkProviderAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
}));
jest.mock("../mobile/src/services/consent", () => ({ hasConsent: async () => mockConsent }));
jest.mock("../mobile/src/services/supabase", () => ({
  isSupabaseConfigured: () => mockConfigured,
  supabase: { rpc: (...a: unknown[]) => mockRpc(...a) },
}));

import * as ExpoLocation from "expo-location";
import {
  describeSelectionResult,
  isRetryable,
  loadLocationSelection,
  searchCities,
  selectCityManually,
  selectCurrentLocation,
} from "../mobile/src/services/locationSelection";

const loc = ExpoLocation as unknown as Record<string, jest.Mock>;
// Gorakhpur, Uttar Pradesh: outside the old 44-city list (the old code returned city_unresolved here).
const fix = (over: Record<string, unknown> = {}) => ({
  coords: { latitude: 26.760612, longitude: 83.373201, accuracy: 24.6 },
  timestamp: Date.now(),
  ...over,
});

let consoleSpies: jest.SpyInstance[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  mockConfigured = true;
  mockConsent = true;
  loc.getForegroundPermissionsAsync.mockResolvedValue({ status: "granted", canAskAgain: true, android: { accuracy: "fine" } });
  loc.requestForegroundPermissionsAsync.mockResolvedValue({ status: "granted", canAskAgain: true, android: { accuracy: "fine" } });
  loc.hasServicesEnabledAsync.mockResolvedValue(true);
  loc.enableNetworkProviderAsync.mockRejectedValue(new Error("declined"));
  loc.getCurrentPositionAsync.mockResolvedValue(fix());
  loc.getLastKnownPositionAsync.mockResolvedValue(null);
  mockRpc.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
    if (fn === "set_my_location_selection") {
      return { data: { mode: args._mode, city: args._mode === "manual" ? args._city : "Gorakhpur, Uttar Pradesh" }, error: null };
    }
    return { data: null, error: null };
  });
  consoleSpies = (["log", "warn", "error", "info"] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => consoleSpies.forEach((s) => s.mockRestore()));

describe("dynamic city search (server-side, no bundled list)", () => {
  it("searches the server and returns names and states only", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [
        { name: "Greater Noida", state: "Uttar Pradesh" },
        { name: "Gorakhpur, Uttar Pradesh", state: "Uttar Pradesh" },
      ],
      error: null,
    });
    expect(await searchCities("  greater  noida ")).toEqual({
      status: "ok",
      results: [
        { name: "Greater Noida", state: "Uttar Pradesh" },
        { name: "Gorakhpur, Uttar Pradesh", state: "Uttar Pradesh" },
      ],
    });
    expect(mockRpc).toHaveBeenCalledWith("search_cities", { _query: "greater noida", _limit: 10 });
  });

  it.each(["Greater Noida", "Gorakhpur", "Kolkata", "Kushinagar"])("passes %s through to the server unchanged", async (q) => {
    mockRpc.mockResolvedValueOnce({ data: [{ name: q, state: "X" }], error: null });
    const out = await searchCities(q);
    expect(out).toEqual({ status: "ok", results: [{ name: q, state: "X" }] });
    expect(mockRpc).toHaveBeenCalledWith("search_cities", { _query: q, _limit: 10 });
  });

  it("does not call the server for a one-letter query", async () => {
    expect(await searchCities("k")).toEqual({ status: "too_short" });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("reports search errors (offline / server) as retryable errors, never as 'no results'", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "fetch failed" } });
    expect((await searchCities("kolk")).status).toBe("error");
    mockRpc.mockRejectedValueOnce(new Error("network"));
    expect((await searchCities("kolk")).status).toBe("error");
    mockConfigured = false;
    expect((await searchCities("kolk")).status).toBe("error");
  });
});

describe("manual selection (Search City)", () => {
  it("saves the chosen place atomically in manual mode with no coordinates", async () => {
    expect(await selectCityManually("Kushinagar")).toEqual({ status: "saved", city: "Kushinagar" });
    expect(mockRpc).toHaveBeenCalledWith("set_my_location_selection", { _mode: "manual", _city: "Kushinagar" });
    expect(mockRpc.mock.calls[0][1]).not.toHaveProperty("_latitude");
  });

  it("uses the server's canonical name in the result", async () => {
    mockRpc.mockResolvedValueOnce({ data: { mode: "manual", city: "Kolkata" }, error: null });
    expect(await selectCityManually("kolkata")).toEqual({ status: "saved", city: "Kolkata" });
  });

  it("rejects an empty name without calling the server", async () => {
    expect(await selectCityManually("   ")).toMatchObject({ status: "rejected", code: "unknown_city" });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("surfaces a server rejection with friendly copy", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "unknown_city" } });
    const result = await selectCityManually("Atlantis");
    expect(result).toMatchObject({ status: "rejected", code: "unknown_city" });
    expect(describeSelectionResult(result)).toMatch(/search/i);
  });
});

describe("Use My Current Location", () => {
  it("sends a fresh fix with _city = null; the server picks the place (no geocoder on the phone)", async () => {
    const result = await selectCurrentLocation();
    expect(result).toEqual({ status: "saved", city: "Gorakhpur, Uttar Pradesh", precision: "precise" });
    expect(mockRpc).toHaveBeenCalledWith("set_my_location_selection", {
      _mode: "current",
      _city: null,
      _latitude: 26.760612,
      _longitude: 83.373201,
      _accuracy_m: 25,
    });
    expect(loc.reverseGeocodeAsync).not.toHaveBeenCalled();
  });

  it("reports an approximate-only grant in the success copy", async () => {
    loc.getForegroundPermissionsAsync.mockResolvedValue({ status: "granted", canAskAgain: true, android: { accuracy: "coarse" } });
    const result = await selectCurrentLocation();
    expect(result).toMatchObject({ status: "saved", precision: "approximate" });
    expect(describeSelectionResult(result)).toMatch(/approximate/);
  });

  it("server 'no_city_nearby' becomes city_unresolved; nothing is invented", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "no_city_nearby" } });
    expect(await selectCurrentLocation()).toEqual({ status: "city_unresolved" });
  });

  it("requires location consent before touching permissions or the position", async () => {
    mockConsent = false;
    expect(await selectCurrentLocation()).toEqual({ status: "consent_required" });
    expect(loc.getForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(loc.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("asks for permission when it can, and reports denial without saving", async () => {
    loc.getForegroundPermissionsAsync.mockResolvedValue({ status: "undetermined", canAskAgain: true });
    loc.requestForegroundPermissionsAsync.mockResolvedValue({ status: "denied", canAskAgain: true });
    const r = await selectCurrentLocation();
    expect(r).toEqual({ status: "permission_denied", canAskAgain: true });
    expect(isRetryable(r)).toBe(true);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("does not re-prompt when permission is permanently denied, and points to settings", async () => {
    loc.getForegroundPermissionsAsync.mockResolvedValue({ status: "denied", canAskAgain: false });
    const r = await selectCurrentLocation();
    expect(r).toEqual({ status: "permission_denied", canAskAgain: false });
    expect(loc.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(isRetryable(r)).toBe(false);
    expect(describeSelectionResult(r)).toMatch(/settings/i);
  });

  it("reports disabled location services without saving", async () => {
    loc.hasServicesEnabledAsync.mockResolvedValue(false);
    expect(await selectCurrentLocation()).toEqual({ status: "services_disabled" });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("a stale position is never saved; the member is offered a retry", async () => {
    loc.getCurrentPositionAsync.mockResolvedValue(fix({ timestamp: Date.now() - 6 * 60 * 60 * 1000 }));
    loc.getLastKnownPositionAsync.mockResolvedValue(fix({ timestamp: Date.now() - 48 * 60 * 60 * 1000 }));
    const r = await selectCurrentLocation();
    expect(r).toEqual({ status: "timeout" });
    expect(isRetryable(r)).toBe(true);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("retry after a failed fix succeeds", async () => {
    loc.getCurrentPositionAsync.mockRejectedValue(new Error("no fix"));
    expect((await selectCurrentLocation()).status).toBe("timeout");
    loc.getCurrentPositionAsync.mockResolvedValue(fix());
    expect((await selectCurrentLocation()).status).toBe("saved");
  });

  it("rejects mock locations and invalid coordinates", async () => {
    loc.getCurrentPositionAsync.mockResolvedValue(fix({ mocked: true }));
    expect(await selectCurrentLocation()).toEqual({ status: "mock_location" });
    loc.getCurrentPositionAsync.mockResolvedValue(fix({ coords: { latitude: 99, longitude: 0, accuracy: 5 } }));
    expect(await selectCurrentLocation()).toMatchObject({ status: "rejected", code: "invalid_coordinates" });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("maps server rejections (city mismatch, rate limit) to friendly copy without leaking coordinates", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "rate_limited at 26.760612,83.373201" } });
    const result = await selectCurrentLocation();
    expect(result).toMatchObject({ status: "rejected", code: "rate_limited" });
    expect(JSON.stringify(result)).not.toMatch(/26\.76|83\.37/);
    expect(describeSelectionResult(result)).not.toMatch(/26\.76|83\.37/);
  });

  it("never logs anything", async () => {
    await selectCurrentLocation();
    await selectCityManually("Kolkata");
    await searchCities("kush");
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });
});

describe("switching modes and persistence", () => {
  it("manual -> current -> manual issues one atomic RPC per change, in order", async () => {
    await selectCityManually("Kolkata");
    await selectCurrentLocation();
    await selectCityManually("Greater Noida");
    expect(mockRpc.mock.calls.map((c) => [c[0], c[1]._mode, c[1]._city])).toEqual([
      ["set_my_location_selection", "manual", "Kolkata"],
      ["set_my_location_selection", "current", null],
      ["set_my_location_selection", "manual", "Greater Noida"],
    ]);
    expect(mockRpc.mock.calls[0][1]).not.toHaveProperty("_latitude");
    expect(mockRpc.mock.calls[2][1]).not.toHaveProperty("_latitude");
  });
  it("restores the saved selection from the server after a restart (nothing is kept on the device)", async () => {
    mockRpc.mockResolvedValue({
      data: { mode: "manual", city: "Kushinagar", state: "Uttar Pradesh", has_location: false, stale: false, share_distance: true },
      error: null,
    });
    expect(await loadLocationSelection()).toEqual({
      mode: "manual",
      city: "Kushinagar",
      state: "Uttar Pradesh",
      hasLocation: false,
      stale: false,
      shareDistance: true,
    });
    expect(mockRpc).toHaveBeenCalledWith("get_my_location_selection");
  });
  it("returns null (and the UI shows an error) when the server response is malformed or fails", async () => {
    mockRpc.mockResolvedValue({ data: { mode: "weird" }, error: null });
    expect(await loadLocationSelection()).toBeNull();
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await loadLocationSelection()).toBeNull();
    mockConfigured = false;
    expect(await loadLocationSelection()).toBeNull();
  });
});

describe("copy keeps Search City available", () => {
  it("every non-saved outcome points the member to a way forward", () => {
    for (const r of [
      { status: "permission_denied", canAskAgain: false },
      { status: "permission_denied", canAskAgain: true },
      { status: "services_disabled" },
      { status: "city_unresolved" },
      { status: "consent_required" },
      { status: "timeout" },
    ] as const) {
      expect(describeSelectionResult(r)).toMatch(/search for your city/i);
    }
    expect(describeSelectionResult({ status: "saved", city: "Kushinagar" })).toBe("Location set to Kushinagar.");
  });
});
