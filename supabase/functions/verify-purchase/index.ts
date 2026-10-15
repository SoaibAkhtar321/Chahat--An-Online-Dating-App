// Supabase Edge Function: verify-purchase
// Verifies store purchase tokens and records subscriptions server-side with replay protection.
// STATUS: Deploy with: supabase functions deploy verify-purchase

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { success: false, error: "Method not allowed" });

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !serviceKey) {
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

  // 2. Parse and validate payload
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json(400, { success: false, error: "Invalid JSON body" });
  }

  const { store, orderId, productId, purchaseToken, tier, amountInr, durationMonths } = body;

  const validStores = ["google_play", "stripe", "manual_grant"];
  if (!store || !validStores.includes(store)) {
    return json(400, { success: false, error: "Invalid or unsupported store" });
  }

  const validTiers = ["premium", "plus", "vip"];
  if (!tier || !validTiers.includes(tier)) {
    return json(400, { success: false, error: "Invalid subscription tier" });
  }

  if (!productId || typeof productId !== "string") {
    return json(400, { success: false, error: "Product ID is required" });
  }

  if (!purchaseToken || typeof purchaseToken !== "string" || purchaseToken.trim().length < 16) {
    return json(400, { success: false, error: "Valid purchase token is required" });
  }

  const months = Number(durationMonths);
  if (!months || isNaN(months) || months < 1) {
    return json(400, { success: false, error: "Duration must be at least 1 month" });
  }

  // 3. Compute token hash for cryptographic replay protection
  const tokenHash = await sha256Hex(purchaseToken.trim());

  // 4. Record purchase atomically using privileged service_role client
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: rpcRes, error: rpcErr } = await admin.rpc("record_verified_purchase", {
    _user_id: uid,
    _store: store,
    _order_id: orderId || null,
    _product_id: productId,
    _tier: tier,
    _token_hash: tokenHash,
    _amount_inr: Number(amountInr) || 0,
    _duration_months: months,
  });

  if (rpcErr) {
    const isReplay = rpcErr.message?.includes("already been redeemed");
    return json(isReplay ? 409 : 400, {
      success: false,
      error: rpcErr.message || "Failed to record verified purchase",
    });
  }

  return json(200, {
    success: true,
    data: rpcRes,
  });
});
