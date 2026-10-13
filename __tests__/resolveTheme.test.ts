import { resolveIsDark, isThemeMode, THEME_STORAGE_KEY } from "../mobile/src/utils/resolveTheme";

describe("resolveIsDark", () => {
  it("System Default follows the device appearance", () => {
    expect(resolveIsDark("system", "dark")).toBe(true);
    expect(resolveIsDark("system", "light")).toBe(false);
    expect(resolveIsDark("system", null)).toBe(false);
    expect(resolveIsDark("system", undefined)).toBe(false);
  });

  it("forced Light ignores the device appearance", () => {
    expect(resolveIsDark("light", "dark")).toBe(false);
    expect(resolveIsDark("light", "light")).toBe(false);
  });

  it("forced Dark ignores the device appearance", () => {
    expect(resolveIsDark("dark", "light")).toBe(true);
    expect(resolveIsDark("dark", null)).toBe(true);
  });

  it("System Default updates when the device appearance changes", () => {
    expect(resolveIsDark("system", "light")).toBe(false);
    expect(resolveIsDark("system", "dark")).toBe(true);
  });
});

describe("isThemeMode", () => {
  it("accepts only valid saved values", () => {
    expect(isThemeMode("system")).toBe(true);
    expect(isThemeMode("light")).toBe(true);
    expect(isThemeMode("dark")).toBe(true);
    expect(isThemeMode("auto")).toBe(false);
    expect(isThemeMode(null)).toBe(false);
  });

  it("keeps the existing storage key so saved preferences survive the update", () => {
    expect(THEME_STORAGE_KEY).toBe("@chahat_theme_mode");
  });
});
