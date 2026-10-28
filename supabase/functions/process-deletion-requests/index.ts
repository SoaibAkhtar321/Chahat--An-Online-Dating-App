// Supabase Edge Function: process-deletion-requests. Retries queued/failed website deletion requests.
// verify_jwt = false; callers (a scheduler) send the shared secret in x-cleanup-secret, same as cleanup-chat-media.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { runRequest } from "../request-account-deletion/requests.ts";

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

function constantTimeEqual(a: string, b: string): boolean {
  const e = new TextEncoder(); const x = e.encode(a); const y = e.encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  const secret = Deno.env.get("MEDIA_CLEANUP_SECRET");
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret || !url || !key) return json(503, { error: "Not configured" });
  if (!constantTimeEqual(req.headers.get("x-cleanup-secret") ?? "", secret)) return json(401, { error: "Unauthorized" });

  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data, error } = await admin.from("account_deletion_requests").select("id,user_id,attempts")
    .or(`status.in.(pending,failed),and(status.eq.processing,updated_at.lt.${cutoff})`).order("requested_at").limit(20);
  if (error) return json(500, { error: "Could not read queue" });
  let completed = 0;
  for (const row of data ?? []) if (await runRequest(admin, row)) completed++;
  return json(200, { picked: (data ?? []).length, completed });
});
