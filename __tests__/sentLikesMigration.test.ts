import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "..");
const sql = fs.readFileSync(
  path.join(root, "supabase/migrations/20260101005400_get_my_sent_likes.sql"),
  "utf8",
);

describe("get_my_sent_likes migration (static checks)", () => {
  it("decides entitlement on the server and rejects free members", () => {
    expect(sql).toMatch(/get_active_subscription_tier\(_uid\) NOT IN \('premium', 'plus', 'vip'\)/);
    expect(sql).toMatch(/RAISE EXCEPTION 'upgrade_required' USING ERRCODE = '42501'/);
    expect(sql).not.toMatch(/raw_user_meta_data|app_metadata|jwt/i);
  });
  it("only ever reads the caller's own outgoing likes (no user id parameter)", () => {
    expect(sql).toMatch(/_uid text := auth\.uid\(\)::text/);
    expect(sql).toMatch(/WHERE s\.from_id = _uid/);
    expect(sql).toMatch(/get_my_sent_likes\(\s*_limit integer DEFAULT 50,\s*_before timestamptz DEFAULT NULL\s*\)/);
  });
  it("hides blocked, inactive, not-onboarded and demo profiles", () => {
    expect(sql).toMatch(/NOT public\._pair_blocked\(_uid, s\.to_id\)/);
    expect(sql).toMatch(/p\.is_demo = false AND p\.status = 'active' AND p\.onboarded/);
  });
  it("uses the photo visibility filter and bounds the page size", () => {
    expect(sql).toMatch(/public\.public_photos\(p\.id, p\.photos\)/);
    expect(sql).toMatch(/_limit < 1 OR _limit > 100/);
  });
  it("is callable by signed-in users only, and changes no table or policy", () => {
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.get_my_sent_likes\(integer, timestamptz\) FROM PUBLIC, anon/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_my_sent_likes\(integer, timestamptz\) TO authenticated/);
    expect(sql).not.toMatch(/CREATE POLICY|ALTER TABLE|DROP |INSERT INTO|UPDATE public|DELETE FROM/);
  });
  it("sorts after every earlier migration", () => {
    const files = fs.readdirSync(path.join(root, "supabase/migrations")).sort();
    const me = "20260101005400_get_my_sent_likes.sql";
    expect(files.indexOf(me)).toBeGreaterThan(-1);
    expect(files.slice(files.indexOf(me) + 1).every((f) => f > me)).toBe(true);
  });
});
