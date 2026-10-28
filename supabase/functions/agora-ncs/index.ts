// Agora channel-event webhook (RTC join/leave). Deploy with JWT verification OFF (Agora sends no Supabase JWT):
//   supabase functions deploy agora-ncs --no-verify-jwt
// Required secret: AGORA_NCS_SECRET (the webhook's Signing Secret from the Agora Console). Every request is
// HMAC-verified over the raw body before anything is read. Events are stored idempotently by noticeId and can
// only reduce a call's allowance charge, and only when app_settings.call_agora_reconcile_enabled = 1.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { handleNcs } from "./policy.ts";

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ ok: false }), { status: 405, headers: { "Content-Type": "application/json" } });
  }
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const rawBody = await request.text();

  const result = await handleNcs(
    rawBody,
    { v2: request.headers.get("Agora-Signature-V2"), v1: request.headers.get("Agora-Signature") },
    {
      secret: url && serviceKey ? Deno.env.get("AGORA_NCS_SECRET") : undefined,
      record: async (event) => {
        const admin = createClient(url!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } });
        const { error } = await admin.rpc("record_agora_channel_event", {
          _notice_id: event.noticeId,
          _event_type: event.eventType,
          _channel: event.channelName,
          _account: event.account,
          _client_seq: event.clientSeq,
          _ts_seconds: event.tsSeconds,
        });
        if (error) console.error("agora-ncs: event could not be recorded");
        return { ok: !error };
      },
    },
  );
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
});
