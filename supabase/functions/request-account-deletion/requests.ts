// Core of the website deletion-request flow (no Deno globals, unit-tested under jest).
// The caller is identified ONLY from their verified JWT. A request row is recorded (duplicates collapse into the
// open row) and then executed with the same executeAccountDeletion() the in-app option uses. If execution fails the
// row stays 'failed' and is retried by process-deletion-requests or by the user submitting again.
import { AdminLike, CORS, UserClientLike, executeAccountDeletion, json } from "../delete-account/deletion.ts";

const STALE_PROCESSING_MS = 15 * 60 * 1000;

export type RequestOutcome = { status: "completed" | "queued" | "in_progress"; duplicate: boolean };

async function claim(admin: AdminLike, id: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();
  const { data, error } = await admin
    .from("account_deletion_requests")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", id)
    .or(`status.in.(pending,failed),and(status.eq.processing,updated_at.lt.${cutoff})`)
    .select("id");
  if (error) throw new Error(error.message);
  return Array.isArray(data) && data.length > 0;
}

/** Executes one claimed request and records the result. Returns true when the account was deleted. */
export async function runRequest(admin: AdminLike, row: { id: string; user_id: string; attempts?: number }): Promise<boolean> {
  if (!(await claim(admin, row.id))) return false;
  const result = await executeAccountDeletion(admin, row.user_id);
  const now = new Date().toISOString();
  const patch = result.ok
    ? { status: "completed", processed_at: now, updated_at: now, last_error: null, attempts: (row.attempts ?? 0) + 1 }
    : { status: "failed", updated_at: now, last_error: `${result.step}: ${result.message}`.slice(0, 300), attempts: (row.attempts ?? 0) + 1 };
  const { error } = await admin.from("account_deletion_requests").update(patch).eq("id", row.id);
  if (error) console.error("request-account-deletion: could not record result");
  return result.ok;
}

export async function submitDeletionRequest(admin: AdminLike, uid: string): Promise<RequestOutcome> {
  let duplicate = false;
  let { data: open, error } = await admin
    .from("account_deletion_requests")
    .select("id,user_id,status,attempts")
    .eq("user_id", uid)
    .in("status", ["pending", "processing", "failed"])
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (open) {
    duplicate = true;
  } else {
    const ins = await admin
      .from("account_deletion_requests")
      .insert({ user_id: uid, status: "pending", source: "web" })
      .select("id,user_id,status,attempts")
      .single();
    if (ins.error) {
      if ((ins.error as { code?: string }).code !== "23505") throw new Error(ins.error.message);
      duplicate = true; // lost a race with a parallel submission: use the row that won
      const again = await admin.from("account_deletion_requests").select("id,user_id,status,attempts")
        .eq("user_id", uid).in("status", ["pending", "processing", "failed"]).maybeSingle();
      open = again.data;
    } else {
      open = ins.data;
    }
  }
  if (!open) return { status: "queued", duplicate };
  const done = await runRequest(admin, open);
  if (done) return { status: "completed", duplicate };
  return { status: open.status === "processing" ? "in_progress" : "queued", duplicate };
}

export interface RequestDeps {
  env: { url?: string; anon?: string; serviceKey?: string };
  makeUserClient: (authHeader: string) => UserClientLike;
  makeAdminClient: () => AdminLike;
}

export async function handleRequestAccountDeletion(req: Request, deps: RequestDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { ...CORS, "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  if (req.method !== "POST") return json(405, { success: false, error: "Method not allowed" });
  const { url, anon, serviceKey } = deps.env;
  if (!url || !anon || !serviceKey) return json(500, { success: false, code: "misconfigured", error: "Service unavailable" });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json(401, { success: false, code: "unauthenticated", error: "Authentication required" });

  let body: { confirm?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body */ }
  if (body.confirm !== true) return json(400, { success: false, code: "confirmation_required", error: "Confirmation required" });

  const { data, error } = await deps.makeUserClient(authHeader).auth.getUser();
  if (error || !data?.user) return json(401, { success: false, code: "invalid_session", error: "Invalid or expired session" });

  try {
    const outcome = await submitDeletionRequest(deps.makeAdminClient(), data.user.id);
    return json(200, { success: true, ...outcome });
  } catch {
    return json(500, { success: false, code: "request_failed", error: "Request could not be recorded" });
  }
}
