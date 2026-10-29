// Free 30 s / paid 300 s per day (2026-10-29): no new call once the day's time is used, and the user sees the
// Premium option. Server side: supabase/tests/82_call_allowance_full_time.sql.
import fs from "fs";
import path from "path";

const mockRpc = jest.fn();
jest.mock("../mobile/src/services/supabase", () => ({
  isSupabaseConfigured: () => true,
  supabase: { rpc: (...args: any[]) => mockRpc(...args) },
}));
jest.mock("expo-crypto", () => ({}));
const mockAlert = jest.fn();
jest.mock("../mobile/src/utils/alert", () => ({ Alert: { alert: (...a: any[]) => mockAlert(...a) } }));

import { startVideoCallIfAllowed } from "../mobile/src/services/callAllowanceGate";
import { CallAllowanceUsedError, createVideoCall } from "../mobile/src/services/calls";

const MATCH = "0b6d2f84-5a37-4c1e-9d0f-6a1c2e3f4a5b";
const allowance = (over: Record<string, unknown>) => ({
  valid: true, tier: "free", is_free: true, daily_allowance: true, daily_limit_seconds: 30,
  seconds_remaining: 30, status: "available", next_renewal_at: null, active_call_id: null, ...over,
});

beforeEach(() => {
  mockRpc.mockReset();
  mockAlert.mockReset();
});

describe("call button gate", () => {
  it("free time left (e.g. 15 s after a 15 s call): opens the call screen", async () => {
    mockRpc.mockResolvedValue({ data: allowance({ seconds_remaining: 15 }), error: null });
    const router = { push: jest.fn() };
    expect(await startVideoCallIfAllowed(router, MATCH)).toBe(true);
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it("free time used up: no call, Premium is offered", async () => {
    mockRpc.mockResolvedValue({ data: allowance({ seconds_remaining: 0, status: "exhausted" }), error: null });
    const router = { push: jest.fn() };
    expect(await startVideoCallIfAllowed(router, MATCH)).toBe(false);
    expect(router.push).not.toHaveBeenCalled();
    const [title, , buttons] = mockAlert.mock.calls[0];
    expect(title).toMatch(/Daily video-call time used/);
    const premium = buttons.find((b: any) => b.text === "Get Premium");
    premium.onPress();
    expect(router.push).toHaveBeenCalledWith("/premium");
  });

  it("paid plan used its 5 minutes: no call, told when it renews (no upgrade pitch)", async () => {
    mockRpc.mockResolvedValue({
      data: allowance({ tier: "premium", is_free: false, daily_limit_seconds: 300, seconds_remaining: 0 }),
      error: null,
    });
    const router = { push: jest.fn() };
    expect(await startVideoCallIfAllowed(router, MATCH)).toBe(false);
    expect(mockAlert.mock.calls[0][1]).toMatch(/5 minutes/);
    expect(mockAlert.mock.calls[0][2]).toBeUndefined();
  });
});

describe("server refusal", () => {
  it("create_video_call refusal becomes CallAllowanceUsedError", async () => {
    mockRpc.mockResolvedValue({ data: { success: false, error: "daily_call_allowance_used", is_free: true }, error: null });
    await expect(createVideoCall(MATCH, "video")).rejects.toBeInstanceOf(CallAllowanceUsedError);
    mockRpc.mockResolvedValue({ data: { success: false, error: "daily_call_allowance_used", is_free: false }, error: null });
    await expect(createVideoCall(MATCH, "video")).rejects.toMatchObject({ isFree: false });
  });
});

describe("wiring", () => {
  const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
  it("chat and calls-hub call buttons go through the gate", () => {
    for (const p of ["mobile/app/chat/[id].tsx", "mobile/app/calls/index.tsx"]) {
      const src = read(p);
      expect(src).toMatch(/startVideoCallIfAllowed\(router/);
      expect(src).not.toMatch(/buildNewCallRoute\(/);
    }
  });
  it("call screen shows the Premium prompt when the server refuses the call", () => {
    expect(read("mobile/app/call/[id].tsx")).toMatch(/cause instanceof CallAllowanceUsedError/);
  });
  it("migration starts the clock at real connection and blocks exhausted callers", () => {
    const sql = read("supabase/migrations/20260101006600_call_allowance_full_time.sql");
    expect(sql).toMatch(/'call_join_slack_seconds', '10'/);
    expect(sql).toMatch(/'error', 'daily_call_allowance_used'/);
  });
});
