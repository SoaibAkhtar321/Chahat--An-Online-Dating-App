export interface VerifiedProduct {
  tier: "premium" | "plus" | "vip";
  durationMonths: number;
  amountInr: number;
}

export const GOOGLE_PLAY_PRODUCTS: Readonly<Record<string, VerifiedProduct>> = {
  chahat_premium_1m: { tier: "premium", durationMonths: 1, amountInr: 99 },
  chahat_premium_3m: { tier: "premium", durationMonths: 3, amountInr: 249 },
  chahat_premium_6m: { tier: "premium", durationMonths: 6, amountInr: 449 },
  chahat_premium_12m: { tier: "premium", durationMonths: 12, amountInr: 799 },
  chahat_plus_1m: { tier: "plus", durationMonths: 1, amountInr: 199 },
  chahat_vip_1m: { tier: "vip", durationMonths: 1, amountInr: 399 },
};

export interface GoogleSubscriptionPurchase {
  subscriptionState?: string;
  acknowledgementState?: string;
  pendingPurchase?: {
    purchaseState?: string;
  };
  externalAccountIdentifiers?: {
    obfuscatedExternalAccountId?: string;
  };
  lineItems?: Array<{
    productId?: string;
    expiryTime?: string;
    latestSuccessfulOrderId?: string;
    autoRenewingPlan?: {
      autoRenewEnabled?: boolean;
    };
  }>;
}

export type PurchaseDecision =
  | { valid: false; error: string }
  | {
      valid: true;
      productId: string;
      tier: VerifiedProduct["tier"];
      durationMonths: number;
      amountInr: number;
      expiresAt: string;
      orderId: string;
      autoRenew: boolean;
      needsAcknowledgement: boolean;
    };

export type PurchaseRequest =
  { valid: false; error: string } | { valid: true; purchaseToken: string };

export function validatePurchaseRequest(body: unknown): PurchaseRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { valid: false, error: "Invalid request body." };
  }

  const request = body as Record<string, unknown>;
  if (request.store !== "google_play") {
    return { valid: false, error: "Unsupported purchase store." };
  }

  if (
    typeof request.purchaseToken !== "string" ||
    request.purchaseToken.trim().length < 16 ||
    request.purchaseToken.length > 4096
  ) {
    return { valid: false, error: "Valid purchase token is required." };
  }

  return { valid: true, purchaseToken: request.purchaseToken.trim() };
}

export function resolveGoogleSubscription(
  purchase: GoogleSubscriptionPurchase,
  expectedAccountId: string,
  now = Date.now(),
): PurchaseDecision {
  if (
    purchase.pendingPurchase?.purchaseState === "PENDING" ||
    purchase.subscriptionState === "SUBSCRIPTION_STATE_PENDING"
  ) {
    return { valid: false, error: "Google Play purchase is pending and is not entitled." };
  }

  if (
    purchase.subscriptionState !== "SUBSCRIPTION_STATE_ACTIVE" &&
    purchase.subscriptionState !== "SUBSCRIPTION_STATE_CANCELED" &&
    purchase.subscriptionState !== "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"
  ) {
    return { valid: false, error: "Google Play subscription is not active." };
  }

  const accountId = purchase.externalAccountIdentifiers?.obfuscatedExternalAccountId;
  if (!accountId || accountId !== expectedAccountId) {
    return { valid: false, error: "Purchase is not linked to this account." };
  }

  if (
    purchase.acknowledgementState !== "ACKNOWLEDGEMENT_STATE_PENDING" &&
    purchase.acknowledgementState !== "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED"
  ) {
    return { valid: false, error: "Google Play purchase acknowledgement state is invalid." };
  }

  const lineItem = purchase.lineItems?.find((item) => {
    const product =
      typeof item.productId === "string" ? GOOGLE_PLAY_PRODUCTS[item.productId] : undefined;
    const expiry = typeof item.expiryTime === "string" ? Date.parse(item.expiryTime) : Number.NaN;
    return !!product && Number.isFinite(expiry) && expiry > now;
  });
  if (
    !lineItem?.productId ||
    !lineItem.expiryTime ||
    typeof lineItem.latestSuccessfulOrderId !== "string" ||
    !lineItem.latestSuccessfulOrderId
  ) {
    return { valid: false, error: "No active, recognized Google Play product was found." };
  }

  const product = GOOGLE_PLAY_PRODUCTS[lineItem.productId];
  return {
    valid: true,
    productId: lineItem.productId,
    tier: product.tier,
    durationMonths: product.durationMonths,
    amountInr: product.amountInr,
    expiresAt: new Date(lineItem.expiryTime).toISOString(),
    orderId: lineItem.latestSuccessfulOrderId,
    autoRenew: lineItem.autoRenewingPlan?.autoRenewEnabled === true,
    needsAcknowledgement: purchase.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING",
  };
}
