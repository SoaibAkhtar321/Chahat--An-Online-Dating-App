const mockAuthGetUser = jest.fn();
const mockRpc = jest.fn();
const mockInvoke = jest.fn();
const mockFrom = jest.fn();

jest.mock("../mobile/src/services/supabase", () => ({
  isSupabaseConfigured: () => true,
  supabase: {
    auth: { getUser: (...args: any[]) => mockAuthGetUser(...args) },
    rpc: (...args: any[]) => mockRpc(...args),
    functions: { invoke: (...args: any[]) => mockInvoke(...args) },
    from: (...args: any[]) => mockFrom(...args),
  },
}));

import {
  getDailyLikeQuota,
  getUserSubscription,
  purchaseSubscription,
  verifyAndCreditPurchase,
} from "../mobile/src/services/subscription";

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthGetUser.mockResolvedValue({ data: { user: { id: "account-1" } }, error: null });
});

describe("billing and entitlement fail-closed behavior", () => {
  it("does not claim a purchase or call a verifier while native billing is unavailable", async () => {
    await expect(purchaseSubscription("premium", "1m")).resolves.toMatchObject({
      success: false,
      status: "failed",
      error: expect.stringMatching(/not available/i),
    });
    await expect(
      verifyAndCreditPurchase({
        store: "google_play",
        productId: "chahat_premium_1m",
        purchaseToken: "this-is-a-long-enough-token",
        tier: "premium",
        durationMonths: 1,
      }),
    ).resolves.toMatchObject({
      success: false,
      status: "failed",
      error: expect.stringMatching(/disabled/i),
    });
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("uses the authenticated server quota and rejects invalid response shapes", async () => {
    mockRpc.mockResolvedValueOnce({
      data: { daily_limit: 17, likes_remaining: 9, reset_at_ist: "2026-10-10" },
      error: null,
    });
    await expect(getDailyLikeQuota()).resolves.toEqual({
      dailyLimit: 17,
      likesRemaining: 9,
      resetAtIst: "2026-10-10",
    });

    mockRpc.mockResolvedValueOnce({
      data: { daily_limit: "20", likes_remaining: 20, reset_at_ist: "2026-10-10" },
      error: null,
    });
    await expect(getDailyLikeQuota()).rejects.toThrow(/invalid daily-like quota/i);
  });

  it("surfaces subscription query failures instead of misreporting the account as free", async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: new Error("network unavailable") }),
        }),
      }),
    });
    await expect(getUserSubscription()).rejects.toThrow("network unavailable");
  });
});
