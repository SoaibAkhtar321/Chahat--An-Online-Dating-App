import {
  getMissingConfig,
  readPublicEnv,
  getServiceStatus,
  isServiceConfigured,
} from "../mobile/src/config/appConfig";

describe("appConfig", () => {
  it("reports everything missing for an empty environment without throwing", () => {
    const status = getServiceStatus({});
    expect(status.supabase.configured).toBe(false);
    expect(status.supabase.missing).toEqual([
      "EXPO_PUBLIC_SUPABASE_URL",
      "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    ]);
    expect(status.billing.configured).toBe(false);
    // Push is on by default (users still opt in via the consent notice and OS permission).
    expect(status.push.configured).toBe(true);
    expect(status.calls.configured).toBe(false);
    expect(status.voiceMessages.configured).toBe(false);
    expect(status.coinTopup.configured).toBe(false);
  });

  it("treats placeholder Supabase values as not configured", () => {
    const status = getServiceStatus({
      EXPO_PUBLIC_SUPABASE_URL: "https://your-project-id.supabase.co",
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "your-supabase-publishable-key",
    });
    expect(status.supabase.configured).toBe(false);
  });

  it("accepts real Supabase values and the legacy anon key name", () => {
    expect(
      isServiceConfigured("supabase", {
        EXPO_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
      }),
    ).toBe(true);
    expect(
      isServiceConfigured("supabase", {
        EXPO_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
        EXPO_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
      }),
    ).toBe(true);
  });

  it("enables a feature only for the exact value true", () => {
    expect(isServiceConfigured("calls", { EXPO_PUBLIC_FEATURE_CALLS: "true" })).toBe(true);
    expect(isServiceConfigured("calls", { EXPO_PUBLIC_FEATURE_CALLS: " true " })).toBe(true);
    expect(isServiceConfigured("calls", { EXPO_PUBLIC_FEATURE_CALLS: "TRUE" })).toBe(false);
    expect(isServiceConfigured("calls", { EXPO_PUBLIC_FEATURE_CALLS: "True" })).toBe(false);
    expect(isServiceConfigured("calls", { EXPO_PUBLIC_FEATURE_CALLS: "1" })).toBe(false);
    expect(isServiceConfigured("calls", { EXPO_PUBLIC_FEATURE_CALLS: "false" })).toBe(false);
    expect(isServiceConfigured("push", { EXPO_PUBLIC_FEATURE_CALLS: "true" })).toBe(true);
    expect(isServiceConfigured("push", { EXPO_PUBLIC_FEATURE_PUSH: "false" })).toBe(false);
    expect(isServiceConfigured("push", {})).toBe(true);
  });

  it("lists missing keys across services", () => {
    const missing = getMissingConfig({ EXPO_PUBLIC_FEATURE_PUSH: "true" });
    expect(missing).toContain("EXPO_PUBLIC_SUPABASE_URL");
    expect(missing).toContain("EXPO_PUBLIC_FEATURE_CALLS");
    expect(missing).not.toContain("EXPO_PUBLIC_FEATURE_PUSH");
  });

  it("reads every public variable by literal reference so Expo can inline it", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const source: string = require("fs").readFileSync(
      require("path").join(__dirname, "..", "mobile", "src", "config", "appConfig.ts"),
      "utf8",
    );
    for (const name of [
      "EXPO_PUBLIC_SUPABASE_URL",
      "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "EXPO_PUBLIC_FEATURE_BILLING",
      "EXPO_PUBLIC_FEATURE_PUSH",
      "EXPO_PUBLIC_FEATURE_CALLS",
      "EXPO_PUBLIC_FEATURE_VOICE_MESSAGES",
      "EXPO_PUBLIC_FEATURE_COIN_TOPUP",
    ]) {
      expect(source).toContain(`process.env.${name}`);
    }
    expect(source).not.toMatch(/env: EnvSource = process\.env/);
    expect(typeof readPublicEnv()).toBe("object");
  });
});
