export type ThemeMode = "system" | "light" | "dark";
export type DeviceScheme = "light" | "dark" | null | undefined;

export const THEME_STORAGE_KEY = "@chahat_theme_mode";

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

/** Whether the rendered theme is dark for a given preference and device appearance. */
export function resolveIsDark(mode: ThemeMode, deviceScheme: DeviceScheme): boolean {
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return deviceScheme === "dark";
}
