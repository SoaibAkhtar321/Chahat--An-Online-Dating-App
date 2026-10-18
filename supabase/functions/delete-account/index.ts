// Supabase Edge Function: delete-account
// STATUS: NOT DEPLOYED yet (deployed by the runbook in Part C / docs/DEPLOYMENT_RUNBOOK.md).
//
// Completely deletes the CALLING user. The user id is taken only from the verified JWT, never from the request body.
// All logic lives in ./deletion.ts (unit-tested under jest). Order (every step is retryable after a partial failure):
//   1. verify caller JWT
//   2. suspend the profile / mark deletion pending (begin_account_deletion)
//   3. clear profile photo references, then delete the user's storage objects recursively (photos incl. verification
//      selfies, chat media of all the user's matches)
//   4. purge DB rows via purge_user_data(uid) (service_role only RPC)
//   5. delete the Supabase Auth user (treats "already deleted" as success)
// The service-role key is read from the function's server-side environment (auto-injected by Supabase).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { handleDeleteAccount } from "./deletion.ts";

Deno.serve((req) => {
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return handleDeleteAccount(req, {
    env: { url, anon, serviceKey },
    makeUserClient: (authHeader) =>
      createClient(url!, anon!, { global: { headers: { Authorization: authHeader } } }) as any,
    makeAdminClient: () =>
      createClient(url!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } }) as any,
  });
});
