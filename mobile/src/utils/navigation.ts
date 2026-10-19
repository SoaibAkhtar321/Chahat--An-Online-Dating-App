// One place for "go back" so every back control behaves the same as Android hardware/gesture back.
// If there is no previous route (cold start from a notification or deep link), fall back to a safe
// parent screen instead of doing nothing or closing the app.
export interface BackRouter {
  canGoBack: () => boolean;
  back: () => void;
  replace: (href: any) => void;
}

export const DEFAULT_BACK_FALLBACK = "/(tabs)/discover";

export function safeBack(router: BackRouter, fallback: string = DEFAULT_BACK_FALLBACK): void {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace(fallback);
  }
}

/** True when two JSON-serialisable values differ; used for "unsaved changes" checks. */
export function hasUnsavedChanges(initial: unknown, current: unknown): boolean {
  return JSON.stringify(initial) !== JSON.stringify(current);
}
