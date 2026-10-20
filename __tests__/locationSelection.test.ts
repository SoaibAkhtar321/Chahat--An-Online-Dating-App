const mockRpc = jest.fn();
let mockConfigured = true;
let mockConsent = true;

jest.mock("expo-location", () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  hasServicesEnabledAsync: jest.fn(),
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
  loadLocationSelection,
  selectCityManually,
  selectCurrentLocation,
} from "../mobile/src/services/locationSelection";

const loc = ExpoLocation as unknown as Record<string, jest.Mock>;
const fix = (over: Record<string, unknown> = {}) => ({
  coords: { latitude: 18.520411, longitude: 73.856744, accuracy: 24.6 },
  timestamp: Date.now(),
  ...over,
});

let consoleSpies: jest.SpyInstance[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  mockConfigured = true;
  mockConsent = true;
  loc.getForegroundPermissionsAsync.mockResolvedValue({ status: "granted", canAskAgain: true });
  loc.requestForegroundPermissionsAsync.mockResolvedValue({ status: "granted", canAskAgain: true });
  loc.hasServicesEnabledAsync.mockResolvedValue(true);
  loc.getCurrentPositionAsync.mockResolvedValue(fix());
  loc.getLastKnownPositionAsync.mockResolvedValue(null);
  loc.reverseGeocodeAsync.mockResolvedValue([{ city: "Pune", subregion: "Pune", district: "Pune" }]);
  mockRpc.mockResolvedValue({ data: { mode: "current", city: "Pune" }, error: null });
  consoleSpies = (["log", "warn", "error", "info"] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => consoleSpies.forEach((s) => s.mockRestore()));

describe("manual selection (search and popular chips share this one path)", () => {
  it("saves a supported city atomically in manual mode with no coordinates", async () => {
    expect(await selectCityManually("pune")).toEqual({ status: "saved", city: "Pune" });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith("set_my_location_selection", { _mode: "manual", _city: "Pune" });
  });
  it("accepts alternative names but sends the canonical city", async () => {
    await selectCityManually("Bangalore");
    expect(mockRpc).toHaveBeenCalledWith("set_my_location_selection", { _mode: "manual", _city: "Bengaluru" });
  });
  it("rejects an unsupported city without calling the server", async () => {
    const result = await selectCityManually("Atlantis");
    expect(result).toMatchObject({ status: "rejected", code: "unknown_city" });
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it("surfaces a server rejection with friendly copy", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "unknown_city" } });
    expect(await selectCityManually("Pune")).toMatchObject({ status: "rejected", code: "unknown_city" });
  });
});

describe("current location mode", () => {
  it("detects the city through the platform geocoder (rounded position only) and saves mode, city and coordinates in one RPC", async () => {
    const result = await selectCurrentLocation();
    expect(result).toEqual({ status: "saved", city: "Pune" });
    expect(loc.reverseGeocodeAsync).toHaveBeenCalledWith({ latitude: 18.52, longitude: 73.86 });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith("set_my_location_selection", {
      _mode: "current",
      _city: "Pune",
      _latitude: 18.520411,
      _longitude: 73.856744,
      _accuracy_m: 25,
    });
  });
  it("falls back to the nearest bundled city when the geocoder throws", async () => {
    loc.reverseGeocodeAsync.mockRejectedValue(new Error("Geocoder unavailable"));
    expect(await selectCurrentLocation()).toEqual({ status: "saved", city: "Pune" });
  });
  it("falls back to the nearest bundled city when the geocoder returns nothing useful", async () => {
    loc.reverseGeocodeAsync.mockResolvedValue([{ city: "Lonavala", subregion: null, district: null }]);
    expect(await selectCurrentLocation()).toEqual({ status: "saved", city: "Pune" });
  });
  it("never fabricates a city: far from every supported city nothing is saved", async () => {
    loc.getCurrentPositionAsync.mockResolvedValue(fix({ coords: { latitude: 0.5, longitude: 0.5, accuracy: 10 } }));
    loc.reverseGeocodeAsync.mockResolvedValue([]);
    expect(await selectCurrentLocation()).toEqual({ status: "city_unresolved" });
    expect(mockRpc).not.toHaveBeenCalled();
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
    expect(await selectCurrentLocation()).toEqual({ status: "permission_denied", canAskAgain: true });
    expect(loc.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it("does not re-prompt when permission is permanently denied", async () => {
    loc.getForegroundPermissionsAsync.mockResolvedValue({ status: "denied", canAskAgain: false });
    expect(await selectCurrentLocation()).toEqual({ status: "permission_denied", canAskAgain: false });
    expect(loc.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it("reports disabled location services without saving", async () => {
    loc.hasServicesEnabledAsync.mockResolvedValue(false);
    expect(await selectCurrentLocation()).toEqual({ status: "services_disabled" });
    expect(loc.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it("uses a recent cached position when the live request fails, and errors when there is none", async () => {
    loc.getCurrentPositionAsync.mockRejectedValue(new Error("Location request timed out."));
    loc.getLastKnownPositionAsync.mockResolvedValue(fix());
    expect(await selectCurrentLocation()).toEqual({ status: "saved", city: "Pune" });
    loc.getLastKnownPositionAsync.mockResolvedValue(null);
    expect(await selectCurrentLocation()).toMatchObject({ status: "error" });
  });
  it("rejects mock locations and invalid coordinates", async () => {
    loc.getCurrentPositionAsync.mockResolvedValue(fix({ mocked: true }));
    expect(await selectCurrentLocation()).toEqual({ status: "mock_location" });
    loc.getCurrentPositionAsync.mockResolvedValue(fix({ coords: { latitude: NaN, longitude: 73, accuracy: 5 } }));
    expect(await selectCurrentLocation()).toMatchObject({ status: "error" });
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it("maps server rejections (city mismatch, rate limit) to friendly copy without leaking coordinates", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "city_mismatch lat=18.520411" } });
    const result = await selectCurrentLocation();
    expect(result).toMatchObject({ status: "rejected", code: "city_mismatch" });
    expect(JSON.stringify(result)).not.toMatch(/18\.52|73\.85/);
  });
  it("never logs anything", async () => {
    await selectCurrentLocation();
    await selectCityManually("Pune");
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });
});

describe("switching modes and persistence", () => {
  it("manual -> current -> manual issues one atomic RPC per change, in order", async () => {
    await selectCityManually("Mumbai");
    await selectCurrentLocation();
    await selectCityManually("Delhi");
    expect(mockRpc.mock.calls.map((c) => [c[0], c[1]._mode, c[1]._city])).toEqual([
      ["set_my_location_selection", "manual", "Mumbai"],
      ["set_my_location_selection", "current", "Pune"],
      ["set_my_location_selection", "manual", "Delhi"],
    ]);
    // the manual calls carry no coordinates, so the server clears any stored ones
    expect(mockRpc.mock.calls[0][1]).not.toHaveProperty("_latitude");
    expect(mockRpc.mock.calls[2][1]).not.toHaveProperty("_latitude");
  });
  it("restores the saved selection from the server after a restart (nothing is kept on the device)", async () => {
    mockRpc.mockResolvedValue({
      data: { mode: "manual", city: "Pune", has_location: false, stale: false, share_distance: true },
      error: null,
    });
    expect(await loadLocationSelection()).toEqual({
      mode: "manual",
      city: "Pune",
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

describe("copy keeps manual search available", () => {
  it("every non-saved outcome points the member to a way forward", () => {
    expect(describeSelectionResult({ status: "permission_denied", canAskAgain: false })).toMatch(/search for your city/i);
    expect(describeSelectionResult({ status: "permission_denied", canAskAgain: true })).toMatch(/search for your city/i);
    expect(describeSelectionResult({ status: "services_disabled" })).toMatch(/search for your city/i);
    expect(describeSelectionResult({ status: "city_unresolved" })).toMatch(/search for your city/i);
    expect(describeSelectionResult({ status: "consent_required" })).toMatch(/search for your city/i);
    expect(describeSelectionResult({ status: "saved", city: "Pune" })).toBe("Location set to Pune.");
  });
});
