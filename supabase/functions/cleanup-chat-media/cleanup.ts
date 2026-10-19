// Pure logic for the cleanup-chat-media Edge Function (no Deno globals, no URL imports) so it is unit-tested under jest.
//
// Why this exists: "Delete for everyone" tombstones the message and queues its chat media paths in the database in the
// same transaction (chat_media_cleanup_queue). Client access to those paths is already denied by the Storage SELECT
// policy; this worker physically removes the objects through the Storage API (SQL cannot: deleting storage.objects rows
// would orphan the blobs). It is idempotent and retryable: rows are claimed with a lock, finished rows are marked done,
// failures back off and come back, and a crashed run's locks expire and are reclaimed. It never depends on the sender.
import { sanitizeForLog } from "../_shared/safeLog.ts";

type RpcResult = { data: unknown; error: { message: string } | null };

export interface CleanupAdminLike {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<RpcResult>;
  storage: {
    from(bucket: string): { remove(paths: string[]): PromiseLike<{ error: { message: string } | null }> };
  };
}

export interface ClaimedItem {
  id: string;
  bucket: string;
  object_path: string;
  attempt_count?: number;
}

export interface CleanupSummary {
  claimed: number;
  removed: number;
  failed: number;
  batches: number;
}

// Exactly "<match uuid>/<one safe file name>", the same rule as is_valid_chat_media_path() in SQL. A queue row that
// violates it is never passed to Storage (defence in depth: the database CHECK already forbids such rows).
const SAFE_CHAT_PATH =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

export function isSafeChatPath(path: unknown): path is string {
  return typeof path === "string" && SAFE_CHAT_PATH.test(path) && !path.includes("..");
}

export async function runChatMediaCleanup(
  admin: CleanupAdminLike,
  opts: { batchSize?: number; maxBatches?: number } = {},
): Promise<CleanupSummary> {
  const batchSize = Math.min(Math.max(opts.batchSize ?? 25, 1), 100);
  const maxBatches = Math.max(opts.maxBatches ?? 8, 1);
  const summary: CleanupSummary = { claimed: 0, removed: 0, failed: 0, batches: 0 };

  for (let batch = 0; batch < maxBatches; batch++) {
    const claim = await admin.rpc("claim_chat_media_cleanup", { _limit: batchSize });
    if (claim.error) throw new Error(`claim failed: ${sanitizeForLog(claim.error.message)}`);
    const items = (Array.isArray(claim.data) ? claim.data : []) as ClaimedItem[];
    if (items.length === 0) break;
    summary.batches++;
    summary.claimed += items.length;

    const doneIds: string[] = [];
    for (const item of items) {
      if (item.bucket !== "chat" || !isSafeChatPath(item.object_path)) {
        await markFailed(admin, item.id, "unsafe_path");
        summary.failed++;
        continue;
      }
      let message: string | null = null;
      try {
        const { error } = await admin.storage.from("chat").remove([item.object_path]);
        message = error ? error.message : null;
      } catch (error) {
        message = error instanceof Error ? error.message : "remove threw";
      }
      if (message === null) {
        doneIds.push(item.id);
      } else {
        await markFailed(admin, item.id, message);
        summary.failed++;
      }
    }

    if (doneIds.length > 0) {
      // If this fails the rows stay 'processing' and are reclaimed after the lock expires; removal is idempotent.
      const done = await admin.rpc("complete_chat_media_cleanup", { _ids: doneIds });
      if (done.error) throw new Error(`complete failed: ${sanitizeForLog(done.error.message)}`);
      summary.removed += doneIds.length;
    }
    if (items.length < batchSize) break;
  }
  return summary;
}

async function markFailed(admin: CleanupAdminLike, id: string, message: string): Promise<void> {
  // Error text can embed object paths / ids: store only a redacted, truncated summary.
  const { error } = await admin.rpc("fail_chat_media_cleanup", { _id: id, _error: sanitizeForLog(message, 120) });
  if (error) throw new Error(`fail-report failed: ${sanitizeForLog(error.message)}`);
}
