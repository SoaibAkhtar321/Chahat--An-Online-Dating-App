// Supabase Edge Function: delete-account  (NOT DEPLOYED — requires explicit approval)
//
// Completely deletes the CALLING user. The user id is taken only from the verified JWT, never from the request body.
// Order (every step is idempotent so the client can safely retry after a partial failure):
//   1. verify caller JWT
//   2. delete the user's storage objects (photos/<uid>/*, chat media the user sent)
//   3. purge DB rows via purge_user_data(uid) (service_role only RPC)
//   4. delete the Supabase Auth user (treats "already deleted" as success)
// The service-role key is read from the function's server-side environment (auto-injected by Supabase).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function removeFolder(admin: ReturnType<typeof createClient>, bucket: string, folder: string) {
  // list() is paginated; loop until the folder is empty.
  for (let guard = 0; guard < 50; guard++) {
    const { data, error } = await admin.storage.from(bucket).list(folder, { limit: 100 });
    if (error) throw new Error(`list ${bucket}/${folder}: ${error.message}`);
    if (!data || data.length === 0) return;
    const { error: rmErr } = await admin.storage.from(bucket).remove(data.map((f) => `${folder}/${f.name}`));
    if (rmErr) throw new Error(`remove ${bucket}/${folder}: ${rmErr.message}`);
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
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return json(401, { success: false, error: "Invalid or expired session" });
  const uid = userData.user.id;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const step = (name: string) => name;
  let current = step("start");
  try {
    // 2a. profile photos
    current = step("storage:photos");
    await removeFolder(admin, "photos", uid);

    // 2b. chat media this user sent (other participant's media is untouched)
    current = step("storage:chat");
    const { data: msgs, error: msgErr } = await admin
      .from("messages").select("image_path").eq("sender", uid).not("image_path", "is", null);
    if (msgErr) throw new Error(msgErr.message);
    const paths = (msgs ?? []).map((m) => m.image_path as string);
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await admin.storage.from("chat").remove(paths.slice(i, i + 100));
      if (error) throw new Error(error.message);
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
  } catch (e) {
    console.error(`delete-account failed at ${current} for ${uid}:`, e);
    return json(500, {
      success: false,
      retryable: true,
      error: `Account deletion did not finish (${current}). Please try again; nothing is lost by retrying.`,
    });
  }
});
