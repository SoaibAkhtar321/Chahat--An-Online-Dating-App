import fs from "fs";
import path from "path";

const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

// profiles only allows SELECT on an explicit column list. Selecting any other column fails the whole query with
// "permission denied", which blocks every member from loading their profile.
describe("profile load only selects readable columns", () => {
  it("selects only columns granted to authenticated", () => {
    const grantSql = read("supabase/migrations/20260101000500_privacy_and_rate_limits.sql");
    const grant = grantSql.match(/GRANT SELECT \(([^)]*)\)\s+ON public\.profiles TO authenticated/);
    expect(grant).not.toBeNull();
    const granted = new Set(grant![1]!.split(",").map((c) => c.trim()));

    const service = read("mobile/src/services/profile.ts");
    const select = service.match(/\.from\("profiles"\)\s*\.select\(\s*"([^"]+)"/);
    expect(select).not.toBeNull();
    const requested = select![1]!.split(",").map((c) => c.trim());
    expect(requested.filter((c) => !granted.has(c))).toEqual([]);
  });
});
