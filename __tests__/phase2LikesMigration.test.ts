import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const sql = read("supabase/migrations/20260101003800_phase2_premium_likes_flow.sql");

describe("Phase 2 migration (static checks; behaviour is covered by supabase/tests/57_push_phase2_likes.sql)", () => {
  it("sorts after every earlier migration (later phases may follow it)", () => {
    const files = fs.readdirSync(path.join(root, "supabase/migrations")).sort();
    const phase2 = "20260101003800_phase2_premium_likes_flow.sql";
    expect(files.indexOf(phase2)).toBeGreaterThan(-1);
    expect(files.slice(files.indexOf(phase2) + 1).every((f) => f > phase2)).toBe(true);
    expect(files.filter((f) => f < phase2).length).toBe(files.indexOf(phase2));
  });
  it("drops the raw RLS policy so received likes cannot be read directly", () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS "paid members read received likes" ON public\.swipes/);
    expect(sql).not.toMatch(/CREATE POLICY[^;]*ON public\.swipes/);
  });
  it("gates identities on the server subscription tier, never a client flag", () => {
    expect(sql).toMatch(/get_active_subscription_tier\(_uid\) NOT IN \('premium', 'plus', 'vip'\)/);
    expect(sql).toMatch(/RAISE EXCEPTION 'upgrade_required'/);
    expect(sql).not.toMatch(/likes_you|raw_user_meta_data|app_metadata|jwt/i);
  });
  it("returns no count to free members from the access RPC", () => {
    const access = sql.slice(sql.indexOf("FUNCTION public.get_my_likes_access"), sql.indexOf("FUNCTION public.get_incoming_likes_count"));
    // the not-entitled branch returns before any count query and carries no count key
    const freeBranch = access.slice(access.indexOf("NOT IN"), access.indexOf("SELECT count(*)"));
    expect(freeBranch).toMatch(/jsonb_build_object\('eligible', false\)/);
    expect(freeBranch).not.toMatch(/count/);
    expect(access).toMatch(/jsonb_build_object\('eligible', true, 'count'/);
  });
  it("gates the legacy get_incoming_likes_count() that was open to every member", () => {
    const legacy = sql.slice(sql.indexOf("FUNCTION public.get_incoming_likes_count"), sql.indexOf("-- ---------- 3."));
    expect(legacy).toMatch(/NOT IN \('premium', 'plus', 'vip'\)/);
    expect(legacy).toMatch(/RAISE EXCEPTION 'upgrade_required'/);
    expect(legacy).toMatch(/_like_is_valid/);
  });
  it("keeps the validity rule internal and uses it everywhere", () => {
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\._like_is_valid\(text, text\)\s+FROM PUBLIC, anon, authenticated, service_role/,
    );
    expect(sql).toMatch(/_pair_blocked/);
    expect((sql.match(/_like_is_valid\(/g) || []).length).toBeGreaterThanOrEqual(6);
  });
  it("exposes the RPCs to authenticated users only", () => {
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_received_likes\(integer, timestamptz\) TO authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_my_likes_access\(\) TO authenticated/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.get_received_likes\(integer, timestamptz\) FROM PUBLIC, anon/);
  });
  it("de-duplicates like events on a deterministic key", () => {
    expect(sql).toMatch(/ON CONFLICT \(recipient_id, category, event_id\) DO NOTHING/);
  });
  it("suppresses invalid likes at delivery time and keeps claim service-role-only", () => {
    expect(sql).toMatch(/LikeNoLongerValid/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.claim_push_deliveries\(integer\) TO service_role/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.claim_push_deliveries\(integer\) FROM PUBLIC, anon, authenticated/);
  });
});
