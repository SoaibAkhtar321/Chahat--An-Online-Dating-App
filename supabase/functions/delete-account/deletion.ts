// Pure, dependency-injected core of the delete-account Edge Function (no Deno globals, no URL imports),
// so the same code runs under Deno in production and under jest in __tests__/deleteAccountFunction.test.ts.
import { isSafeChatMediaPath, safeErrorSummary } from "../_shared/safeLog.ts";

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// Minimal shapes of the supabase-js client that this function uses (keeps the module testable).
export interface StorageEntry {
  id: string | null;
  name: string;
}
export interface AdminLike {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }>;
  storage: {
    from(bucket: string): {
      list(
        folder: string,
        opts: { limit: number },
      ): PromiseLike<{ data: StorageEntry[] | null; error: { message: string } | null }>;
      remove(paths: string[]): PromiseLike<{ error: { message: string } | null }>;
    };
  };
  from(table: string): any;
  auth: { admin: { deleteUser(id: string): PromiseLike<{ error: { message: string } | null }> } };
}
export interface UserClientLike {
  auth: {
    getUser(): PromiseLike<{ data: { user: { id: string } | null }; error: unknown }>;
  };
}
export interface HandlerDeps {
  env: { url?: string; anon?: string; serviceKey?: string };
  makeUserClient: (authHeader: string) => UserClientLike;
  makeAdminClient: () => AdminLike;
}

export async function removeFolder(admin: AdminLike, bucket: string, folder: string, depth = 0): Promise<void> {
  if (depth > 20) throw new Error(`removeFolder nesting limit reached in ${bucket}/${folder}`);
  // list() is paginated; loop until the folder is completely emptied.
  for (let guard = 0; guard < 50; guard++) {
    const { data, error } = await admin.storage.from(bucket).list(folder, { limit: 100 });
    if (error) throw new Error(`list ${bucket}/${folder}: ${error.message}`);
    if (!data || data.length === 0) return;

    const files = data.filter((entry) => entry.id !== null);
    const directories = data.filter((entry) => entry.id === null);
    for (const directory of directories) {
      await removeFolder(admin, bucket, `${folder}/${directory.name}`, depth + 1);
    }
    if (files.length > 0) {
      const { error: rmErr } = await admin.storage
        .from(bucket)
        .remove(files.map((file) => `${folder}/${file.name}`));
      if (rmErr) throw new Error(`remove ${bucket}/${folder}: ${rmErr.message}`);
    } else if (directories.length === 0) {
      throw new Error(`removeFolder could not classify entries in ${bucket}/${folder}`);
    }
  }
  const { data: finalCheck, error: finalError } = await admin.storage.from(bucket).list(folder, { limit: 1 });
  if (finalError) throw new Error(`verify ${bucket}/${folder}: ${finalError.message}`);
  if (finalCheck && finalCheck.length > 0) {
    throw new Error(`removeFolder guard limit reached: files still remain in ${bucket}/${folder}`);
  }
}

/** Minimal logger shape so tests can capture output. Defaults to the console. */
export interface LogLike {
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export type DeletionResult = { ok: true } | { ok: false; step: string; message: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Deletes everything for `uid` in a fixed order. The Auth user is deleted last so any earlier failure is retryable. */
export async function executeAccountDeletion(
  admin: AdminLike,
  uid: string,
  opts: { log?: LogLike } = {},
): Promise<DeletionResult> {
  const log: LogLike = opts.log ?? console;
  let current = "start";
  try {
    // uid comes from the verified JWT; this check also makes the later PostgREST .or() filter injection-proof.
    if (!UUID_RE.test(uid)) throw new Error("invalid user id");

    current = "database:deletion_pending";
    const { error: pendingErr } = await admin.rpc("begin_account_deletion", { _uid: uid });
    if (pendingErr) throw new Error(pendingErr.message);

    current = "storage:photos";
    const { error: clearPhotosErr } = await admin.rpc("clear_profile_photos_for_deletion", { _uid: uid });
    if (clearPhotosErr) throw new Error(`clear profile photo references: ${clearPhotosErr.message}`);
    await removeFolder(admin, "photos", uid);

    current = "storage:chat";
    const { data: userMatches, error: matchErr } = await admin
      .from("matches")
      .select("id")
      .or(`user_a.eq.${uid},user_b.eq.${uid}`);
    if (matchErr) throw new Error(matchErr.message);
    const userMatchIds = new Set<string>();
    for (const m of (userMatches ?? []) as Array<{ id: string }>) {
      userMatchIds.add(m.id);
      await removeFolder(admin, "chat", m.id);
    }

    // Also remove chat objects referenced by messages this user sent. The admin client bypasses RLS and Storage
    // policies, so a path is removed ONLY if it is exactly "<match id>/<safe file name>" for a match this user
    // belongs to (same rule as the SQL constraint). Legacy rows written before that constraint existed may hold
    // arbitrary paths, possibly pointing at another user's files: those are skipped and only counted, never logged.
    let skippedUnsafe = 0;
    let page = 0;
    const pageSize = 500;
    for (;;) {
      const { data: msgs, error: msgErr } = await admin
        .from("messages")
        .select("match_id, image_path, audio_path")
        .eq("sender", uid)
        .or("image_path.not.is.null,audio_path.not.is.null")
        .order("id", { ascending: true })
        .range(page * pageSize, (page + 1) * pageSize - 1);
      if (msgErr) throw new Error(msgErr.message);
      if (!msgs || msgs.length === 0) break;

      const safePaths = new Set<string>();
      for (const row of msgs as Array<{
        match_id: string | null;
        image_path?: string | null;
        audio_path?: string | null;
      }>) {
        for (const candidate of [row.image_path, row.audio_path]) {
          if (candidate === null || candidate === undefined) continue;
          if (row.match_id && userMatchIds.has(row.match_id) && isSafeChatMediaPath(candidate, row.match_id)) {
            safePaths.add(candidate);
          } else {
            skippedUnsafe++;
          }
        }
      }
      const paths = [...safePaths];
      for (let i = 0; i < paths.length; i += 100) {
        const { error: rmErr } = await admin.storage.from("chat").remove(paths.slice(i, i + 100));
        if (rmErr) throw new Error(rmErr.message);
      }
      if (msgs.length < pageSize) break;
      page++;
    }
    if (skippedUnsafe > 0) {
      log.warn(`delete-account: skipped ${skippedUnsafe} unsafe or foreign chat media path(s) at storage:chat`);
    }

    current = "database";
    const { error: purgeErr } = await admin.rpc("purge_user_data", { _uid: uid });
    if (purgeErr) throw new Error(purgeErr.message);

    current = "auth";
    const { error: delErr } = await admin.auth.admin.deleteUser(uid);
    if (delErr && !/not.?found/i.test(delErr.message)) throw new Error(delErr.message);

    return { ok: true };
  } catch (e: any) {
    // Raw DB/Storage errors can embed user ids, e-mails or object paths: log a redacted summary only.
    const summary = safeErrorSummary(e);
    log.error(`delete-account failed at ${current}: ${summary}`);
    return { ok: false, step: current, message: summary };
  }
}

export async function handleDeleteAccount(req: Request, deps: HandlerDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { success: false, error: "Method not allowed" });

  const { url, anon, serviceKey } = deps.env;
  if (!url || !anon || !serviceKey) return json(500, { success: false, error: "Server misconfigured" });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json(401, { success: false, code: "unauthenticated", error: "Authentication required" });
  }

  let body: { confirm?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body */
  }
  if (body.confirm !== true) return json(400, { success: false, error: "Confirmation required" });

  // The caller is identified only from their own JWT. Any user id in the body is ignored.
  const { data: userData, error: userErr } = await deps.makeUserClient(authHeader).auth.getUser();
  if (userErr || !userData?.user) {
    return json(401, { success: false, code: "invalid_session", error: "Invalid or expired session" });
  }

  const result = await executeAccountDeletion(deps.makeAdminClient(), userData.user.id);
  if (result.ok) return json(200, { success: true });
  return json(500, {
    success: false,
    retryable: true,
    code: "deletion_incomplete",
    failedStep: result.step,
    error: `Account deletion did not finish (${result.step}). Some cleanup may already have completed; retry to finish deletion.`,
  });
}
