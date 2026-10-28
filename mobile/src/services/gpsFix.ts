// Getting ONE fresh, trustworthy position fix on Android for "Use My Current Location".
// Used by locationSelection.selectCurrentLocation and location.enableLocationSharing. Nothing is persisted on the
// device, nothing is logged, and coordinates never leave this module except in the returned fix.
//
// Why this exists: getCurrentPositionAsync with Balanced accuracy can hang on Android (no fix, Doze, indoor) and,
// when it does return, may hand back a cached network position that is hours old. The previous code then fell
// back to a last-known position up to 72 h old, so members were "located" where they had been days ago.
import * as Location from "expo-location";
import { Platform } from "react-native";
import { isValidCoordinates } from "./locationPolicy";

/** A fix older than this is "stale" and never used to set a location. */
export const MAX_FIX_AGE_MS = 2 * 60 * 1000;
/** The OS-reported accuracy ceiling the server accepts (set_my_discovery_location refuses anything worse). */
export const MAX_ACCURACY_M = 5000;
/** Per attempt. Two attempts are made, so the member waits at most ~25 s before being offered a retry. */
export const FIRST_ATTEMPT_TIMEOUT_MS = 15_000;
export const SECOND_ATTEMPT_TIMEOUT_MS = 10_000;

export type PermissionPrecision = "precise" | "approximate";

export interface GpsFix {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  precision: PermissionPrecision;
}

export type GpsFixResult =
  | { status: "ok"; fix: GpsFix }
  | { status: "unsupported" }
  | { status: "permission_denied"; canAskAgain: boolean }
  | { status: "services_disabled" }
  | { status: "timeout" }
  | { status: "too_imprecise" }
  | { status: "mock_location" }
  | { status: "invalid" }
  | { status: "error"; message: string };

export class FixTimeoutError extends Error {
  constructor() {
    super("Location request timed out.");
    this.name = "FixTimeoutError";
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new FixTimeoutError()), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** Android 12+ lets the member grant only approximate location; that is accepted (~2 km is enough for a town). */
export function permissionPrecision(permission: Location.LocationPermissionResponse): PermissionPrecision {
  return permission.android?.accuracy === "coarse" ? "approximate" : "precise";
}

/** Pure check used for every candidate fix: recent, valid, accurate enough. */
export function classifyFix(
  position: Pick<Location.LocationObject, "coords" | "timestamp"> | null | undefined,
  now: number = Date.now(),
): "ok" | "missing" | "stale" | "invalid" | "too_imprecise" {
  if (!position || !position.coords) return "missing";
  const { latitude, longitude, accuracy } = position.coords;
  if (!isValidCoordinates({ latitude, longitude })) return "invalid";
  // Some Android providers report (0, 0) when they have nothing.
  if (latitude === 0 && longitude === 0) return "invalid";
  const ts = Number(position.timestamp);
  if (!Number.isFinite(ts) || now - ts > MAX_FIX_AGE_MS || ts - now > MAX_FIX_AGE_MS) return "stale";
  if (typeof accuracy === "number" && Number.isFinite(accuracy) && accuracy > MAX_ACCURACY_M) return "too_imprecise";
  return "ok";
}

async function ensurePermission(): Promise<
  { ok: true; precision: PermissionPrecision } | { ok: false; canAskAgain: boolean }
> {
  let permission = await Location.getForegroundPermissionsAsync();
  // Ask whenever Android still allows it. (The old code asked at most once per install and then never again,
  // so a member who dismissed the dialog once could never grant it from the app.)
  if (permission.status !== "granted" && permission.canAskAgain !== false) {
    permission = await Location.requestForegroundPermissionsAsync();
  }
  if (permission.status !== "granted") return { ok: false, canAskAgain: permission.canAskAgain !== false };
  return { ok: true, precision: permissionPrecision(permission) };
}

async function ensureServices(): Promise<boolean> {
  if (await Location.hasServicesEnabledAsync()) return true;
  if (Platform.OS === "android") {
    try {
      // Shows Google Play services' "Turn on device location" dialog. Rejects if the member declines.
      await Location.enableNetworkProviderAsync();
    } catch {
      return false;
    }
    return Location.hasServicesEnabledAsync();
  }
  return false;
}

/**
 * Permission → location services → a FRESH fix. Order of attempts:
 *   1. getCurrentPositionAsync at High (precise grant) or Balanced (approximate grant), 15 s;
 *   2. one retry at Balanced, 10 s (cell/Wi-Fi often answers when GPS cannot see the sky);
 *   3. the OS last-known position, but only if it is under 2 minutes old.
 * Anything older, invalid or worse than 5 km is never used. Mock-provider fixes are refused.
 */
export async function acquireFreshFix(now: () => number = Date.now): Promise<GpsFixResult> {
  if (Platform.OS !== "android" && Platform.OS !== "ios") return { status: "unsupported" };
  try {
    const permission = await ensurePermission();
    if (!permission.ok) return { status: "permission_denied", canAskAgain: permission.canAskAgain };
    if (!(await ensureServices())) return { status: "services_disabled" };

    const firstAccuracy = permission.precision === "precise" ? Location.Accuracy.High : Location.Accuracy.Balanced;
    const attempts: Array<() => Promise<Location.LocationObject | null>> = [
      () =>
        withTimeout(
          Location.getCurrentPositionAsync({ accuracy: firstAccuracy, mayShowUserSettingsDialog: true }),
          FIRST_ATTEMPT_TIMEOUT_MS,
        ),
      () =>
        withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), SECOND_ATTEMPT_TIMEOUT_MS),
      () => Location.getLastKnownPositionAsync({ maxAge: MAX_FIX_AGE_MS, requiredAccuracy: MAX_ACCURACY_M }),
    ];

    let sawImprecise = false;
    let sawInvalid = false;
    for (const attempt of attempts) {
      let position: Location.LocationObject | null = null;
      try {
        position = await attempt();
      } catch {
        continue; // timeout or provider error: try the next source
      }
      const verdict = classifyFix(position, now());
      if (verdict === "too_imprecise") sawImprecise = true;
      if (verdict === "invalid") sawInvalid = true;
      if (verdict !== "ok" || !position) continue;
      // Android only: refuse fixes from a mock-location provider (the server also guards against crude spoofing).
      if ((position as { mocked?: boolean }).mocked === true) return { status: "mock_location" };
      const accuracy = position.coords.accuracy;
      return {
        status: "ok",
        fix: {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyM: typeof accuracy === "number" && Number.isFinite(accuracy) ? Math.max(0, Math.round(accuracy)) : null,
          precision: permission.precision,
        },
      };
    }
    if (sawImprecise) return { status: "too_imprecise" };
    if (sawInvalid) return { status: "invalid" };
    return { status: "timeout" };
  } catch (error) {
    // Never echo provider output (it can contain coordinates).
    return { status: "error", message: error instanceof Error && !/\d+\.\d{3,}/.test(error.message)
      ? error.message
      : "Could not determine your location." };
  }
}
