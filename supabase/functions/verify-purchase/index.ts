// Verifies Google Play subscriptions with the Android Publisher API before
// persisting any entitlement. Never trust product/tier/expiry data from the app.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  getGoogleAccessToken,
  getGoogleSubscription,
  sha256Hex,
  type GoogleServiceAccount,
  type GoogleSubscription,
} from "../_shared/googlePlay.ts";
import { getGoogleProduct, googleRevocationState, isEntitledGoogleState } from "./policy.ts";

const PACKAGE_NAME = "com.milo.dating";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return json(405, { success: false, error: "Method not allowed" });

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const accountJson = Deno.env.get("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON");
  if (!url || !anon || !serviceKey || !accountJson) {
    return json(500, { success: false, error: "Purchase verification is not configured." });
  }

  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return json(401, { success: false, error: "Authentication required." });
  }
  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return json(401, { success: false, error: "Invalid session." });
  const userId = authData.user.id;

  let body: unknown;
  try {
    const requestBody = await request.text();
    if (requestBody.length > 8192) {
      return json(413, { success: false, error: "Purchase request is too large." });
    }
    body = JSON.parse(requestBody);
  } catch {
    return json(400, { success: false, error: "Invalid request body." });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json(400, { success: false, error: "Invalid request body." });
  }
  const purchaseRequest = body as Record<string, unknown>;
  if (purchaseRequest.store !== "google_play") {
    return json(400, { success: false, error: "Only Google Play purchases are supported." });
  }
  if (
    typeof purchaseRequest.productId !== "string" ||
    !getGoogleProduct(purchaseRequest.productId)
  ) {
    return json(400, { success: false, error: "Unsupported Google Play product." });
  }
  if (
    typeof purchaseRequest.purchaseToken !== "string" ||
    purchaseRequest.purchaseToken.trim().length < 16 ||
    purchaseRequest.purchaseToken.length > 4096
  ) {
    return json(400, { success: false, error: "Invalid Google Play purchase token." });
  }

  const productId = purchaseRequest.productId;
  const purchaseToken = purchaseRequest.purchaseToken.trim();
  const tokenHash = await sha256Hex(purchaseToken);
  const expectedAccountBinding = await sha256Hex(userId);
  let credentials: GoogleServiceAccount;
  try {
    credentials = JSON.parse(accountJson) as GoogleServiceAccount;
  } catch {
    return json(500, { success: false, error: "Google Play service account is not valid JSON." });
  }

  let subscription: GoogleSubscription;
  try {
    const accessToken = await getGoogleAccessToken(credentials);
    const result = await getGoogleSubscription(accessToken, PACKAGE_NAME, purchaseToken);
    if (!result.response.ok) {
      if (
        result.response.status === 401 ||
        result.response.status === 403 ||
        result.response.status >= 500
      ) {
        return json(503, {
          success: false,
          retryable: true,
          error: "Google Play verification is temporarily unavailable.",
        });
      }
      return json(400, { success: false, error: "Google Play did not recognize this purchase." });
    }
    if (!result.subscription)
      return json(502, {
        success: false,
        retryable: true,
        error: "Google Play returned an empty purchase.",
      });
    subscription = result.subscription;
  } catch {
    return json(503, {
      success: false,
      retryable: true,
      error: "Google Play verification is temporarily unavailable.",
    });
  }

  const providerAccountBinding =
    subscription.externalAccountIdentifiers?.obfuscatedExternalAccountId;
  if (providerAccountBinding !== expectedAccountBinding) {
    return json(403, {
      success: false,
      error: "This purchase is not bound to the signed-in account.",
    });
  }

  const state = subscription.subscriptionState ?? "SUBSCRIPTION_STATE_UNSPECIFIED";
  if (state === "SUBSCRIPTION_STATE_PENDING") {
    return json(202, {
      success: false,
      status: "pending",
      error: "Google Play purchase is pending. No subscription was granted or acknowledged.",
    });
  }

  const item = subscription.lineItems?.find((line) => line.productId === productId);
  const expiryMs = item?.expiryTime ? Date.parse(item.expiryTime) : Number.NaN;
  if (!item || !Number.isFinite(expiryMs)) {
    return json(400, {
      success: false,
      error: "The verified subscription product or expiry is invalid.",
    });
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  if (!isEntitledGoogleState(state, expiryMs)) {
    const revocationState =
      googleRevocationState(state) ?? (expiryMs <= Date.now() ? "EXPIRED" : null);
    if (revocationState) {
      const { error } = await admin.rpc("revoke_verified_google_purchase", {
        _user_id: userId,
        _token_hash: tokenHash,
        _provider_state: revocationState,
      });
      if (error)
        return json(500, {
          success: false,
          error: "Could not reconcile the verified purchase state.",
        });
    }
    return json(400, {
      success: false,
      status: "inactive",
      error: "Google Play confirms there is no active subscription.",
    });
  }

  const startsAt = subscription.startTime ? Date.parse(subscription.startTime) : Number.NaN;
  if (!Number.isFinite(startsAt) || startsAt > Date.now() + 5 * 60 * 1000) {
    return json(400, {
      success: false,
      error: "Google Play returned an invalid subscription start time.",
    });
  }
  const databaseState =
    state === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"
      ? "IN_GRACE_PERIOD"
      : state === "SUBSCRIPTION_STATE_CANCELED"
        ? "CANCELED"
        : "ACTIVE";
  const { data, error } = await admin.rpc("record_verified_google_purchase", {
    _user_id: userId,
    _product_id: productId,
    _token_hash: tokenHash,
    _order_id: item.latestSuccessfulOrderId ?? subscription.latestOrderId ?? null,
    _starts_at: new Date(startsAt).toISOString(),
    _expires_at: new Date(expiryMs).toISOString(),
    _auto_renew: item.autoRenewingPlan?.autoRenewEnabled === true,
    _provider_state: databaseState,
  });
  if (error) {
    const conflict = /already associated|stale purchase|product does not match/i.test(
      error.message,
    );
    return json(conflict ? 409 : 400, {
      success: false,
      error: conflict
        ? "Purchase token is already used or its update is stale."
        : "Could not persist the verified purchase.",
    });
  }
  if (!data?.success)
    return json(500, {
      success: false,
      retryable: true,
      error: "Verified purchase was not persisted.",
    });

  return json(200, {
    success: true,
    status: "verified",
    tier: data.tier,
    expiresAt: data.expires_at,
    idempotent: data.idempotent === true,
    entitlementUpdated: data.entitlement_updated === true,
  });
});
