// Supabase Edge Function: moderate-photo
// STATUS: NOT DEPLOYED yet. Deploy with: supabase functions deploy moderate-photo
//
// Checks the CALLING user's pending profile photos with Google Cloud Vision SafeSearch and records
// the result through the service_role-only review_photo() RPC.
//   - The user id comes only from the verified JWT. The client sends no photo paths, so a caller can
//     never trigger or influence the review of anyone else's photos.
//   - Fail closed: any error (download, Vision, database) leaves the photo PENDING (hidden), never approved.
//   - Idempotent: only rows with status 'pending' are processed, so calling it again is safe.
// Required secret: GOOGLE_VISION_API_KEY (supabase secrets set GOOGLE_VISION_API_KEY=...).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { decide, type SafeSearchAnnotation } from "./policy.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const VISION_URL = "https://vision.googleapis.com/v1/images:annotate";
const MAX_PHOTOS_PER_CALL = 6;
const MAX_BYTES = 5 * 1024 * 1024; // same as the bucket limit

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function safeSearch(apiKey: string, base64: string): Promise<SafeSearchAnnotation | null> {
  const res = await fetch(VISION_URL, {
    method: "POST",
    // Key goes in a header, not the URL, so it never ends up in logs.
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey },
    body: JSON.stringify({
      requests: [{ image: { content: base64 }, features: [{ type: "SAFE_SEARCH_DETECTION" }] }],
    }),
  });
  if (!res.ok) throw new Error(`Vision HTTP ${res.status}`);
  const data = await res.json();
  const first = data?.responses?.[0];
  if (!first || first.error) throw new Error(`Vision error ${first?.error?.code ?? "unknown"}`);
  return first.safeSearchAnnotation ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { success: false, error: "Method not allowed" });

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const visionKey = Deno.env.get("GOOGLE_VISION_API_KEY");
  if (!url || !anon || !serviceKey || !visionKey) return json(500, { success: false, error: "Server misconfigured" });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json(401, { success: false, error: "Authentication required" });

  // 1. identify the caller from their own JWT
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return json(401, { success: false, error: "Invalid or expired session" });
  const uid = userData.user.id;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // 2. this user's pending photos only
  const { data: rows, error: listErr } = await admin
    .from("photo_reviews")
    .select("path")
    .eq("owner_id", uid)
    .eq("status", "pending")
    .limit(MAX_PHOTOS_PER_CALL);
  if (listErr) return json(500, { success: false, error: "Could not load photos" });

  // 3. check each photo; any failure leaves it pending
  const processOne = async (path: string): Promise<"approved" | "rejected" | "pending"> => {
    try {
      const { data: blob, error: dlErr } = await admin.storage.from("photos").download(path);
      if (dlErr || !blob || blob.size === 0 || blob.size > MAX_BYTES) return "pending";
      const bytes = new Uint8Array(await blob.arrayBuffer());

      const decision = decide(await safeSearch(visionKey, toBase64(bytes)));
      if (decision.status === "pending") return "pending";

      const { error: rpcErr } = await admin.rpc("review_photo", {
        _owner: uid,
        _path: path,
        _status: decision.status,
        _reason: decision.status === "rejected" ? decision.reason : null,
        _reviewer: null,
      });
      return rpcErr ? "pending" : decision.status;
    } catch (e) {
      console.error("moderate-photo: failed for one photo:", e instanceof Error ? e.message : "unknown error");
      return "pending";
    }
  };

  const results = await Promise.all((rows ?? []).map((r: { path: string }) => processOne(r.path)));
  return json(200, {
    success: true,
    approved: results.filter((r) => r === "approved").length,
    rejected: results.filter((r) => r === "rejected").length,
    pending: results.filter((r) => r === "pending").length,
  });
});
