import { useCallback } from "react";
import { useFocusEffect } from "expo-router";
import { acquireScreenProtection } from "../services/screenProtection";

/**
 * Blocks screenshots and screen recording (Android) while this screen is focused.
 *
 * Protection is released when the screen loses focus (another screen is pushed on top, a call opens),
 * when it unmounts (back navigation, sign-out) and when a render error tears the screen down, because
 * `useFocusEffect` runs its cleanup in all of those cases. Pass `enabled = false` to switch it off.
 */
export function useScreenProtection(enabled: boolean = true): void {
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return undefined;
      return acquireScreenProtection();
    }, [enabled]),
  );
}
