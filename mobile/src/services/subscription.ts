// Subscription & Pricing Service for Chahat Android.
// Server-backed entitlement definitions for Free, Premium, Plus and VIP. All paid plans are PREPAID Google Play
// plans that do not auto-renew. Prices come only from Google Play (never hard-coded here); entitlements are
// verified on the server and cannot be granted client-side. Catalogue: docs/PLAN_CATALOG.md.

import { supabase, isSupabaseConfigured } from "./supabase";
import { Platform } from "react-native";
import * as Crypto from "expo-crypto";
// expo-iap (OpenIAP) uses Google Play Billing Library 8 (required by Play from 2026; Billing 7 is no longer accepted).
import type { Purchase, ProductSubscription } from "expo-iap";
import { VERIFICATION_ENABLED } from "../constants/features";

export const BILLING_ENABLED = process.env.EXPO_PUBLIC_FEATURE_BILLING === "true";

export type PlanTier = "free" | "premium" | "plus" | "vip";

export interface PlanConfig {
  id: PlanTier;
  name: string;
  tagline: string;
  badge?: string;
  popular?: boolean;
  features: string[];
}

export interface BillingDuration {
  id: "1w" | "1m" | "2m";
  label: string;
  popular?: boolean;
}

// Premium is sold for three prepaid periods. The price shown is Google Play's localized price for that product.
export const PREMIUM_BILLING_DURATIONS: BillingDuration[] = [
  { id: "1w", label: "1 Week" },
  { id: "1m", label: "1 Month", popular: true },
  { id: "2m", label: "2 Months" },
];

// Only benefits the server actually enforces are listed (see the entitlement matrix in docs).
export const PLANS: Record<PlanTier, PlanConfig> = {
  free: {
    id: "free",
    name: "Free Plan",
    tagline: "Core features always free",
    features: [
      "Create Profile",
      "50 likes per day (server-configured daily limit, resets daily in IST)",
      "30 seconds of free video calling per day (resets at midnight IST)",
      "Discover, match and chat",
      ...(VERIFICATION_ENABLED ? ["Selfie verification badge"] : []),
      "Safety Centre & Block/Report",
    ],
  },
  premium: {
    id: "premium",
    name: "Premium",
    tagline: "1 week, 1 month or 2 months · prepaid, no auto-renewal",
    popular: true,
    features: [
      "Unlimited Likes",
      "5 minutes/day video calling",
      "See who liked you",
      "See the profiles you liked",
      "Rewind profiles you passed",
    ],
  },
  plus: {
    id: "plus",
    name: "Plus",
    tagline: "1 month · prepaid, no auto-renewal",
    badge: "1 Month",
    features: ["All Premium features", "Read receipts: see when your messages are read"],
  },
  vip: {
    id: "vip",
    name: "VIP",
    tagline: "1 month · prepaid, no auto-renewal",
    badge: "1 Month",
    features: ["All Plus features"],
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
  unlimited?: boolean;
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
  const isUnlimited =
    value.unlimited === true ||
    (typeof value.daily_limit === "number" && value.daily_limit < 0);
  const rawDailyLimit = value.daily_limit;
  const rawLikesRemaining = value.likes_remaining;
  const resetAtIst = typeof value.reset_at_ist === "string" ? value.reset_at_ist : "";

  if (
    typeof rawDailyLimit !== "number" ||
    typeof rawLikesRemaining !== "number" ||
    typeof value.reset_at_ist !== "string"
  ) {
    throw new Error("The server returned an invalid daily-like quota.");
  }

  if (
    !isUnlimited &&
    (!Number.isInteger(rawDailyLimit) ||
      rawDailyLimit < 0 ||
      !Number.isInteger(rawLikesRemaining) ||
      rawLikesRemaining < 0 ||
      rawLikesRemaining > rawDailyLimit)
  ) {
    throw new Error("The server returned an invalid daily-like quota.");
  }
  const quotaResult: DailyLikeQuota = {
    dailyLimit: isUnlimited ? -1 : rawDailyLimit,
    likesRemaining: isUnlimited ? -1 : rawLikesRemaining,
    resetAtIst,
  };
  if (isUnlimited) {
    quotaResult.unlimited = true;
  }
  return quotaResult;
}

export interface VideoCallAllowance {
  valid: boolean;
  tier: PlanTier;
  isFree: boolean;
  dailyLimitSeconds: number;
  secondsRemaining: number;
  status: "available" | "exhausted";
  nextRenewalAt: string | null;
  activeCallId: string | null;
}

export async function getUserVideoCallAllowance(): Promise<VideoCallAllowance> {
  if (!isSupabaseConfigured()) {
    return {
      valid: true,
      tier: "free",
      isFree: true,
      dailyLimitSeconds: 30,
      secondsRemaining: 30,
      status: "available",
      nextRenewalAt: null,
      activeCallId: null,
    };
  }
  try {
    const { data, error } = await supabase.rpc("get_my_video_call_allowance");
    if (error || !data) {
      return {
        valid: false,
        tier: "free",
        isFree: true,
        dailyLimitSeconds: 30,
        secondsRemaining: 0,
        status: "exhausted",
        nextRenewalAt: null,
        activeCallId: null,
      };
    }
    return {
      valid: data.valid !== false,
      tier: (data.tier as PlanTier) || "free",
      isFree: data.is_free !== false,
      dailyLimitSeconds: data.daily_limit_seconds || (data.is_free ? 30 : 300),
      secondsRemaining: data.seconds_remaining ?? (data.is_free ? 30 : 300),
      status: data.status || "available",
      nextRenewalAt: data.next_renewal_at ?? null,
      activeCallId: data.active_call_id ?? null,
    };
  } catch {
    return {
      valid: false,
      tier: "free",
      isFree: true,
      dailyLimitSeconds: 30,
      secondsRemaining: 0,
      status: "exhausted",
      nextRenewalAt: null,
      activeCallId: null,
    };
  }
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
  // Only features that exist and that the server enforces (no filters / visibility boost / incognito are built).
  feature: "seeWhoLikedYou" | "undoPass" | "readReceipts",
): boolean {
  if (tier === "plus" || tier === "vip") return true;
  if (tier === "premium") return feature !== "readReceipts";
  return false;
}

// Google Play subscription product IDs (must match Play Console; unverified until configured).
export const PLAY_PRODUCT_IDS = {
  premium: {
    "1w": "chahat_premium_1w",
    "1m": "chahat_premium_1m",
    "2m": "chahat_premium_2m",
  },
  plus: {
    "1m": "chahat_plus_1m",
  },
  vip: {
    "1m": "chahat_vip_1m",
  },
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
  return purchase.purchaseState === "purchased";
}

type IapModule = typeof import("expo-iap");

/** Loaded only when billing is used, so builds without the native module (Expo Go, tests) still start. */
async function loadIap(): Promise<IapModule> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("expo-iap") as IapModule;
}

export async function loadPlayBillingCatalog(): Promise<PlayBillingProduct[]> {
  if (!BILLING_ENABLED || Platform.OS !== "android") return [];
  const iap = await loadIap();
  await iap.initConnection();
  const fetched = (await iap.fetchProducts({ skus: ALL_PRODUCT_IDS, type: "subs" })) ?? [];
  return (fetched as ProductSubscription[]).map((subscription) => {
    if (subscription.platform !== "android") {
      return {
        productId: subscription.id,
        localizedPrice: null,
        currencyCode: null,
        offerToken: null,
      };
    }
    // Prepaid plans have one base-plan offer (offerId null); never pick a promotional offer by accident.
    const offers = subscription.subscriptionOfferDetailsAndroid ?? [];
    const offer = offers.find((item) => !item.offerId) ?? offers[0];
    const phase =
      offer?.pricingPhases.pricingPhaseList.find((item) => item.recurrenceMode === 1) ??
      offer?.pricingPhases.pricingPhaseList[0];
    return {
      productId: subscription.id,
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
  const iap = await loadIap();
  await iap.initConnection();
  const updated = iap.purchaseUpdatedListener((purchase: Purchase) => {
    void handlePurchaseUpdate(purchase, iap, onEvent);
  });
  const failed = iap.purchaseErrorListener((error: { code?: unknown; message?: string }) => {
    purchaseInProgress = false;
    if (String(error.code) === "user-cancelled") {
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
  iap: IapModule,
  onEvent: (event: BillingEvent) => void,
): Promise<void> {
  if (purchase.purchaseState === "pending") {
    purchaseInProgress = false;
    onEvent({
      status: "pending",
      message: "Google Play payment is pending. No subscription has been granted.",
    });
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
      orderId: purchase.transactionId ?? undefined,
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
      return {
        success: false,
        status: "failed",
        error: "Google Play Billing is available on Android only.",
      };
    }
    if (purchaseInProgress) {
      return {
        success: false,
        status: "pending",
        error: "A Google Play purchase is already being processed.",
      };
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
      return {
        success: false,
        status: "failed",
        error: "This subscription duration is not supported.",
      };
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
    const iap = await loadIap();
    purchaseInProgress = true;
    await iap.requestPurchase({
      type: "subs",
      request: {
        android: {
          skus: [productId],
          subscriptionOffers: [{ sku: productId, offerToken: product.offerToken }],
          obfuscatedAccountId: obfuscatedAccountIdAndroid,
        },
      },
    });
    return {
      success: false,
      status: "pending",
      error: "Waiting for Google Play to complete the purchase.",
    };
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
    return {
      success: false,
      error: "Google Play purchase restoration is unavailable in this build.",
    };
  }
  if (!isSupabaseConfigured()) {
    return {
      success: false,
      error: "Backend connection is not configured.",
    };
  }

  try {
    const iap = await loadIap();
    await iap.initConnection();
    const purchases = (await iap.getAvailablePurchases()) ?? [];
    for (const purchase of purchases) {
      if (!isPurchased(purchase) || !purchase.purchaseToken || !purchase.productId) continue;
      const result = await verifyAndCreditPurchase({
        store: "google_play",
        productId: purchase.productId,
        purchaseToken: purchase.purchaseToken,
        orderId: purchase.transactionId ?? undefined,
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
