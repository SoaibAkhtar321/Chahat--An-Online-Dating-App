import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from "react";
import { View, useColorScheme as useDeviceColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LightColors, DarkColors, ThemeColors } from "../constants/theme";
import {
  ThemeMode,
  THEME_STORAGE_KEY,
  isThemeMode,
  resolveIsDark,
} from "../utils/resolveTheme";

export type { ThemeMode } from "../utils/resolveTheme";

interface ThemeContextType {
  mode: ThemeMode;
  isDark: boolean;
  colors: ThemeColors;
  setMode: (mode: ThemeMode) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextType>({
  mode: "system",
  isDark: false,
  colors: LightColors,
  setMode: async () => {},
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const deviceColorScheme = useDeviceColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (!cancelled && isThemeMode(saved)) {
          setModeState(saved);
        }
      } catch (e) {
        console.warn("Failed to load theme preference:", e);
      } finally {
        if (!cancelled) setIsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = useCallback(async (newMode: ThemeMode) => {
    setModeState(newMode);
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, newMode);
    } catch (e) {
      console.warn("Failed to save theme preference:", e);
    }
  }, []);

  const isDark = useMemo(() => resolveIsDark(mode, deviceColorScheme), [mode, deviceColorScheme]);
  const colors = isDark ? DarkColors : LightColors;

  const value = useMemo(
    () => ({ mode, isDark, colors, setMode }),
    [mode, isDark, colors, setMode],
  );

  // Hold rendering until the saved preference is read so the wrong theme never flashes.
  if (!isLoaded) {
    const fallback = resolveIsDark("system", deviceColorScheme) ? DarkColors : LightColors;
    return <View style={{ flex: 1, backgroundColor: fallback.background }} />;
  }

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => useContext(ThemeContext);
