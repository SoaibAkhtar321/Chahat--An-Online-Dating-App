// Supabase Edge Function: request-account-deletion (called by the website /delete-account page).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { handleRequestAccountDeletion } from "./requests.ts";

Deno.serve((req) => {
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return handleRequestAccountDeletion(req, {
    env: { url, anon, serviceKey },
    makeUserClient: (authHeader) => createClient(url!, anon!, { global: { headers: { Authorization: authHeader } } }) as any,
    makeAdminClient: () => createClient(url!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } }) as any,
  });
});
