// "Use My Current Location" on Android: permission (precise / approximate / denied / blocked), location services,
// fresh-fix rules (no stale cache), timeouts with fallback, mock providers, and retry after a failure.
let mockPlatformOS = "android";
jest.mock("react-native", () => ({
  Platform: {
    get OS() {
      return mockPlatformOS;
    },
  },
}));
jest.mock("expo-location", () => ({
  Accuracy: { Balanced: 3, High: 4 },
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  hasServicesEnabledAsync: jest.fn(),
  enableNetworkProviderAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
}));

import * as ExpoLocation from "expo-location";
import {
  acquireFreshFix,
  classifyFix,
  FIRST_ATTEMPT_TIMEOUT_MS,
  MAX_FIX_AGE_MS,
  permissionPrecision,
  SECOND_ATTEMPT_TIMEOUT_MS,
} from "../mobile/src/services/gpsFix";

const loc = ExpoLocation as unknown as Record<string, jest.Mock & Record<string, unknown>>;
const NOW = 1_800_000_000_000;
const fix = (over: Record<string, unknown> = {}, coords: Record<string, unknown> = {}) => ({
  coords: { latitude: 26.7606, longitude: 83.3732, accuracy: 18.4, ...coords },
  timestamp: NOW - 5_000,
  ...over,
});
const granted = (accuracy: "fine" | "coarse" = "fine") => ({
  status: "granted",
  granted: true,
  canAskAgain: true,
  android: { accuracy, scope: "whenInUse" },
});
const run = () => acquireFreshFix(() => NOW);

beforeEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  mockPlatformOS = "android";
  loc.getForegroundPermissionsAsync.mockResolvedValue(granted());
  loc.requestForegroundPermissionsAsync.mockResolvedValue(granted());
  loc.hasServicesEnabledAsync.mockResolvedValue(true);
  loc.enableNetworkProviderAsync.mockResolvedValue(undefined);
  loc.getCurrentPositionAsync.mockResolvedValue(fix());
  loc.getLastKnownPositionAsync.mockResolvedValue(null);
});

describe("classifyFix", () => {
  it("accepts a recent, valid, accurate fix", () => {
    expect(classifyFix(fix(), NOW)).toBe("ok");
  });
  it("treats a fix older than 2 minutes as stale (no more 72-hour cache)", () => {
    expect(classifyFix(fix({ timestamp: NOW - MAX_FIX_AGE_MS - 1 }), NOW)).toBe("stale");
    expect(classifyFix(fix({ timestamp: NOW - 60 * 60 * 1000 }), NOW)).toBe("stale");
    expect(classifyFix(fix({ timestamp: NaN }), NOW)).toBe("stale");
  });
  it("rejects invalid, (0,0) and missing fixes", () => {
    expect(classifyFix(fix({}, { latitude: 95 }), NOW)).toBe("invalid");
    expect(classifyFix(fix({}, { latitude: 0, longitude: 0 }), NOW)).toBe("invalid");
    expect(classifyFix(null, NOW)).toBe("missing");
  });
  it("rejects fixes worse than the 5 km server ceiling", () => {
    expect(classifyFix(fix({}, { accuracy: 5001 }), NOW)).toBe("too_imprecise");
    expect(classifyFix(fix({}, { accuracy: 4999 }), NOW)).toBe("ok");
  });
});

describe("permission handling", () => {
  it("precise grant asks for High accuracy and reports precise", async () => {
    const out = await run();
    expect(out).toEqual({
      status: "ok",
      fix: { latitude: 26.7606, longitude: 83.3732, accuracyM: 18, precision: "precise" },
    });
    expect(loc.getCurrentPositionAsync).toHaveBeenCalledWith({ accuracy: 4, mayShowUserSettingsDialog: true });
  });

  it("approximate (coarse) grant is accepted, uses Balanced and is reported as approximate", async () => {
    loc.getForegroundPermissionsAsync.mockResolvedValue(granted("coarse"));
    loc.getCurrentPositionAsync.mockResolvedValue(fix({}, { accuracy: 2000 }));
    const out = await run();
    expect(out).toMatchObject({ status: "ok", fix: { precision: "approximate", accuracyM: 2000 } });
    expect(loc.getCurrentPositionAsync).toHaveBeenCalledWith({ accuracy: 3, mayShowUserSettingsDialog: true });
    expect(permissionPrecision(granted("coarse") as never)).toBe("approximate");
  });

  it("asks when Android allows it, every time (no once-per-install lockout)", async () => {
    loc.getForegroundPermissionsAsync.mockResolvedValue({ status: "denied", canAskAgain: true });
    loc.requestForegroundPermissionsAsync.mockResolvedValue({ status: "denied", canAskAgain: true });
    expect(await run()).toEqual({ status: "permission_denied", canAskAgain: true });
    expect(await run()).toEqual({ status: "permission_denied", canAskAgain: true });
    expect(loc.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(2);
    expect(loc.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it("does not re-prompt when permission is permanently denied ('Don't ask again')", async () => {
    loc.getForegroundPermissionsAsync.mockResolvedValue({ status: "denied", canAskAgain: false });
    expect(await run()).toEqual({ status: "permission_denied", canAskAgain: false });
    expect(loc.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it("granting in the system dialog proceeds to a fix", async () => {
    loc.getForegroundPermissionsAsync.mockResolvedValue({ status: "undetermined", canAskAgain: true });
    expect((await run()).status).toBe("ok");
    expect(loc.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  });
});

describe("location services", () => {
  it("offers the Android 'turn on location' dialog and continues when accepted", async () => {
    loc.hasServicesEnabledAsync.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    expect((await run()).status).toBe("ok");
    expect(loc.enableNetworkProviderAsync).toHaveBeenCalledTimes(1);
  });

  it("reports services_disabled when the member declines the dialog", async () => {
    loc.hasServicesEnabledAsync.mockResolvedValue(false);
    loc.enableNetworkProviderAsync.mockRejectedValue(new Error("declined"));
    expect(await run()).toEqual({ status: "services_disabled" });
    expect(loc.getCurrentPositionAsync).not.toHaveBeenCalled();
  });
});

describe("fresh fix, timeouts and fallback", () => {
  it("retries at Balanced when the first request errors", async () => {
    loc.getCurrentPositionAsync.mockRejectedValueOnce(new Error("provider")).mockResolvedValueOnce(fix());
    expect((await run()).status).toBe("ok");
    expect(loc.getCurrentPositionAsync).toHaveBeenNthCalledWith(2, { accuracy: 3 });
  });

  it("times out a hanging request, then uses the second attempt", async () => {
    jest.useFakeTimers();
    loc.getCurrentPositionAsync
      .mockReturnValueOnce(new Promise(() => undefined)) // never resolves
      .mockResolvedValueOnce(fix());
    const p = run();
    await jest.advanceTimersByTimeAsync(FIRST_ATTEMPT_TIMEOUT_MS + 1);
    expect((await p).status).toBe("ok");
  });

  it("never uses a stale cached fix: a fresh request returning an old position falls through", async () => {
    loc.getCurrentPositionAsync.mockResolvedValue(fix({ timestamp: NOW - 3 * 60 * 60 * 1000 }));
    loc.getLastKnownPositionAsync.mockResolvedValue(fix({ timestamp: NOW - 24 * 60 * 60 * 1000 }));
    expect(await run()).toEqual({ status: "timeout" });
    expect(loc.getLastKnownPositionAsync).toHaveBeenCalledWith({ maxAge: MAX_FIX_AGE_MS, requiredAccuracy: 5000 });
  });

  it("uses a last-known position only when it is under 2 minutes old", async () => {
    loc.getCurrentPositionAsync.mockRejectedValue(new Error("no fix"));
    loc.getLastKnownPositionAsync.mockResolvedValue(fix({ timestamp: NOW - 30_000 }));
    expect((await run()).status).toBe("ok");
  });

  it("reports timeout when every source fails, and a later retry can succeed", async () => {
    jest.useFakeTimers();
    loc.getCurrentPositionAsync.mockReturnValue(new Promise(() => undefined));
    const p = run();
    await jest.advanceTimersByTimeAsync(FIRST_ATTEMPT_TIMEOUT_MS + SECOND_ATTEMPT_TIMEOUT_MS + 2);
    expect(await p).toEqual({ status: "timeout" });
    jest.useRealTimers();
    loc.getCurrentPositionAsync.mockResolvedValue(fix());
    expect((await run()).status).toBe("ok");
  });

  it("reports too_imprecise rather than sending a > 5 km fix", async () => {
    loc.getCurrentPositionAsync.mockResolvedValue(fix({}, { accuracy: 9000 }));
    expect(await run()).toEqual({ status: "too_imprecise" });
  });

  it("refuses mock-provider fixes", async () => {
    loc.getCurrentPositionAsync.mockResolvedValue(fix({ mocked: true }));
    expect(await run()).toEqual({ status: "mock_location" });
  });

  it("reports invalid coordinates", async () => {
    loc.getCurrentPositionAsync.mockResolvedValue(fix({}, { latitude: 0, longitude: 0 }));
    expect(await run()).toEqual({ status: "invalid" });
  });

  it("never echoes coordinates from a thrown provider error", async () => {
    loc.getForegroundPermissionsAsync.mockRejectedValue(new Error("bad fix at 26.760612,83.373201"));
    const out = await run();
    expect(out.status).toBe("error");
    expect(JSON.stringify(out)).not.toMatch(/26\.76|83\.37/);
  });

  it("is unsupported outside Android/iOS", async () => {
    mockPlatformOS = "web";
    expect(await run()).toEqual({ status: "unsupported" });
  });
});
