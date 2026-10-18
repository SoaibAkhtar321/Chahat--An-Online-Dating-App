const mockRpc = jest.fn();

jest.mock("../mobile/src/services/supabase", () => ({
  isSupabaseConfigured: () => true,
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

import { transitionVideoCall } from "../mobile/src/services/calls";

describe("transitionVideoCall daily allowance", () => {
  beforeEach(() => mockRpc.mockReset());

  test("a refused accept (allowance used) surfaces as an error, not a pending call", async () => {
    mockRpc.mockResolvedValue({
      data: { success: false, status: "pending", error: "daily_call_allowance_used" },
      error: null,
    });
    await expect(transitionVideoCall("call-1", "accept")).rejects.toThrow(/video-call time/i);
  });

  test("a normal accept still returns the status", async () => {
    mockRpc.mockResolvedValue({ data: { success: true, status: "accepted" }, error: null });
    await expect(transitionVideoCall("call-1", "accept")).resolves.toBe("accepted");
  });
});
