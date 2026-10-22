import fs from "fs";
import path from "path";

const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

describe("premium delivers what it promises", () => {
  it("turns Google Play billing on in every build profile", () => {
    const eas = JSON.parse(read("mobile/eas.json"));
    for (const [name, profile] of Object.entries<any>(eas.build)) {
      expect({ name, billing: profile.env?.EXPO_PUBLIC_FEATURE_BILLING }).toEqual({ name, billing: "true" });
    }
  });

  it("does not advertise features that are not implemented", () => {
    const plans = read("mobile/src/services/subscription.ts");
    const screen = read("mobile/app/premium/index.tsx");
    for (const promise of ["Incognito", "Advanced Search Filters", "Priority Match Distribution", "Priority Profile Visibility"]) {
      expect(plans).not.toContain(promise);
      expect(screen).not.toContain(promise);
    }
  });

  it("exempts active paid plans from the daily like limit on the server", () => {
    const sql = read("supabase/migrations/20260101005100_paid_plans_unlimited_likes.sql");
    expect(sql).toMatch(/get_active_subscription_tier\(_from_id\) IN \('premium', 'plus', 'vip'\)/);
    expect(sql).toMatch(/NOT _paid AND _likes >= _like_limit/);
    expect(sql).toMatch(/'unlimited', true/);
  });

  it("re-syncs the plan when the app returns to the foreground and after a purchase", () => {
    expect(read("mobile/src/context/MiloContext.tsx")).toMatch(/AppState\.addEventListener/);
    expect(read("mobile/app/premium/index.tsx")).toMatch(/refreshSubscription\(\)/);
  });
});
