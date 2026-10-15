import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Phase 7-9 lifecycle and release safeguards", () => {
  const migration = read("supabase/migrations/20260101002200_lifecycle_entitlements_release.sql");

  it("exposes quota only for the authenticated caller and follows app_settings", () => {
    expect(migration).toMatch(/FUNCTION public\.get_daily_like_quota\(\)/);
    expect(migration).toMatch(/setting_int\('daily_like_limit', 20\)/);
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_daily_like_quota\(\) TO authenticated/,
    );
  });

  it("restricts pending-deletion state and purge functions to service_role", () => {
    expect(migration).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.begin_account_deletion\(uuid\).*authenticated/s,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.begin_account_deletion\(uuid\) TO service_role/,
    );
    expect(migration).toMatch(/Account deletion is pending/);
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.purge_user_data\(uuid\) TO service_role/,
    );
  });

  it("keeps transaction evidence while detaching it from a deleted Auth user", () => {
    expect(migration).toMatch(/ALTER COLUMN user_id DROP NOT NULL/);
    expect(migration).toMatch(/ON DELETE SET NULL/);
    expect(migration).toMatch(/UPDATE public\.subscription_orders SET user_id = NULL/);
  });

  it("uses an integer row count for undo-pass success", () => {
    expect(migration).toMatch(/_deleted_count integer := 0/);
    expect(migration).toMatch(/GET DIAGNOSTICS _deleted_count = ROW_COUNT/);
    expect(migration).not.toMatch(/GET DIAGNOSTICS _deleted = ROW_COUNT/);
  });

  it("keeps purchase verification fail closed until a provider verifier exists", () => {
    const endpoint = read("supabase/functions/verify-purchase/index.ts");
    expect(endpoint).toMatch(/response\(503/);
    expect(endpoint).not.toMatch(/createClient|SUPABASE_SERVICE_ROLE_KEY|record_verified_purchase/);
    expect(read("mobile/src/services/subscription.ts")).toMatch(
      /Purchase verification is disabled/,
    );
  });

  it("preserves the Android app identity and scopes production build credentials", () => {
    const app = JSON.parse(read("mobile/app.json"));
    const eas = JSON.parse(read("mobile/eas.json"));
    expect(app.expo.android.package).toBe("com.milo.dating");
    expect(app.expo.extra.eas.projectId).toBe("d40a4e1f-fbf8-4b44-93af-7c4e1fe39b8a");
    expect(eas.build.production.environment).toBe("production");
    expect(eas.build.production.autoIncrement).toBe(true);
    expect(read(".gitignore")).toMatch(/service-account\*\.json/);
  });

  it("configures the in-app auth callback and excludes fake push tokens", () => {
    expect(read("supabase/config.toml")).toMatch(
      /additional_redirect_urls = \[.*milo:\/\/callback/,
    );
    expect(read("mobile/src/services/notifications.ts")).not.toMatch(
      /fcm_mock|Math\.random\(\).*token/,
    );
  });
});
