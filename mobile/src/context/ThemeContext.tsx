import React, { createContext, useContext, useEffect, useState, useMemo } from "react";
import { useColorScheme as useDeviceColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LightColors, DarkColors, ThemeColors } from "../constants/theme";

export type ThemeMode = "system" | "light" | "dark";

interface ThemeContextType {
  mode: ThemeMode;
  isDark: boolean;
  colors: ThemeColors;
  setMode: (mode: ThemeMode) => Promise<void>;
}

const THEME_STORAGE_KEY = "@chahat_theme_mode";

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
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (saved === "light" || saved === "dark" || saved === "system") {
          setModeState(saved);
        }
      } catch (e) {
        console.warn("Failed to load theme preference:", e);
      } finally {
        setIsLoaded(true);
      }
    })();
  }, []);

  const setMode = async (newMode: ThemeMode) => {
    setModeState(newMode);
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, newMode);
    } catch (e) {
      console.warn("Failed to save theme preference:", e);
    }
  };

  const isDark = useMemo(() => {
    if (mode === "dark") return true;
    if (mode === "light") return false;
    return deviceColorScheme === "dark";
  }, [mode, deviceColorScheme]);

  const colors = useMemo(() => {
    return isDark ? DarkColors : LightColors;
  }, [isDark]);

  return (
    <ThemeContext.Provider value={{ mode, isDark, colors, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
