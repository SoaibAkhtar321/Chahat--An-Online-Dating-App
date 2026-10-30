// Admin panel expansion (2026-10-30): sponsored cards in Discover, suspension screen, offers opt-out, purchase
// attempt logging. Server side: supabase/tests/85_admin_controls.sql.
import fs from "fs";
import path from "path";

jest.mock("../mobile/src/services/supabase", () => ({ supabase: {}, isSupabaseConfigured: () => false }));
import { parseAds, AD_EVERY_SWIPES } from "../mobile/src/services/adminContent";

const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

describe("sponsored cards", () => {
  it("parses ads, builds public image URLs and only keeps https links", () => {
    const ads = parseAds(
      [
        { id: "a1", advertiser: "Acme", title: "Hi", body: "b", image_path: "creatives/x.jpg", cta_label: "Shop", cta_url: "https://acme.in" },
        { id: "a2", advertiser: "Bad", title: "Yo", cta_url: "javascript:alert(1)" },
        { nope: true },
      ],
      (p) => `https://cdn/${p}`,
    );
    expect(ads).toHaveLength(2);
    expect(ads[0]).toMatchObject({ imageUrl: "https://cdn/creatives/x.jpg", ctaUrl: "https://acme.in", ctaLabel: "Shop" });
    expect(ads[1].ctaUrl).toBeNull();
    expect(ads[1].ctaLabel).toBe("Learn more");
    expect(parseAds(null, (p) => p)).toEqual([]);
  });
  it("appear between profiles, are labelled Sponsored, and a swipe on them never records a like", () => {
    expect(AD_EVERY_SWIPES).toBeGreaterThanOrEqual(5);
    const discover = read("mobile/app/(tabs)/discover.tsx");
    expect(discover).toMatch(/if \(currentAd\) \{\s+setAdQueue\(\(q\) => q\.slice\(1\)\);\s+setSwipesSinceAd\(0\);\s+return;/);
    expect(read("mobile/src/components/discovery/AdCard.tsx")).toMatch(/>Sponsored</);
  });
});

describe("suspension", () => {
  it("suspended members see the suspended screen instead of the app", () => {
    expect(read("mobile/app/(tabs)/_layout.tsx")).toMatch(/<SuspendedGate>/);
    expect(read("mobile/src/components/account/SuspendedGate.tsx")).toMatch(/Your account is suspended/);
  });
});

describe("offers & announcements opt-out", () => {
  it("settings has the toggle and saves it", () => {
    const s = read("mobile/app/settings/index.tsx");
    expect(s).toMatch(/label="Offers & announcements"/);
    expect(s).toMatch(/setUpdatesPreference\(user\.id, v\)/);
  });
});

describe("purchase attempts", () => {
  it("verify-purchase logs every attempt without the token and never changes the response", () => {
    const fn = read("supabase/functions/verify-purchase/index.ts");
    expect(fn).toMatch(/await logAttempt\(ctx, response\);\s+return response;/);
    const log = fn.slice(fn.indexOf("async function logAttempt"), fn.indexOf("Deno.serve"));
    expect(log).not.toMatch(/purchaseToken|token_hash/);
  });
});
