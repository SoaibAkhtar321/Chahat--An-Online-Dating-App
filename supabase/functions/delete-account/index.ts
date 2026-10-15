// Supabase Edge Function: delete-account
// STATUS: NOT DEPLOYED yet (deployed by the runbook in Part C / docs/DEPLOYMENT_RUNBOOK.md).
//
// Completely deletes the CALLING user. The user id is taken only from the verified JWT, never from the request body.
// Order (every step is idempotent so the client can safely retry after a partial failure):
//   1. verify caller JWT
//   2. clear profile photo references, then delete the user's storage objects (photos/<uid>/*, and chat/<matchId>/*)
//   3. purge DB rows via purge_user_data(uid) (service_role only RPC)
//   4. delete the Supabase Auth user (treats "already deleted" as success)
// The service-role key is read from the function's server-side environment (auto-injected by Supabase).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" },
  });

async function removeFolder(admin: ReturnType<typeof createClient>, bucket: string, folder: string,
) {
  // list() is paginated; loop until the folder is completely emptied.
  let remainingCount = 0;
  for (let guard = 0; guard < 50; guard++) {
    const { data, error } = await admin.storage.from(bucket).list(folder, { limit: 100 });
    if (error) throw new Error(`list ${bucket}/${folder}: ${error.message}`);
    if (!data || data.length === 0) return;
    remainingCount = data.length;
    const { error: rmErr } = await admin.storage.from(bucket).remove(data.map((f) => `${folder}/${f.name}`));
    if (rmErr) throw new Error(`remove ${bucket}/${folder}: ${rmErr.message}`);
  }
  // If files still remain after the 50 iterations, throw to prevent silent exit
  const { data: finalCheck } = await admin.storage.from(bucket).list(folder, { limit: 1 });
  if (finalCheck && finalCheck.length > 0) {
    throw new Error(`removeFolder guard limit reached: files still remain in ${bucket}/${folder}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { success: false, error: "Method not allowed" });

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !serviceKey) return json(500, { success: false, error: "Server misconfigured" });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json(401, { success: false, error: "Authentication required" });

  let body: { confirm?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body */ }
  if (body.confirm !== true) return json(400, { success: false, error: "Confirmation required" });

  // 1. identify the caller from their own JWT
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return json(401, { success: false, error: "Invalid or expired session" });
  const uid = userData.user.id;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false },
  });
  const step = (name: string) => name;
  let current = step("start");
  try {
    // 2a. profile photos
    current = step("storage:photos");
    const { error: clearPhotosErr } = await admin.rpc("clear_profile_photos_for_deletion", {
      _uid: uid,
    });
    if (clearPhotosErr)
      throw new Error(`clear profile photo references: ${clearPhotosErr.message}`);
    await removeFolder(admin, "photos", uid);

    // 2b. chat media: delete chat folders for all matches the user belongs to
    current = step("storage:chat");
    const { data: userMatches, error: matchErr } = await admin
      .from("matches")
      .select("id")
      .or(`user_a.eq.${uid},user_b.eq.${uid}`);
    if (matchErr) throw new Error(matchErr.message);

    for (const m of userMatches ?? []) {
      await removeFolder(admin, "chat", m.id);
    }

    // Also paginated scan for any leftover messages sent by user that might have had orphan paths
    let hasMoreMessages = true;
    let page = 0;
    const pageSize = 500;
    while (hasMoreMessages) {
      const { data: msgs, error: msgErr } = await admin
        .from("messages")
        .select("image_path")
        .eq("sender", uid)
        .not("image_path", "is", null)
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (msgErr) throw new Error(msgErr.message);
      if (!msgs || msgs.length === 0) {
        hasMoreMessages = false;
        break;
      }

      const paths = msgs.map((m) => m.image_path as string).filter(Boolean);
      if (paths.length > 0) {
        for (let i = 0; i < paths.length; i += 100) {
          const { error: rmErr } = await admin.storage.from("chat").remove(paths.slice(i, i + 100));
          if (rmErr) throw new Error(rmErr.message);
        }
      }

      if (msgs.length < pageSize) {
        hasMoreMessages = false;
      } else {
        page++;
      }
    }

    // 3. database rows
    current = step("database");
    const { error: purgeErr } = await admin.rpc("purge_user_data", { _uid: uid });
    if (purgeErr) throw new Error(purgeErr.message);

    // 4. auth user (last, so a failure above leaves a retry-able, still-authenticated account)
    current = step("auth");
    const { error: delErr } = await admin.auth.admin.deleteUser(uid);
    if (delErr && !/not.?found/i.test(delErr.message)) throw new Error(delErr.message);

    return json(200, { success: true });
  } catch (e: any) {
    console.error(`delete-account failed at ${current}:`, e?.message || e);
    return json(500, {
      success: false,
      retryable: true,
      error: `Account deletion did not finish (${current}). Please try again; nothing is lost by retrying.`,
    });
  }
});
