// Daily video-call allowance (30 s free / 300 s paid, IST) and Premium rewind hardening (20260101005800).
// Client mapping of get_my_video_call_allowance + static checks on the migration. Behaviour is proven in
// supabase/tests/72_call_allowance_hardening.sql (boundaries, IST reset, join-grant clock, rewind eligibility).
import fs from "fs";
import path from "path";

const mockRpc = jest.fn();
jest.mock("../mobile/src/services/supabase", () => ({
  isSupabaseConfigured: () => true,
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

import { getUserVideoCallAllowance, PLANS } from "../mobile/src/services/subscription";

const root = path.join(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260101005800_call_allowance_hardening_and_rewind.sql"),
  "utf8",
);

describe("getUserVideoCallAllowance", () => {
  beforeEach(() => mockRpc.mockReset());

  it("calls the server RPC with no client-supplied identity or plan", async () => {
    mockRpc.mockResolvedValue({
      data: { valid: true, tier: "free", is_free: true, daily_limit_seconds: 30, seconds_remaining: 12,
        status: "available", next_renewal_at: "2026-10-28T18:30:00Z", active_call_id: null },
      error: null,
    });
    const out = await getUserVideoCallAllowance();
    expect(mockRpc).toHaveBeenCalledWith("get_my_video_call_allowance");
    expect(out).toMatchObject({ isFree: true, dailyLimitSeconds: 30, secondsRemaining: 12, status: "available" });
  });

  it("maps a paid plan to 300 s", async () => {
    mockRpc.mockResolvedValue({
      data: { valid: true, tier: "vip", is_free: false, daily_limit_seconds: 300, seconds_remaining: 0, status: "exhausted" },
      error: null,
    });
    expect(await getUserVideoCallAllowance()).toMatchObject({ isFree: false, dailyLimitSeconds: 300, status: "exhausted" });
  });

  it("fails closed (invalid, nothing remaining) when the server cannot be read", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await getUserVideoCallAllowance()).toMatchObject({ valid: false, secondsRemaining: 0, status: "exhausted" });
  });

  it("advertises the 30 s free allowance", () => {
    expect(PLANS.free.features.join(" ")).toMatch(/30 seconds of free video calling per day/);
  });
});

describe("20260101005800 migration (static)", () => {
  it("sets the free daily allowance to 30 s and keeps premium at 300 s", () => {
    expect(migration).toMatch(/\('call_free_daily_seconds', '30'::jsonb\)\s*ON CONFLICT \(key\) DO UPDATE/);
    expect(migration).toMatch(/'call_premium_daily_seconds', 300/);
  });
  it("uses the IST day for usage and renewal", () => {
    expect(migration).toMatch(/timezone\('Asia\/Kolkata', now\(\)\)::date\)::timestamp AT TIME ZONE 'Asia\/Kolkata'/);
  });
  it("keeps every existing RPC signature and grant", () => {
    expect(migration).toMatch(/FUNCTION public\.get_call_join_context\(_call_id uuid, _user_id uuid\)/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_call_join_context\(uuid, uuid\) TO service_role;/);
    expect(migration).toMatch(/REVOKE EXECUTE ON FUNCTION public\.get_call_join_context\(uuid, uuid\) FROM PUBLIC, anon, authenticated;/);
    expect(migration).toMatch(/FUNCTION public\.mark_call_connected\(_call_id uuid\)/);
    expect(migration).toMatch(/FUNCTION public\.undo_swipe_pass\(_target_id text\)/);
    expect(migration).toMatch(/REVOKE EXECUTE ON FUNCTION public\.get_my_video_call_allowance\(\) FROM PUBLIC, anon;/);
  });
  it("every SECURITY DEFINER function pins search_path", () => {
    const defs = migration.split(/CREATE OR REPLACE FUNCTION/).slice(1);
    for (const def of defs) {
      if (/SECURITY DEFINER/.test(def)) expect(def).toMatch(/SET search_path = public, pg_temp/);
    }
  });
});
