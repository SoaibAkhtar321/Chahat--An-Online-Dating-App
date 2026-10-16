// Issues a short-lived join token for an ACCEPTED call to one of its two participants.
// Identity comes only from the verified Supabase JWT. The request body carries just call_id.
// No provider secret, service-role key or other participant's data is ever returned.
// The authorization flow lives in handler.ts so it can be tested without Deno.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { REGISTERED_CALL_PROVIDERS, resolveCallProvider } from "../_shared/callProvider.ts";
import { createAgoraProviderFactory } from "../_shared/agoraProvider.ts";
import { buildAgoraRtcToken } from "../_shared/agoraTokenBuilder.ts";
import { CORS, handleIssueCallToken } from "./handler.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !serviceKey) {
    return new Response(
      JSON.stringify({ success: false, code: "internal_error", error: "Calling is not available right now." }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } },
    );
  }

  const userClient = createClient(url, anon, { auth: { persistSession: false } });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  return handleIssueCallToken(request, {
    verifyUser: async (token) => {
      const { data, error } = await userClient.auth.getUser(token);
      return error ? null : (data?.user?.id ?? null);
    },
    consumeRateLimit: async (userId) => {
      const { data, error } = await admin.rpc("consume_call_token_rate_limit", { _user_id: userId });
      if (error) throw new Error("rate limit rpc failed");
      return data;
    },
    getJoinContext: async (callId, userId) => {
      const { data, error } = await admin.rpc("get_call_join_context", {
        _call_id: callId,
        _user_id: userId,
      });
      if (error) throw new Error("join context rpc failed");
      return data;
    },
    extendCoverage: async (callId, userId) => {
      const { data, error } = await admin.rpc("extend_call_coverage", {
        _call_id: callId,
        _user_id: userId,
      });
      if (error) throw new Error("extend coverage rpc failed");
      return data;
    },
    provider: resolveCallProvider(
      {
        CALL_PROVIDER: Deno.env.get("CALL_PROVIDER") ?? undefined,
        AGORA_APP_ID: Deno.env.get("AGORA_APP_ID") ?? undefined,
        AGORA_APP_CERTIFICATE: Deno.env.get("AGORA_APP_CERTIFICATE") ?? undefined,
      },
      { ...REGISTERED_CALL_PROVIDERS, agora: createAgoraProviderFactory(buildAgoraRtcToken) },
    ),
    logError: (message) => console.error(message),
  });
});
