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
});
