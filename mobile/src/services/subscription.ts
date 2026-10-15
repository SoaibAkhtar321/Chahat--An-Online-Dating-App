// Subscription & Pricing Service for CHAHAT / Milo Android
// Server-backed entitlement definitions for Free, Premium (₹99), Plus (₹199), and VIP (₹399).
// Subscriptions are strictly verified against the backend and cannot be granted client-side.

import { supabase, isSupabaseConfigured } from "./supabase";
import { Platform } from "react-native";
import * as Crypto from "expo-crypto";
import type { Purchase, PurchaseError, Subscription } from "react-native-iap";

export const BILLING_ENABLED = process.env.EXPO_PUBLIC_FEATURE_BILLING === "true";

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
      "रोज़ 20 Likes (20 Daily Likes per IST Day)", // 20 free likes per user per IST day
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
      feature === "seeWhoLikedYou" ||
      feature === "undoPass"
    );
  }
  // Free tier
  return false;
}

// Google Play subscription product IDs (must match Play Console; unverified until configured).
export const PLAY_PRODUCT_IDS = {
  premium: { "1m": "chahat_premium_1m", "3m": "chahat_premium_3m", "6m": "chahat_premium_6m", "12m": "chahat_premium_12m" },
  plus: { "1m": "chahat_plus_1m" },
  vip: { "1m": "chahat_vip_1m" },
} as const;

export interface PlayBillingProduct {
  productId: string;
  localizedPrice: string | null;
  currencyCode: string | null;
  offerToken: string | null;
}

export type BillingEvent =
  | { status: "completed"; tier: PlanTier; warning?: string }
  | { status: "pending"; message: string }
  | { status: "cancelled" }
  | { status: "failed"; error: string };

const ALL_PRODUCT_IDS = [
  ...Object.values(PLAY_PRODUCT_IDS.premium),
  ...Object.values(PLAY_PRODUCT_IDS.plus),
  ...Object.values(PLAY_PRODUCT_IDS.vip),
];
let purchaseInProgress = false;
const purchasesBeingVerified = new Set<string>();

function isPurchased(purchase: Purchase): boolean {
  return purchase.purchaseStateAndroid === 1;
}

export async function loadPlayBillingCatalog(): Promise<PlayBillingProduct[]> {
  if (!BILLING_ENABLED || Platform.OS !== "android") return [];
  const iap = await import("react-native-iap");
  await iap.initConnection();
  const subscriptions = await iap.getSubscriptions({ skus: ALL_PRODUCT_IDS });
  return subscriptions.map((subscription: Subscription) => {
    if (subscription.platform !== "android") {
      return {
        productId: subscription.productId,
        localizedPrice: null,
        currencyCode: null,
        offerToken: null,
      };
    }
    const offer =
      subscription.subscriptionOfferDetails.find((item) => item.offerId === null) ??
      subscription.subscriptionOfferDetails[0];
    const phase =
      offer?.pricingPhases.pricingPhaseList.find((item) => item.recurrenceMode === 1) ??
      offer?.pricingPhases.pricingPhaseList[0];
    return {
      productId: subscription.productId,
      localizedPrice: phase?.formattedPrice ?? null,
      currencyCode: phase?.priceCurrencyCode ?? null,
      offerToken: offer?.offerToken ?? null,
    };
  });
}

export async function listenForPurchaseUpdates(
  onEvent: (event: BillingEvent) => void,
): Promise<() => void> {
  if (!BILLING_ENABLED || Platform.OS !== "android") return () => {};
  const iap = await import("react-native-iap");
  await iap.initConnection();
  const updated = iap.purchaseUpdatedListener((purchase: Purchase) => {
    void handlePurchaseUpdate(purchase, iap, onEvent);
  });
  const failed = iap.purchaseErrorListener((error: PurchaseError) => {
    purchaseInProgress = false;
    if (error.code === "E_USER_CANCELLED") {
      onEvent({ status: "cancelled" });
    } else {
      onEvent({ status: "failed", error: error.message || "Google Play purchase failed." });
    }
  });
  return () => {
    updated.remove();
    failed.remove();
  };
}

async function handlePurchaseUpdate(
  purchase: Purchase,
  iap: typeof import("react-native-iap"),
  onEvent: (event: BillingEvent) => void,
): Promise<void> {
  if (purchase.purchaseStateAndroid === 2) {
    purchaseInProgress = false;
    onEvent({ status: "pending", message: "Google Play payment is pending. No subscription has been granted." });
    return;
  }
  if (!isPurchased(purchase)) {
    purchaseInProgress = false;
    onEvent({ status: "failed", error: "Google Play has not marked this purchase as completed." });
    return;
  }
  const token = purchase.purchaseToken;
  if (!token || !purchase.productId) {
    purchaseInProgress = false;
    onEvent({ status: "failed", error: "Google Play purchase data is incomplete." });
    return;
  }
  if (purchasesBeingVerified.has(token)) return;
  purchasesBeingVerified.add(token);
  try {
    const result = await verifyAndCreditPurchase({
      store: "google_play",
      productId: purchase.productId,
      purchaseToken: token,
      orderId: purchase.transactionId,
    });
    if (!result.success || !result.tier || result.tier === "free") {
      onEvent({ status: "failed", error: result.error ?? "Purchase verification failed." });
      return;
    }
    let warning: string | undefined;
    try {
      await iap.finishTransaction({ purchase, isConsumable: false });
    } catch {
      warning = "Subscription verified; Google Play transaction acknowledgement will be retried.";
    }
    purchaseInProgress = false;
    onEvent({ status: "completed", tier: result.tier, warning });
  } catch (error) {
    onEvent({
      status: "failed",
      error: error instanceof Error ? error.message : "Could not verify the Google Play purchase.",
    });
  } finally {
    purchaseInProgress = false;
    purchasesBeingVerified.delete(token);
  }
}

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
    if (!BILLING_ENABLED) {
      return {
        success: false,
        status: "failed",
        error: "Google Play Billing is disabled in this build. You have not been charged.",
      };
    }
    if (Platform.OS !== "android") {
      return { success: false, status: "failed", error: "Google Play Billing is available on Android only." };
    }
    if (purchaseInProgress) {
      return { success: false, status: "pending", error: "A Google Play purchase is already being processed." };
    }
    if (!isSupabaseConfigured()) {
      return {
        success: false,
        status: "failed",
        error: "Backend connection is not configured.",
      };
    }

    const { data: userRes, error: authError } = await supabase.auth.getUser();
    if (authError || !userRes.user) {
      return {
        success: false,
        status: "failed",
        error: "You must be signed in to upgrade.",
      };
    }

    const productId =
      tier === "premium"
        ? PLAY_PRODUCT_IDS.premium[durationId as keyof typeof PLAY_PRODUCT_IDS.premium]
        : tier === "plus"
          ? PLAY_PRODUCT_IDS.plus[durationId as keyof typeof PLAY_PRODUCT_IDS.plus]
          : PLAY_PRODUCT_IDS.vip[durationId as keyof typeof PLAY_PRODUCT_IDS.vip];
    if (!productId) {
      return { success: false, status: "failed", error: "This subscription duration is not supported." };
    }

    const products = await loadPlayBillingCatalog();
    const product = products.find((item) => item.productId === productId);
    if (!product?.offerToken) {
      return {
        success: false,
        status: "failed",
        error: "This product is not available in Google Play. No purchase was started.",
      };
    }

    const obfuscatedAccountIdAndroid = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      userRes.user.id,
    );
    const iap = await import("react-native-iap");
    purchaseInProgress = true;
    await iap.requestSubscription({
      sku: productId,
      subscriptionOffers: [{ sku: productId, offerToken: product.offerToken }],
      obfuscatedAccountIdAndroid,
    });
    return { success: false, status: "pending", error: "Waiting for Google Play to complete the purchase." };
  } catch (err: any) {
    purchaseInProgress = false;
    return {
      success: false,
      status: "failed",
      error: err?.message || "Payment initiation failed.",
    };
  }
}

export interface VerifyPurchasePayload {
  store: "google_play";
  purchaseToken: string;
  productId: string;
  orderId?: string;
}

/**
 * Submits a Google Play purchase token for server-side verification. Product and entitlement
 * details are determined by the server, not accepted from the app.
 */
export async function verifyAndCreditPurchase(
  payload: VerifyPurchasePayload,
): Promise<PurchaseResult> {
  if (payload.store !== "google_play") {
    return { success: false, status: "failed", error: "Only Google Play purchases are supported." };
  }
  if (!isSupabaseConfigured()) {
    return {
      success: false,
      status: "failed",
      error: "Backend connection is not configured.",
    };
  }

  if (!payload.purchaseToken || payload.purchaseToken.trim().length < 16) {
    return {
      success: false,
      status: "failed",
      error: "Invalid or malformed purchase token.",
    };
  }

  try {
    const { data: userRes } = await supabase.auth.getUser();
    if (!userRes.user) {
      return {
        success: false,
        status: "failed",
        error: "You must be signed in to verify purchases.",
      };
    }

    // Server-side verification Edge Function / RPC invocation
    const { data, error } = await supabase.functions.invoke("verify-purchase", {
      body: {
        store: "google_play",
        productId: payload.productId,
        purchaseToken: payload.purchaseToken.trim(),
        orderId: payload.orderId,
      },
    });

    if (error || !data?.success) {
      return {
        success: false,
        status: data?.status === "pending" ? "pending" : "failed",
        error: data?.error || error?.message || "Purchase token verification failed.",
      };
    }

    const verifiedTier = data.tier;
    if (verifiedTier !== "premium" && verifiedTier !== "plus" && verifiedTier !== "vip") {
      return {
        success: false,
        status: "failed",
        error: "The server did not confirm a valid paid subscription.",
      };
    }

    return {
      success: true,
      status: "completed",
      tier: verifiedTier,
    };
  } catch (err: any) {
    return {
      success: false,
      status: "failed",
      error: err?.message || "Could not complete purchase verification.",
    };
  }
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
  if (!BILLING_ENABLED || Platform.OS !== "android") {
    return { success: false, error: "Google Play purchase restoration is unavailable in this build." };
  }
  if (!isSupabaseConfigured()) {
    return {
      success: false,
      error: "Backend connection is not configured.",
    };
  }

  try {
    const iap = await import("react-native-iap");
    await iap.initConnection();
    const purchases = await iap.getAvailablePurchases();
    for (const purchase of purchases) {
      if (!isPurchased(purchase) || !purchase.purchaseToken || !purchase.productId) continue;
      const result = await verifyAndCreditPurchase({
        store: "google_play",
        productId: purchase.productId,
        purchaseToken: purchase.purchaseToken,
        orderId: purchase.transactionId,
      });
      if (result.success) {
        try {
          await iap.finishTransaction({ purchase, isConsumable: false });
        } catch {
          // The server already persisted the entitlement; the next restore safely retries.
        }
      }
    }
    const sub = await getUserSubscription();
    if (sub.tier !== "free") {
      return {
        success: true,
        tier: sub.tier,
      };
    }
    return {
      success: false,
      error: "No active subscriptions found to restore.",
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || "Failed to restore purchases.",
    };
  }
}
