import { spawnSync } from "child_process";
import path from "path";

const script = path.join(__dirname, "..", "mobile", "scripts", "check-release-env.js");

function run(env: Record<string, string>) {
  return spawnSync(process.execPath, [script], {
    env: { PATH: process.env.PATH ?? "", ...env },
    encoding: "utf8",
  });
}

describe("check-release-env guard", () => {
  it("does not block non-production profiles", () => {
    expect(run({ EAS_BUILD_PROFILE: "preview" }).status).toBe(0);
    expect(run({}).status).toBe(0);
  });

  it("blocks a production build with missing variables", () => {
    const result = run({ EAS_BUILD_PROFILE: "production" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("EXPO_PUBLIC_SUPABASE_URL");
  });

  it("blocks placeholder values in production", () => {
    const result = run({
      EAS_BUILD_PROFILE: "production",
      EXPO_PUBLIC_SUPABASE_URL: "https://your-project-id.supabase.co",
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_real",
    });
    expect(result.status).toBe(1);
  });

  it("passes a production build with real values", () => {
    const result = run({
      EAS_BUILD_PROFILE: "production",
      EXPO_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_real",
    });
    expect(result.status).toBe(0);
  });

  const prod = {
    EAS_BUILD_PROFILE: "production",
    EXPO_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_real",
  };

  it("blocks production calls without a valid Agora App ID", () => {
    const missing = run({ ...prod, EXPO_PUBLIC_FEATURE_CALLS: "true" });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("EXPO_PUBLIC_AGORA_APP_ID");
    expect(run({ ...prod, EXPO_PUBLIC_FEATURE_CALLS: "true", EXPO_PUBLIC_AGORA_APP_ID: "not-an-id" }).status).toBe(1);
    expect(
      run({ ...prod, EXPO_PUBLIC_FEATURE_CALLS: "true", EXPO_PUBLIC_AGORA_APP_ID: "cca3243cc46c465a9081506d0cfbe08f" }).status,
    ).toBe(0);
  });

  it("blocks a secret or service-role key in the public key variable", () => {
    expect(run({ ...prod, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_abc" }).status).toBe(1);
    const payload = Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url");
    expect(run({ ...prod, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: `eyJhbGciOiJIUzI1NiJ9.${payload}.sig` }).status).toBe(1);
  });
});
