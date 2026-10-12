// Subscription & Pricing Service for CHAHAT / Milo Android
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
      "रोज़ 10 Likes (10 Daily Likes)", // T6 server limit is 10
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
      "Unlimited Likes (असीमित लाइक्स)",
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

/**
 * Fetches the caller's verified subscription from Supabase.
 * Returns free tier if no record exists or if the subscription has expired/cancelled.
 * Client state or local storage CANNOT override this.
 */
export async function getUserSubscription(): Promise<UserSubscription> {
  const freeFallback: UserSubscription = {
    tier: "free",
    status: "active",
    startsAt: Date.now(),
    expiresAt: null,
    autoRenew: false,
  };

  if (!isSupabaseConfigured()) {
    return freeFallback;
  }

  try {
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr || !authData.user) {
      return freeFallback;
    }

    const { data, error } = await supabase
      .from("user_subscriptions")
      .select("tier, status, starts_at, expires_at, auto_renew")
      .eq("user_id", authData.user.id)
      .maybeSingle();

    if (error || !data) {
      return freeFallback;
    }

    const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : null;
    const isExpired = expiresAt !== null && Date.now() > expiresAt;
    const isCancelled = data.status === "cancelled";

    if (isExpired || isCancelled || data.status !== "active") {
      return freeFallback;
    }

    const tier = (["free", "premium", "plus", "vip"].includes(data.tier)
      ? data.tier
      : "free") as PlanTier;

    return {
      tier,
      status: "active",
      startsAt: new Date(data.starts_at).getTime(),
      expiresAt,
      autoRenew: !!data.auto_renew,
    };
  } catch (err) {
    console.warn("Could not query server subscription:", err);
    return freeFallback;
  }
}

/**
 * Entitlement checker helper.
 * Derived from server-verified subscription tier.
 */
export function hasEntitlement(
  tier: PlanTier,
  feature:
    | "unlimitedLikes"
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
    return (
      feature === "unlimitedLikes" ||
      feature === "seeWhoLikedYou" ||
      feature === "undoPass"
    );
  }
  // Free tier
  return false;
}
