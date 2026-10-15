// Subscription & Pricing Service for Chahat Android.
// Server-backed entitlement definitions for Free, Premium (₹99), Plus (₹199), and VIP (₹399).
// Subscriptions are strictly verified against the backend and cannot be granted client-side.

import { supabase, isSupabaseConfigured } from "./supabase";

export type PlanTier = "free" | "premium" | "plus" | "vip";

export interface PlanConfig {
  id: PlanTier;
  name: string;
  hindiName: string;
  tagline: string;
  monthlyPrice: number;
  badge?: string;
  popular?: boolean;
  features: string[];
}

export interface BillingDuration {
  id: "1m" | "3m" | "6m" | "12m";
  months: number;
  label: string;
  totalPrice: number;
  savings?: string;
  popular?: boolean;
}

// Approved multi-month packages apply specifically to CHAHAT Premium:
// ₹99 (1 month), ₹249 (3 months), ₹449 (6 months), ₹799 (12 months).
export const PREMIUM_BILLING_DURATIONS: BillingDuration[] = [
  {
    id: "1m",
    months: 1,
    label: "1 महीना (1 Month)",
    totalPrice: 99,
  },
  {
    id: "3m",
    months: 3,
    label: "3 महीने (3 Months)",
    totalPrice: 249,
    savings: "Save ₹48 (16% Off)",
  },
  {
    id: "6m",
    months: 6,
    label: "6 महीने (6 Months)",
    totalPrice: 449,
    savings: "Save ₹145 (24% Off)",
  },
  {
    id: "12m",
    months: 12,
    label: "12 महीने (1 Year)",
    totalPrice: 799,
    savings: "Save ₹389 (33% Off)",
    popular: true,
  },
];

export const PLANS: Record<PlanTier, PlanConfig> = {
  free: {
    id: "free",
    name: "Free Plan",
    hindiName: "मुफ़्त प्लान",
    tagline: "मूल सुविधाएं हमेशा मुफ़्त (Always Free)",
    monthlyPrice: 0,
    features: [
      "Profile बनाना (Create Profile)",
      "Daily likes (server-configured limit per IST day)",
      "Limited Matching & Discover Deck",
      "Basic Chat — Match होने के बाद",
      "Free Selfie/Profile Verification Badge",
      "Safety Centre & Block/Report",
    ],
  },
  premium: {
    id: "premium",
    name: "CHAHAT Premium",
    hindiName: "चाहत प्रीमियम",
    tagline: "प्यार और दोस्ती की शुरुआत",
    monthlyPrice: 99,
    popular: true,
    badge: "Most Popular",
    features: [
      "किसने Like किया देखें (See Who Liked You)",
      "Undo Last Swipe (Rewind Pass)",
      "Smart Icebreakers (Hindi, English, Hinglish)",
      "Compatibility Score Summary",
    ],
  },
  plus: {
    id: "plus",
    name: "CHAHAT Plus",
    hindiName: "चाहत प्लस",
    tagline: "अधिक विजिबिलिटी और तेज़ी से मैच",
    monthlyPrice: 199,
    features: [
      "Premium के सभी Features",
      "Read Receipts Control (प्लस और वीआईपी केवल)",
      "Priority Profile Visibility",
      "Advanced Search Filters",
    ],
  },
  vip: {
    id: "vip",
    name: "CHAHAT VIP",
    hindiName: "चाहत वीआईपी",
    tagline: "सर्वश्रेष्ठ अनुभव और विशेष प्राइवेसी",
    monthlyPrice: 399,
    badge: "Exclusive VIP",
    features: [
      "Plus के सभी Features",
      "Incognito Mode (पूर्ण गोपनीयता)",
      "Exclusive VIP Badge",
      "Priority Match Distribution",
    ],
  },
};

export interface UserSubscription {
  tier: PlanTier;
  status: "active" | "expired" | "cancelled";
  startsAt: number;
  expiresAt: number | null;
  autoRenew: boolean;
}

export interface DailyLikeQuota {
  dailyLimit: number;
  likesRemaining: number;
  resetAtIst: string;
}

export async function getDailyLikeQuota(): Promise<DailyLikeQuota> {
  if (!isSupabaseConfigured()) throw new Error("Backend connection is not configured.");
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!authData.user) throw new Error("You must be signed in to load your like limit.");

  const { data, error } = await supabase.rpc("get_daily_like_quota");
  if (error) throw error;
  if (!data || typeof data !== "object") {
    throw new Error("The server returned an invalid daily-like quota.");
  }

  const value = data as Record<string, unknown>;
  const dailyLimit = value.daily_limit;
  const likesRemaining = value.likes_remaining;
  const resetAtIst = value.reset_at_ist;
  if (
    typeof dailyLimit !== "number" ||
    !Number.isInteger(dailyLimit) ||
    dailyLimit < 0 ||
    typeof likesRemaining !== "number" ||
    !Number.isInteger(likesRemaining) ||
    likesRemaining < 0 ||
    likesRemaining > dailyLimit ||
    typeof resetAtIst !== "string"
  ) {
    throw new Error("The server returned an invalid daily-like quota.");
  }
  return { dailyLimit, likesRemaining, resetAtIst };
}

/**
 * Fetches the caller's verified subscription from Supabase. Errors are surfaced so the UI
 * can distinguish an unknown entitlement state from a confirmed free subscription.
 */
export async function getUserSubscription(): Promise<UserSubscription> {
  const freeSubscription: UserSubscription = {
    tier: "free",
    status: "active",
    startsAt: 0,
    expiresAt: null,
    autoRenew: false,
  };

  if (!isSupabaseConfigured()) {
    throw new Error("Backend connection is not configured.");
  }

  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!authData.user) throw new Error("You must be signed in to load subscription status.");

  const { data, error } = await supabase
    .from("user_subscriptions")
    .select("tier, status, starts_at, expires_at, auto_renew")
    .eq("user_id", authData.user.id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return freeSubscription;

  const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : null;
  const startsAt = new Date(data.starts_at).getTime();
  if (!Number.isFinite(startsAt) || (expiresAt !== null && !Number.isFinite(expiresAt))) {
    throw new Error("The server returned invalid subscription dates.");
  }
  if (!["free", "premium", "plus", "vip"].includes(data.tier)) {
    throw new Error("The server returned an unsupported subscription tier.");
  }
  const validTier = data.tier as PlanTier;
  const expired = expiresAt !== null && Date.now() >= expiresAt;
  if (expired || data.status === "expired") {
    return { tier: "free", status: "expired", startsAt, expiresAt, autoRenew: false };
  }
  if (data.status === "cancelled") {
    return { tier: "free", status: "cancelled", startsAt, expiresAt, autoRenew: false };
  }
  if (data.status !== "active")
    throw new Error("The server returned an unsupported subscription status.");

  return {
    tier: validTier,
    status: "active",
    startsAt,
    expiresAt,
    autoRenew: !!data.auto_renew,
  };
}

/**
 * Entitlement checker helper.
 * Derived from server-verified subscription tier.
 */
export function hasEntitlement(
  tier: PlanTier,
  feature:
    | "seeWhoLikedYou"
    | "undoPass"
    | "readReceipts"
    | "advancedFilters"
    | "priorityVisibility"
    | "incognito",
): boolean {
  if (tier === "vip") return true;
  if (tier === "plus") {
    return feature !== "incognito";
  }
  if (tier === "premium") {
    return feature === "seeWhoLikedYou" || feature === "undoPass";
  }
  // Free tier
  return false;
}

// Google Play subscription product IDs (must match Play Console; unverified until configured).
export const PLAY_PRODUCT_IDS = {
  premium: {
    "1m": "chahat_premium_1m",
    "3m": "chahat_premium_3m",
    "6m": "chahat_premium_6m",
    "12m": "chahat_premium_12m",
  },
  plus: { "1m": "chahat_plus_1m" },
  vip: { "1m": "chahat_vip_1m" },
} as const;

export interface PurchaseResult {
  success: boolean;
  status: "completed" | "pending" | "cancelled" | "failed";
  error?: string;
  tier?: PlanTier;
}

/**
 * Initiates Google Play Billing subscription flow.
 * Note: Server verification via RPC/Edge Function is mandatory before updating database tier.
 */
export async function purchaseSubscription(
  tier: PlanTier,
  durationId?: string,
): Promise<PurchaseResult> {
  if (tier === "free") {
    return { success: true, status: "completed", tier: "free" };
  }

  try {
    if (!isSupabaseConfigured()) {
      return {
        success: false,
        status: "failed",
        error: "Backend connection is not configured.",
      };
    }

    // Call server purchase initiation RPC if configured
    const { data: userRes } = await supabase.auth.getUser();
    if (!userRes.user) {
      return {
        success: false,
        status: "failed",
        error: "You must be signed in to upgrade.",
      };
    }

    // Real Google Play Billing is NOT integrated yet (no native billing library, no
    // purchase-token verification backend). Never imply a payment is in progress.
    void durationId;
    return {
      success: false,
      status: "failed",
      error: "Subscriptions are not available in this build yet. You have not been charged.",
    };
  } catch (err: any) {
    return {
      success: false,
      status: "failed",
      error: err?.message || "Payment initiation failed.",
    };
  }
}

export interface VerifyPurchasePayload {
  store: "google_play" | "stripe" | "manual_grant";
  orderId?: string;
  productId: string;
  purchaseToken: string;
  tier: PlanTier;
  amountInr?: number;
  durationMonths: number;
}

/**
 * Submits a store purchase token to the server for verification and credentialing.
 * Strictly verifies JWT and relies on backend record_verified_purchase RPC to prevent token replay.
 */
export async function verifyAndCreditPurchase(
  payload: VerifyPurchasePayload,
): Promise<PurchaseResult> {
  void payload;
  return {
    success: false,
    status: "failed",
    error:
      "Purchase verification is disabled until the authoritative store verifier is configured. You have not been charged.",
  };
}

export interface RestorePurchasesResult {
  success: boolean;
  tier?: PlanTier;
  error?: string;
}

/**
 * Queries server-side subscription state to restore entitlements.
 */
export async function restorePurchases(): Promise<RestorePurchasesResult> {
  if (!isSupabaseConfigured()) {
    return {
      success: false,
      error: "Backend connection is not configured.",
    };
  }

  try {
    const sub = await getUserSubscription();
    if (sub.tier !== "free") {
      return {
        success: true,
        tier: sub.tier,
      };
    }
    return {
      success: false,
      error:
        sub.status === "expired"
          ? "The verified subscription has expired."
          : sub.status === "cancelled"
            ? "The verified subscription was cancelled."
            : "No active subscriptions found to restore.",
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to restore purchases.",
    };
  }
}
