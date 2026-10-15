export const GOOGLE_PRODUCT_CATALOG = {
  chahat_premium_1m: { tier: "premium", durationMonths: 1 },
  chahat_premium_3m: { tier: "premium", durationMonths: 3 },
  chahat_premium_6m: { tier: "premium", durationMonths: 6 },
  chahat_premium_12m: { tier: "premium", durationMonths: 12 },
  chahat_plus_1m: { tier: "plus", durationMonths: 1 },
  chahat_vip_1m: { tier: "vip", durationMonths: 1 },
} as const;

export type GoogleProductId = keyof typeof GOOGLE_PRODUCT_CATALOG;
export type GoogleEntitledState = "ACTIVE" | "IN_GRACE_PERIOD" | "CANCELED";

export interface GooglePlayNotification {
  packageName: string;
  purchaseToken: string;
  subscriptionId: string;
  notificationType: number;
}

export function getGoogleProduct(productId: string) {
  return Object.prototype.hasOwnProperty.call(GOOGLE_PRODUCT_CATALOG, productId)
    ? GOOGLE_PRODUCT_CATALOG[productId as GoogleProductId]
    : null;
}

export function parseGooglePlayNotification(encodedData: string): GooglePlayNotification | null {
  if (encodedData.length > 32768) return null;
  try {
    const decoded = JSON.parse(atob(encodedData));
    const note = decoded?.subscriptionNotification;
    if (
      decoded?.packageName !== "com.milo.dating" ||
      typeof note?.purchaseToken !== "string" ||
      note.purchaseToken.length < 16 ||
      typeof note?.subscriptionId !== "string" ||
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
  const issuer = claims.iss;
  return (
    (issuer === "accounts.google.com" || issuer === "https://accounts.google.com") &&
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
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
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
  const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(authorization);
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
