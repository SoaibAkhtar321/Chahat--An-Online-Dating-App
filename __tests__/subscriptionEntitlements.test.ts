jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../mobile/src/services/supabase", () => ({
  isSupabaseConfigured: jest.fn().mockReturnValue(false),
  supabase: {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

import {
  hasEntitlement,
  PLANS,
  PREMIUM_BILLING_DURATIONS,
  type PlanTier,
  type UserSubscription,
} from "../mobile/src/services/subscription";

describe("T6: Server-side Entitlements and Subscription Security", () => {
  // Helper simulating the database function public.get_active_subscription_tier()
  const resolveActiveServerTier = (sub: {
    tier: string;
    status: string;
    expires_at: number | null;
  }): PlanTier => {
    const validTiers: PlanTier[] = ["free", "premium", "plus", "vip"];
    if (!validTiers.includes(sub.tier as PlanTier)) return "free";
    if (sub.status !== "active") return "free";
    if (sub.expires_at !== null && Date.now() > sub.expires_at) return "free";
    return sub.tier as PlanTier;
  };

  // Helper simulating server record_swipe quota check
  const evaluateSwipeQuota = (
    activeTier: PlanTier,
    likesUsedToday: number,
    dailyLimit: number = 10,
  ): { allowed: boolean; likesRemaining: number } => {
    const isPaid = activeTier === "premium" || activeTier === "plus" || activeTier === "vip";
    if (isPaid) {
      return { allowed: true, likesRemaining: 999 };
    }
    const remaining = Math.max(0, dailyLimit - likesUsedToday);
    return {
      allowed: likesUsedToday < dailyLimit,
      likesRemaining: remaining,
    };
  };

  describe("1. Subscription Tier & Expiry State Transitions", () => {
    test("active paid tiers resolve correctly", () => {
      expect(
        resolveActiveServerTier({
          tier: "premium",
          status: "active",
          expires_at: Date.now() + 86400000,
        }),
      ).toBe("premium");

      expect(
        resolveActiveServerTier({
          tier: "plus",
          status: "active",
          expires_at: Date.now() + 86400000,
        }),
      ).toBe("plus");

      expect(
        resolveActiveServerTier({
          tier: "vip",
          status: "active",
          expires_at: Date.now() + 86400000,
        }),
      ).toBe("vip");
    });

    test("expired subscriptions strictly revert to free tier", () => {
      const expiredSub = {
        tier: "vip",
        status: "active",
        expires_at: Date.now() - 5000, // expired 5 seconds ago
      };
      expect(resolveActiveServerTier(expiredSub)).toBe("free");
    });

    test("cancelled subscriptions strictly revert to free tier", () => {
      const cancelledSub = {
        tier: "premium",
        status: "cancelled",
        expires_at: Date.now() + 86400000,
      };
      expect(resolveActiveServerTier(cancelledSub)).toBe("free");
    });

    test("invalid or unrecognized tiers revert to free tier", () => {
      const malformedSub = {
        tier: "super_admin_tier",
        status: "active",
        expires_at: Date.now() + 86400000,
      };
      expect(resolveActiveServerTier(malformedSub)).toBe("free");
    });
  });

  describe("2. Free Daily Likes Limit (T6 Strict 10/day Enforcement)", () => {
    test("free users are allowed to swipe up to 10 times per IST day", () => {
      const result = evaluateSwipeQuota("free", 4, 10);
      expect(result.allowed).toBe(true);
      expect(result.likesRemaining).toBe(6);
    });

    test("free users are strictly blocked on the 10th like limit", () => {
      const result = evaluateSwipeQuota("free", 10, 10);
      expect(result.allowed).toBe(false);
      expect(result.likesRemaining).toBe(0);
    });

    test("free users attempting 11th swipe remain blocked at 0", () => {
      const result = evaluateSwipeQuota("free", 11, 10);
      expect(result.allowed).toBe(false);
      expect(result.likesRemaining).toBe(0);
    });

    test("active paid tiers have unlimited likes and are never blocked", () => {
      const premiumResult = evaluateSwipeQuota("premium", 50, 10);
      expect(premiumResult.allowed).toBe(true);
      expect(premiumResult.likesRemaining).toBe(999);

      const vipResult = evaluateSwipeQuota("vip", 120, 10);
      expect(vipResult.allowed).toBe(true);
      expect(vipResult.likesRemaining).toBe(999);
    });

    test("expired paid users immediately fall back to 10-like limit", () => {
      const serverTier = resolveActiveServerTier({
        tier: "premium",
        status: "active",
        expires_at: Date.now() - 1000,
      });
      expect(serverTier).toBe("free");

      const quotaResult = evaluateSwipeQuota(serverTier, 10, 10);
      expect(quotaResult.allowed).toBe(false);
      expect(quotaResult.likesRemaining).toBe(0);
    });
  });

  describe("3. Protected Received-Likes Access (RLS Boundary)", () => {
    // Simulates the RLS policy: to_id = auth.uid()::text AND public.get_active_subscription_tier(...) IN ('premium', 'plus', 'vip')
    const canReadReceivedLikes = (activeTier: PlanTier): boolean => {
      return activeTier === "premium" || activeTier === "plus" || activeTier === "vip";
    };

    test("free users cannot access identities of users who liked them", () => {
      expect(canReadReceivedLikes("free")).toBe(false);
      expect(hasEntitlement("free", "seeWhoLikedYou")).toBe(false);
    });

    test("active premium, plus, and vip users can access received likes", () => {
      expect(canReadReceivedLikes("premium")).toBe(true);
      expect(canReadReceivedLikes("plus")).toBe(true);
      expect(canReadReceivedLikes("vip")).toBe(true);

      expect(hasEntitlement("premium", "seeWhoLikedYou")).toBe(true);
      expect(hasEntitlement("plus", "seeWhoLikedYou")).toBe(true);
      expect(hasEntitlement("vip", "seeWhoLikedYou")).toBe(true);
    });

    test("expired premium users lose received likes access", () => {
      const activeTier = resolveActiveServerTier({
        tier: "premium",
        status: "active",
        expires_at: Date.now() - 1000,
      });
      expect(canReadReceivedLikes(activeTier)).toBe(false);
    });
  });

  describe("4. Undo-Pass (Rewind) Authorization", () => {
    // Simulates RPC undo_swipe_pass authorization check
    const authorizeUndoPass = (
      activeTier: PlanTier,
    ): { authorized: boolean; error?: string } => {
      if (activeTier === "premium" || activeTier === "plus" || activeTier === "vip") {
        return { authorized: true };
      }
      return { authorized: false, error: "upgrade_required" };
    };

    test("free users are denied undo-pass with upgrade_required error", () => {
      const res = authorizeUndoPass("free");
      expect(res.authorized).toBe(false);
      expect(res.error).toBe("upgrade_required");
      expect(hasEntitlement("free", "undoPass")).toBe(false);
    });

    test("active paid tiers are authorized to rewind passes", () => {
      expect(authorizeUndoPass("premium").authorized).toBe(true);
      expect(authorizeUndoPass("plus").authorized).toBe(true);
      expect(authorizeUndoPass("vip").authorized).toBe(true);

      expect(hasEntitlement("premium", "undoPass")).toBe(true);
    });
  });

  describe("5. Read Receipts Server-Side Authorization (Plus & VIP Only)", () => {
    // Simulates get_match_messages RPC read_at masking
    const filterMessageReadReceipt = (
      activeTier: PlanTier,
      isSender: boolean,
      rawReadAt: string | null,
    ): string | null => {
      if (!isSender) {
        return rawReadAt; // recipient always sees when message was read
      }
      // Sender only sees read receipt if they are Plus or VIP
      if (activeTier === "plus" || activeTier === "vip") {
        return rawReadAt;
      }
      return null; // masked for free and premium
    };

    test("free sender has read_at masked to null", () => {
      const result = filterMessageReadReceipt("free", true, "2026-10-12T04:00:00Z");
      expect(result).toBeNull();
      expect(hasEntitlement("free", "readReceipts")).toBe(false);
    });

    test("premium sender has read_at masked to null (Plus/VIP only feature)", () => {
      const result = filterMessageReadReceipt("premium", true, "2026-10-12T04:00:00Z");
      expect(result).toBeNull();
      expect(hasEntitlement("premium", "readReceipts")).toBe(false);
    });

    test("plus and vip senders receive genuine read_at timestamp", () => {
      const timestamp = "2026-10-12T04:00:00Z";
      expect(filterMessageReadReceipt("plus", true, timestamp)).toBe(timestamp);
      expect(filterMessageReadReceipt("vip", true, timestamp)).toBe(timestamp);

      expect(hasEntitlement("plus", "readReceipts")).toBe(true);
      expect(hasEntitlement("vip", "readReceipts")).toBe(true);
    });
  });

  describe("6. Approved Pricing & Duration Integrity", () => {
    test("monthly base prices match fixed requirements", () => {
      expect(PLANS.free.monthlyPrice).toBe(0);
      expect(PLANS.premium.monthlyPrice).toBe(99);
      expect(PLANS.plus.monthlyPrice).toBe(199);
      expect(PLANS.vip.monthlyPrice).toBe(399);
    });

    test("approved multi-month packages apply strictly to Premium", () => {
      const packagePrices = PREMIUM_BILLING_DURATIONS.map((d) => ({
        id: d.id,
        price: d.totalPrice,
      }));
      expect(packagePrices).toEqual([
        { id: "1m", price: 99 },
        { id: "3m", price: 249 },
        { id: "6m", price: 449 },
        { id: "12m", price: 799 },
      ]);
    });

    test("free plan explicitly states 10 daily likes in feature list", () => {
      const likeFeature = PLANS.free.features.find((f) => f.includes("10 Likes"));
      expect(likeFeature).toBeDefined();
    });
  });
});
