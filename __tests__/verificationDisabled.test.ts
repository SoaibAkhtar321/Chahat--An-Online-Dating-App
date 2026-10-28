// Selfie verification is OFF for launch (no reviewer yet): no entry point, promise or badge may show unless the
// EXPO_PUBLIC_FEATURE_VERIFICATION switch is on. The server side stays (tests 76/77).
import fs from "fs";
import path from "path";

const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

describe("verification switched off", () => {
  it("defaults to off and every build profile keeps it off", () => {
    expect(read("mobile/src/constants/features.ts")).toMatch(
      /VERIFICATION_ENABLED = process\.env\.EXPO_PUBLIC_FEATURE_VERIFICATION === "true"/,
    );
    const eas = JSON.parse(read("mobile/eas.json"));
    for (const profile of Object.values<{ env?: Record<string, string> }>(eas.build)) {
      if (profile.env?.EXPO_PUBLIC_FEATURE_BILLING) expect(profile.env.EXPO_PUBLIC_FEATURE_VERIFICATION).toBe("false");
    }
  });

  it("every link to the verification screen and every badge is behind the switch", () => {
    for (const f of [
      "mobile/app/(tabs)/me.tsx",
      "mobile/app/safety/index.tsx",
      "mobile/app/settings/index.tsx",
      "mobile/app/profile/[id].tsx",
      "mobile/app/explore/index.tsx",
      "mobile/src/components/discovery/DiscoveryCard.tsx",
      "mobile/app/verification/index.tsx",
    ]) {
      expect(read(f)).toMatch(/VERIFICATION_ENABLED/);
    }
    expect(read("mobile/app/verification/index.tsx")).toMatch(/<Redirect href="\/\(tabs\)\/me"/);
  });

  it("no unconditional verification promises remain", () => {
    expect(read("mobile/app/premium/index.tsx")).not.toMatch(/Selfie verification|identity verification/);
    expect(read("mobile/app/(auth)/welcome.tsx")).not.toMatch(/verified members/);
    expect(read("mobile/src/services/subscription.ts")).toMatch(/VERIFICATION_ENABLED \? \["Selfie verification badge"\]/);
  });

  it("free plan card omits the badge while off", () => {
    jest.isolateModules(() => {
      jest.doMock("../mobile/src/services/supabase", () => ({ supabase: {}, isSupabaseConfigured: () => false }));
      jest.doMock("expo-crypto", () => ({}));
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { PLANS } = require("../mobile/src/services/subscription");
      expect(PLANS.free.features.join(" ")).not.toMatch(/verification/i);
    });
  });
});
