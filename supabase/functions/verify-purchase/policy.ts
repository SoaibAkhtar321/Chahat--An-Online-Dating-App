export interface VerifiedProduct {
  tier: "premium" | "plus" | "vip";
  durationMonths: number;
  durationDays?: number;
  amountInr: number;
}

export const GOOGLE_PLAY_PRODUCTS: Readonly<Record<string, VerifiedProduct>> = {
  chahat_pkg_149_7d: { tier: "premium", durationMonths: 0.25, durationDays: 7, amountInr: 149 },
  chahat_pkg_299_15d: { tier: "plus", durationMonths: 0.5, durationDays: 15, amountInr: 299 },
  chahat_pkg_499_1m: { tier: "vip", durationMonths: 1, durationDays: 30, amountInr: 499 },
  chahat_premium_1m: { tier: "premium", durationMonths: 1, amountInr: 99 },
  chahat_premium_3m: { tier: "premium", durationMonths: 3, amountInr: 249 },
  chahat_premium_6m: { tier: "premium", durationMonths: 6, amountInr: 449 },
  chahat_premium_12m: { tier: "premium", durationMonths: 12, amountInr: 799 },
  chahat_plus_1m: { tier: "plus", durationMonths: 1, amountInr: 199 },
  chahat_vip_1m: { tier: "vip", durationMonths: 1, amountInr: 399 },
};

export const GOOGLE_PRODUCT_CATALOG = Object.fromEntries(
  Object.entries(GOOGLE_PLAY_PRODUCTS).map(([productId, product]) => [
    productId,
    { tier: product.tier, durationMonths: product.durationMonths },
  ]),
) as Readonly<Record<string, { tier: VerifiedProduct["tier"]; durationMonths: number }>>;

export type GoogleProductId = keyof typeof GOOGLE_PLAY_PRODUCTS;
export type GoogleEntitledState = "ACTIVE" | "IN_GRACE_PERIOD" | "CANCELED";

export interface GoogleSubscriptionPurchase {
  subscriptionState?: string;
  acknowledgementState?: string;
  startTime?: string;
  latestOrderId?: string;
  pendingPurchase?: { purchaseState?: string };
  externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string };
  lineItems?: Array<{
    productId?: string;
    expiryTime?: string;
    latestSuccessfulOrderId?: string;
    autoRenewingPlan?: { autoRenewEnabled?: boolean };
  }>;
}

export function getGoogleProduct(productId: string) {
  if (!Object.prototype.hasOwnProperty.call(GOOGLE_PLAY_PRODUCTS, productId)) return null;
  const product = GOOGLE_PLAY_PRODUCTS[productId as GoogleProductId];
  return product
    ? { tier: product.tier, durationMonths: product.durationMonths }
    : null;
}

export function validatePurchaseRequest(
  body: unknown,
): { valid: false; error: string } | { valid: true; purchaseToken: string } {
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

export function resolveGoogleSubscription(
  purchase: GoogleSubscriptionPurchase,
  expectedAccountId: string,
  now = Date.now(),
  expectedProductId?: string,
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
    if (expectedProductId && item.productId !== expectedProductId) return false;
    const product =
      item.productId && Object.prototype.hasOwnProperty.call(GOOGLE_PLAY_PRODUCTS, item.productId)
        ? GOOGLE_PLAY_PRODUCTS[item.productId as GoogleProductId]
        : undefined;
    const expiry = item.expiryTime ? Date.parse(item.expiryTime) : Number.NaN;
    return !!product && Number.isFinite(expiry) && expiry > now;
  });
  const orderId = lineItem?.latestSuccessfulOrderId ?? purchase.latestOrderId;
  if (!lineItem?.productId || !lineItem.expiryTime || !orderId) {
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
    orderId,
    autoRenew: lineItem.autoRenewingPlan?.autoRenewEnabled === true,
    needsAcknowledgement: purchase.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING",
  };
}

export interface GooglePlayNotification {
  packageName: string;
  purchaseToken: string;
  subscriptionId: string;
  notificationType: number;
}

export function parseGooglePlayNotification(
  encodedData: string,
  expectedPackageName = "com.chahat.dating",
): GooglePlayNotification | null {
  if (encodedData.length > 32768) return null;
  try {
    const decoded = JSON.parse(atob(encodedData));
    const note = decoded?.subscriptionNotification;
    if (
      decoded?.packageName !== expectedPackageName ||
      typeof note?.purchaseToken !== "string" ||
      note.purchaseToken.length < 16 ||
      note.purchaseToken.length > 4096 ||
      typeof note?.subscriptionId !== "string" ||
      !getGoogleProduct(note.subscriptionId) ||
      !Number.isInteger(note?.notificationType)
    ) {
      return null;
    }
    return {
      packageName: decoded.packageName,
      purchaseToken: note.purchaseToken,
      subscriptionId: note.subscriptionId,
      notificationType: note.notificationType,
    };
  } catch {
    return null;
  }
}

export function isTrustedPubSubClaims(
  claims: Record<string, unknown>,
  audience: string,
  serviceAccountEmail: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  return (
    (claims.iss === "accounts.google.com" || claims.iss === "https://accounts.google.com") &&
    claims.aud === audience &&
    claims.email === serviceAccountEmail &&
    claims.email_verified === true &&
    typeof claims.exp === "number" &&
    claims.exp > nowSeconds &&
    typeof claims.iat === "number" &&
    claims.iat <= nowSeconds + 60 &&
    nowSeconds - claims.iat <= 3600
  );
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function decodeJwtPart<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export async function verifyGooglePubSubJwt(
  authorization: string,
  audience: string,
  serviceAccountEmail: string,
  fetcher: typeof fetch = fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(authorization);
  if (!match || match[1].length > 8192) return false;
  const segments = match[1].split(".");
  if (segments.length !== 3) return false;

  try {
    const header = decodeJwtPart<{ alg?: string; kid?: string }>(segments[0]);
    const claims = decodeJwtPart<Record<string, unknown>>(segments[1]);
    if (
      header.alg !== "RS256" ||
      !header.kid ||
      !isTrustedPubSubClaims(claims, audience, serviceAccountEmail, nowSeconds)
    ) {
      return false;
    }
    const certResponse = await fetcher("https://www.googleapis.com/oauth2/v3/certs");
    if (!certResponse.ok) return false;
    const certs = (await certResponse.json()) as { keys?: Array<JsonWebKey & { kid?: string }> };
    const jwk = certs.keys?.find((key) => key.kid === header.kid);
    if (!jwk) return false;
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      toArrayBuffer(decodeBase64Url(segments[2])),
      toArrayBuffer(new TextEncoder().encode(`${segments[0]}.${segments[1]}`)),
    );
  } catch {
    return false;
  }
}

export function isEntitledGoogleState(
  state: string,
  expiryMs: number,
  now = Date.now(),
): state is GoogleEntitledState {
  return (
    (state === "SUBSCRIPTION_STATE_ACTIVE" ||
      state === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" ||
      state === "SUBSCRIPTION_STATE_CANCELED") &&
    Number.isFinite(expiryMs) &&
    expiryMs > now
  );
}

export function googleRevocationState(state: string): string | null {
  switch (state) {
    case "SUBSCRIPTION_STATE_EXPIRED":
      return "EXPIRED";
    case "SUBSCRIPTION_STATE_ON_HOLD":
      return "ON_HOLD";
    case "SUBSCRIPTION_STATE_PAUSED":
      return "PAUSED";
    case "SUBSCRIPTION_STATE_PENDING":
    case "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED":
      return "PENDING";
    default:
      return null;
  }
}
