import { AppState, Platform, type AppStateStatus } from "react-native";
import * as ScreenCapture from "expo-screen-capture";

// Blocks screenshots, screen recording and the Recents thumbnail while sensitive content (the chat
// screen) is visible. On Android this sets FLAG_SECURE on the activity window through expo-screen-capture.
//
// Why this wrapper exists instead of calling `usePreventScreenCapture` directly:
//  - Several screens may want protection at once (chat A -> chat B, or a future screen). Each caller gets
//    its own holder; protection stays on until the LAST holder releases, and releasing twice is harmless.
//  - expo-screen-capture remembers a key as "active" before the native call finishes. If that native call
//    fails (for example no activity is attached yet), the key stays recorded and every later attempt is a
//    silent no-op. This module clears the stale key and retries a few times.
//  - Native calls are issued one at a time and always apply the state wanted at that moment, so a quick
//    leave/enter cannot be reordered into "allowed" while a chat is open.
//  - FLAG_SECURE belongs to one Activity window. When the app returns to the foreground it is applied
//    again, in case Android recreated the activity (font size or language change) while a chat was open.
//
// Android only. On iOS and web this is a deliberate no-op (expo-screen-capture can only block screen
// recording on iOS, not screenshots, so it would give a false sense of protection).

const KEY_PREFIX = "chahat-screen-protection";
const RETRY_DELAYS_MS = [400, 1500];

type Subscription = { remove(): void };

let nextHolderId = 1;
const holders = new Set<number>();

/** Key currently registered with expo-screen-capture; null while protection is off. */
let nativeKey: string | null = null;
let keyGeneration = 0;
/** Set after a failure or a foreground return: re-run the native "prevent" even if we think it is on. */
let reassertRequested = false;
let failures = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let queue: Promise<void> = Promise.resolve();
let appStateSubscription: Subscription | null = null;

async function applyDesiredState(): Promise<void> {
  // Read the wanted state when this step runs, not when it was queued, so bursts collapse into one call.
  const wanted = holders.size > 0;
  try {
    if (wanted) {
      const reassert = reassertRequested;
      reassertRequested = false;
      if (nativeKey === null || reassert) {
        const previous = nativeKey;
        const next = `${KEY_PREFIX}:${++keyGeneration}`;
        try {
          await ScreenCapture.preventScreenCaptureAsync(next);
        } catch (error) {
          // The library already recorded `next` as active; forget it so that a retry reaches the native module.
          await ScreenCapture.allowScreenCaptureAsync(next).catch(() => undefined);
          throw error;
        }
        nativeKey = next;
        // Swap keys instead of allow-then-prevent so capture is never allowed in between.
        if (previous !== null) await ScreenCapture.allowScreenCaptureAsync(previous);
      }
    } else if (nativeKey !== null) {
      const key = nativeKey;
      await ScreenCapture.allowScreenCaptureAsync(key);
      nativeKey = null;
    }
    failures = 0;
  } catch (error) {
    handleFailure(error);
  }
}

function handleFailure(error: unknown): void {
  reassertRequested = true;
  if (failures >= RETRY_DELAYS_MS.length) {
    console.warn(
      "Screen protection could not be updated:",
      error instanceof Error ? error.message : "unknown error",
    );
    return;
  }
  const delay = RETRY_DELAYS_MS[failures]!;
  failures += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    schedule(false);
  }, delay);
}

/** `external` = a new acquire/release/foreground event, which earns a fresh set of retries. */
function schedule(external: boolean): void {
  if (external) {
    failures = 0;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }
  queue = queue.then(applyDesiredState);
}

function startAppStateWatch(): void {
  if (appStateSubscription) return;
  appStateSubscription = AppState.addEventListener("change", (state: AppStateStatus) => {
    if (state === "active" && holders.size > 0) {
      reassertRequested = true;
      schedule(true);
    }
  });
}

function stopAppStateWatch(): void {
  appStateSubscription?.remove();
  appStateSubscription = null;
}

/**
 * Turns protection on and returns a function that gives this holder's claim back.
 * Protection stays on while at least one holder is outstanding. The returned function is idempotent.
 */
export function acquireScreenProtection(): () => void {
  if (Platform.OS !== "android") return () => undefined;

  const id = nextHolderId++;
  holders.add(id);
  startAppStateWatch();
  schedule(true);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders.delete(id);
    if (holders.size === 0) stopAppStateWatch();
    schedule(true);
  };
}

/** Number of outstanding holders (diagnostics and tests). */
export function screenProtectionHolderCount(): number {
  return holders.size;
}
