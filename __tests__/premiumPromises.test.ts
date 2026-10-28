// Premium promise audit (2026-10-29): the plan screen may only promise what the server enforces.
// Server side of each promise: supabase/tests/80_premium_promises.sql.
jest.mock("../mobile/src/services/supabase", () => ({ supabase: {}, isSupabaseConfigured: () => false }));
jest.mock("expo-crypto", () => ({}));
import fs from "fs";
import path from "path";
import { PLANS, hasEntitlement } from "../mobile/src/services/subscription";

const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

describe("Premium promises", () => {
  it("plan cards list exactly the server-checked benefits", () => {
    expect(PLANS.premium.features).toEqual([
      "Unlimited Likes",
      "5 minutes/day video calling",
      "See who liked you",
      "See the profiles you liked",
      "Rewind profiles you passed",
    ]);
    expect(PLANS.plus.features).toEqual(["All Premium features", "Read receipts: see when your messages are read"]);
    expect(PLANS.vip.features).toEqual(["All Plus features"]);
  });

  it("no screen promises features that do not exist", () => {
    const premium = read("mobile/app/premium/index.tsx");
    const me = read("mobile/app/(tabs)/me.tsx");
    const plans = JSON.stringify(PLANS);
    for (const text of [premium, plans]) {
      expect(text).not.toMatch(/priority recommendation|boost|incognito|advanced filter|icebreaker|compatibility|VIP badge/i);
    }
    // 1 month is not the best value (2 months costs less per month), and no hard-coded old price.
    expect(premium).not.toMatch(/BEST VALUE/);
    expect(me).not.toMatch(/₹99/);
    // Prepaid plans cannot be cancelled; do not suggest a cancellation.
    expect(premium).not.toMatch(/Manage or cancel/);
  });

  it("client entitlement matrix matches the server", () => {
    expect(hasEntitlement("free", "seeWhoLikedYou")).toBe(false);
    expect(hasEntitlement("free", "undoPass")).toBe(false);
    expect(hasEntitlement("free", "readReceipts")).toBe(false);
    expect(hasEntitlement("premium", "seeWhoLikedYou")).toBe(true);
    expect(hasEntitlement("premium", "undoPass")).toBe(true);
    expect(hasEntitlement("premium", "readReceipts")).toBe(false);
    for (const tier of ["plus", "vip"] as const) {
      expect(hasEntitlement(tier, "seeWhoLikedYou")).toBe(true);
      expect(hasEntitlement(tier, "undoPass")).toBe(true);
      expect(hasEntitlement(tier, "readReceipts")).toBe(true);
    }
  });
});
