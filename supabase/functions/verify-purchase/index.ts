// Supabase Edge Function: verify-purchase
// Verifies store purchase tokens and records subscriptions server-side with replay protection.
// STATUS: Deploy with: supabase functions deploy verify-purchase

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { resolveGoogleSubscription, validatePurchaseRequest } from "./policy.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_PUBLISHER_SCOPE = "https://www.googleapis.com/auth/androidpublisher";

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

async function sha256Hex(message: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function encodeJson(value: Record<string, unknown>): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function decodePem(privateKey: string): Uint8Array {
  const base64 = privateKey
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

async function googleAccessToken(email: string, privateKeyPem: string): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const unsigned = `${encodeJson({ alg: "RS256", typ: "JWT" })}.${encodeJson({
    iss: email,
    scope: GOOGLE_PUBLISHER_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + 3600,
  })}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    decodePem(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const assertion = `${unsigned}.${base64Url(new Uint8Array(signature))}`;
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) throw new Error("Google service-account authentication failed.");
  const tokenResponse = await response.json();
  if (typeof tokenResponse.access_token !== "string" || !tokenResponse.access_token) {
    throw new Error("Google service-account authentication returned no access token.");
  }
  return tokenResponse.access_token;
}

async function fetchGoogleSubscription(
  accessToken: string,
  packageName: string,
  purchaseToken: string,
): Promise<{ response: Response; purchase?: import("./policy.ts").GoogleSubscriptionPurchase }> {
  const url =
    "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/" +
    `${encodeURIComponent(packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return { response };
  return { response, purchase: await response.json() };
}

async function acknowledgeGoogleSubscription(
  accessToken: string,
  packageName: string,
  productId: string,
  purchaseToken: string,
): Promise<boolean> {
  const url =
    "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/" +
    `${encodeURIComponent(packageName)}/purchases/subscriptions/${encodeURIComponent(productId)}` +
    `/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  return response.ok;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { success: false, error: "Method not allowed" });

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const packageName = Deno.env.get("GOOGLE_PLAY_PACKAGE_NAME");
  const serviceAccountEmail = Deno.env.get("GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL");
  const serviceAccountPrivateKey = Deno.env.get("GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY");
  if (
    !url ||
    !anon ||
    !serviceKey ||
    !packageName ||
    !serviceAccountEmail ||
    !serviceAccountPrivateKey
  ) {
    return json(500, { success: false, error: "Server misconfigured" });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json(401, { success: false, error: "Authentication required" });
  }

  // 1. Identify the caller strictly from their verified JWT
  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    return json(401, { success: false, error: "Invalid or expired session" });
  }
  const uid = userData.user.id;

  // 2. Accept only a Google Play token. Product, tier, price and duration come from Google
  // Play's response and this function's server-owned catalog, never from caller claims.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { success: false, error: "Invalid JSON body" });
  }

  const request = validatePurchaseRequest(body);
  if (!request.valid) {
    return json(400, { success: false, error: request.error });
  }
  const purchaseToken = request.purchaseToken;

  let googleAccess: string;
  let providerResult: Awaited<ReturnType<typeof fetchGoogleSubscription>>;
  try {
    googleAccess = await googleAccessToken(serviceAccountEmail, serviceAccountPrivateKey);
    providerResult = await fetchGoogleSubscription(googleAccess, packageName, purchaseToken);
  } catch (err) {
    console.error("Google Play verification request failed:", err);
    return json(502, {
      success: false,
      error: "Google Play verification is temporarily unavailable.",
    });
  }

  if (!providerResult.response.ok) {
    const status =
      providerResult.response.status === 400 || providerResult.response.status === 404 ? 402 : 502;
    return json(status, {
      success: false,
      error:
        status === 402
          ? "Google Play did not recognize this purchase token."
          : "Google Play verification is temporarily unavailable.",
    });
  }

  const decision = resolveGoogleSubscription(providerResult.purchase ?? {}, await sha256Hex(uid));
  if (!decision.valid) {
    return json(402, { success: false, error: decision.error });
  }

  // 3. Hash only after authoritative provider verification; the unique database constraint
  // remains the atomic replay barrier. Exact retries are idempotent for the same account.
  const tokenHash = await sha256Hex(purchaseToken);

  // 4. Persist before acknowledging. A retry after an acknowledgement failure is safe because
  // the database operation is idempotent for this verified purchase and account.
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: rpcRes, error: rpcErr } = await admin.rpc("record_verified_purchase", {
    _user_id: uid,
    _store: "google_play",
    _order_id: decision.orderId,
    _product_id: decision.productId,
    _tier: decision.tier,
    _token_hash: tokenHash,
    _duration_months: decision.durationMonths,
    _verified_expires_at: decision.expiresAt,
    _auto_renew: decision.autoRenew,
  });

  if (rpcErr) {
    const isReplayConflict = rpcErr.message?.includes("already been redeemed");
    return json(isReplayConflict ? 409 : 400, {
      success: false,
      error: rpcErr.message || "Failed to record verified purchase",
    });
  }

  if (decision.needsAcknowledgement) {
    let acknowledged = false;
    try {
      acknowledged = await acknowledgeGoogleSubscription(
        googleAccess,
        packageName,
        decision.productId,
        purchaseToken,
      );
    } catch (err) {
      console.error("Google Play purchase acknowledgement failed:", err);
    }
    if (!acknowledged) {
      return json(502, {
        success: false,
        error: "Purchase was recorded, but Google Play acknowledgement failed. Retry verification.",
      });
    }
  }

  return json(200, {
    success: true,
    tier: rpcRes?.tier ?? decision.tier,
    data: rpcRes,
  });
});
