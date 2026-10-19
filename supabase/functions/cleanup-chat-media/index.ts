// Supabase Edge Function: cleanup-chat-media
// STATUS: NOT DEPLOYED yet (see docs/MESSAGE_DELETION.md). verify_jwt = false: callers authenticate with a shared
// secret in the x-cleanup-secret header (constant-time compare), exactly like dispatch-push. The service-role key is
// read from the function's server-side environment and is never sent to or from the mobile app.
// Physically removes chat media of messages deleted for everyone. All logic lives in ./cleanup.ts (unit-tested).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { runChatMediaCleanup } from "./cleanup.ts";
import { safeErrorSummary } from "../_shared/safeLog.ts";

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

function constantTimeEqual(actual: string, expected: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(actual);
  const b = encoder.encode(expected);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return difference === 0;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json(405, { error: "Method not allowed" });

  const secret = Deno.env.get("MEDIA_CLEANUP_SECRET");
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret || !url || !serviceRoleKey) {
    return json(503, { error: "Media cleanup is not configured", code: "cleanup_not_configured" });
  }
  if (!constantTimeEqual(request.headers.get("x-cleanup-secret") ?? "", secret)) {
    return json(401, { error: "Unauthorized" });
  }

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  try {
    const summary = await runChatMediaCleanup(admin as any);
    return json(200, { ...summary });
  } catch (error) {
    console.error("Media cleanup run failed:", safeErrorSummary(error));
    return json(500, { error: "Media cleanup run failed; queued work remains retryable" });
  }
});
