import { useCallback } from "react";
import { BackHandler } from "react-native";
import { useFocusEffect } from "expo-router";

/**
 * Registers an Android hardware/gesture back handler while the screen is focused.
 * The handler returns true when it handled the event (default navigation is skipped) and false to
 * let React Navigation pop the screen. The listener is always removed on blur/unmount, so it can
 * never swallow back presses on other screens.
 */
export function useHardwareBack(handler: () => boolean, enabled: boolean = true): void {
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return undefined;
      const sub = BackHandler.addEventListener("hardwareBackPress", handler);
      return () => sub.remove();
    }, [handler, enabled]),
  );
}
