// Google Play RTDN receiver. Supabase JWT verification is disabled for this
// endpoint; Google Pub/Sub OIDC signature, audience, and service-account claims
// are verified here before any payload is acted on.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  getGoogleAccessToken,
  getGoogleSubscription,
  sha256Hex,
  type GoogleServiceAccount,
} from "../_shared/googlePlay.ts";
import {
  getGoogleProduct,
  googleRevocationState,
  isEntitledGoogleState,
  parseGooglePlayNotification,
  verifyGooglePubSubJwt,
} from "../verify-purchase/policy.ts";

const PACKAGE_NAME = "com.chahat.dating";
const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (request) => {
  if (request.method !== "POST") return json(405, { error: "Method not allowed." });
  const audience = Deno.env.get("PUBSUB_PUSH_AUDIENCE");
  const serviceAccountEmail = Deno.env.get("PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL");
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const accountJson = Deno.env.get("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON");
  if (!audience || !serviceAccountEmail || !url || !serviceKey || !accountJson) {
    return json(500, { error: "Google Play notification receiver is not configured." });
  }
  if (
    !(await verifyGooglePubSubJwt(
      request.headers.get("Authorization") ?? "",
      audience,
      serviceAccountEmail,
    ))
  ) {
    return json(401, { error: "Untrusted notification source." });
  }

  let envelope: unknown;
  try {
    const payload = await request.text();
    if (payload.length > 1_048_576) return json(413, { error: "Pub/Sub payload is too large." });
    envelope = JSON.parse(payload);
  } catch {
    return json(400, { error: "Invalid Pub/Sub payload." });
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    return json(400, { error: "Invalid Pub/Sub payload." });
  }
  const message = (envelope as { message?: { data?: unknown } }).message;
  if (!message || typeof message.data !== "string") {
    return json(400, { error: "Pub/Sub message data is required." });
  }
  const notification = parseGooglePlayNotification(message.data);
  if (!notification) return json(200, { accepted: true, ignored: true });
  const product = getGoogleProduct(notification.subscriptionId);
  if (!product) return json(200, { accepted: true, ignored: true });

  const tokenHash = await sha256Hex(notification.purchaseToken);
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: owner, error: ownerError } = await admin.rpc("get_google_purchase_owner", {
    _token_hash: tokenHash,
  });
  if (ownerError) return json(503, { error: "Could not resolve verified purchase owner." });
  if (typeof owner !== "string") return json(200, { accepted: true, ignored: true });

  let credentials: GoogleServiceAccount;
  try {
    credentials = JSON.parse(accountJson) as GoogleServiceAccount;
  } catch {
    return json(500, { error: "Google Play service account is not valid JSON." });
  }

  try {
    const accessToken = await getGoogleAccessToken(credentials);
    const result = await getGoogleSubscription(
      accessToken,
      PACKAGE_NAME,
      notification.purchaseToken,
    );
    if (!result.response.ok) {
      if (
        result.response.status === 401 ||
        result.response.status === 403 ||
        result.response.status >= 500
      ) {
        return json(503, { error: "Google Play status lookup is temporarily unavailable." });
      }
      return json(200, { accepted: true, ignored: true });
    }
    const subscription = result.subscription;
    if (!subscription) return json(503, { error: "Google Play returned an empty subscription." });

    const accountBinding = subscription.externalAccountIdentifiers?.obfuscatedExternalAccountId;
    if (accountBinding !== (await sha256Hex(owner))) {
      return json(200, { accepted: true, ignored: true });
    }
    const item = subscription.lineItems?.find(
      (line) => line.productId === notification.subscriptionId,
    );
    if (!item) return json(200, { accepted: true, ignored: true });
    const expiryMs = item?.expiryTime ? Date.parse(item.expiryTime) : Number.NaN;
    const state = subscription.subscriptionState ?? "SUBSCRIPTION_STATE_UNSPECIFIED";

    if (!isEntitledGoogleState(state, expiryMs)) {
      const revocationState =
        googleRevocationState(state) ?? (expiryMs <= Date.now() ? "EXPIRED" : null);
      if (revocationState) {
        const { data, error } = await admin.rpc("revoke_verified_google_purchase", {
          _user_id: owner,
          _token_hash: tokenHash,
          _provider_state: revocationState,
        });
        if (error || data !== true) {
          return json(503, { error: "Could not persist subscription revocation." });
        }
      }
      return json(200, { accepted: true, reconciled: true });
    }
    if (
      !item ||
      !Number.isFinite(expiryMs) ||
      !subscription.startTime ||
      !Number.isFinite(Date.parse(subscription.startTime))
    ) {
      return json(200, { accepted: true, ignored: true });
    }

    const databaseState =
      state === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"
        ? "IN_GRACE_PERIOD"
        : state === "SUBSCRIPTION_STATE_CANCELED"
          ? "CANCELED"
          : "ACTIVE";
    const { data, error } = await admin.rpc("record_verified_google_purchase", {
      _user_id: owner,
      _product_id: notification.subscriptionId,
      _token_hash: tokenHash,
      _order_id: item.latestSuccessfulOrderId ?? subscription.latestOrderId ?? null,
      _starts_at: new Date(Date.parse(subscription.startTime)).toISOString(),
      _expires_at: new Date(expiryMs).toISOString(),
      _auto_renew: item.autoRenewingPlan?.autoRenewEnabled === true,
      _provider_state: databaseState,
    });
    if (error || !data?.success) {
      return json(503, { error: "Could not persist verified subscription renewal." });
    }
    return json(200, { accepted: true, reconciled: true });
  } catch {
    return json(503, { error: "Google Play reconciliation is temporarily unavailable." });
  }
});
