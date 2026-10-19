import { supabase, isSupabaseConfigured } from "./supabase";
import { isValidUUID } from "../utils/validation";
import type { Message } from "../types";

/**
 * Client for the Phase 3A message deletion RPCs (supabase/migrations/20260101004200_message_deletion.sql):
 *   delete_message_for_me(_message_id uuid)        any participant, any message in the match
 *   delete_message_for_everyone(_message_id uuid)  sender only
 * Both return jsonb: { success: true, status, message_id, deleted_at? } or { success: false, error }.
 * Both are idempotent (`already_deleted`), which is what makes retrying after a network failure safe.
 */

export type DeleteScope = "me" | "everyone";

export type DeleteFailureReason =
  | "invalid_id"
  | "message_not_found"
  | "forbidden"
  | "account_not_active"
  | "account_deletion_pending"
  | "auth_required"
  | "unavailable"
  | "network"
  | "unknown";

export type DeleteMessageResult =
  | {
      ok: true;
      status: "deleted_for_me" | "deleted" | "already_deleted";
      messageId: string;
      /** Server tombstone time for Delete for everyone. Absent for Delete for me. */
      deletedAt?: string;
      /** True when no backend is configured (local preview): nothing was sent to a server. */
      local?: boolean;
      attempts: number;
    }
  | {
      ok: false;
      reason: DeleteFailureReason;
      /** True when trying again later could succeed (connectivity / server trouble). */
      retryable: boolean;
      message: string;
      attempts: number;
    };

export const RPC_NAME: Record<DeleteScope, string> = {
  me: "delete_message_for_me",
  everyone: "delete_message_for_everyone",
};

/** Waits before retry 1 and retry 2, so at most 3 attempts per user action. */
export const RETRY_DELAYS_MS: readonly number[] = [400, 1200];

const FAILURE_MESSAGES: Record<DeleteFailureReason, string> = {
  invalid_id: "This message can't be deleted right now.",
  message_not_found: "This message is no longer available.",
  forbidden: "You can only delete your own messages for everyone.",
  account_not_active: "Your account can't delete messages for everyone right now.",
  account_deletion_pending: "Messages can't be deleted while your account deletion is pending.",
  auth_required: "Your session has expired. Please sign in again.",
  unavailable: "Message deletion isn't available yet. Please try again later.",
  network: "Couldn't reach the server. Check your connection and try again.",
  unknown: "Something went wrong. Please try again.",
};

function failure(reason: DeleteFailureReason, attempts: number, retryable = false): DeleteMessageResult {
  return { ok: false, reason, retryable, message: FAILURE_MESSAGES[reason], attempts };
}

interface RpcErrorLike {
  message?: string;
  code?: string;
}

/** Maps a transport / PostgREST error to a failure reason. Only connectivity and 5xx/429 are retryable. */
export function classifyRpcError(
  error: RpcErrorLike | null | undefined,
  status?: number,
): { reason: DeleteFailureReason; retryable: boolean } {
  const message = String(error?.message ?? "");
  const code = String(error?.code ?? "");

  if (/authentication required/i.test(message) || /jwt/i.test(message) || code === "PGRST301") {
    return { reason: "auth_required", retryable: false };
  }
  // Function missing = Phase 3A migration not applied on this project. Retrying cannot help.
  if (code === "PGRST202" || code === "42883" || /could not find the function/i.test(message)) {
    return { reason: "unavailable", retryable: false };
  }
  if (typeof status === "number" && (status >= 500 || status === 429 || status === 408)) {
    return { reason: "network", retryable: true };
  }
  if (!code && /network|fetch|timeout|timed out|connection|offline|socket/i.test(message)) {
    return { reason: "network", retryable: true };
  }
  return { reason: "unknown", retryable: false };
}

const KNOWN_RPC_ERRORS: ReadonlySet<string> = new Set([
  "message_not_found",
  "forbidden",
  "account_not_active",
  "account_deletion_pending",
]);

/** Delete for me is allowed on any message in the match (including a tombstone). */
export function canDeleteForMe(message: Pick<Message, "id">): boolean {
  return isValidUUID(message.id);
}

/** Delete for everyone: only the sender, only while the message still has content. */
export function canDeleteForEveryone(
  message: Pick<Message, "id" | "sender" | "deletedAt">,
  currentUserId: string | null | undefined,
): boolean {
  return (
    !!currentUserId &&
    message.sender === currentUserId &&
    !message.deletedAt &&
    isValidUUID(message.id)
  );
}

interface DeleteOptions {
  /** Test seam. Defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  delaysMs?: readonly number[];
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function deleteMessage(
  scope: DeleteScope,
  messageId: string,
  options: DeleteOptions = {},
): Promise<DeleteMessageResult> {
  if (!messageId || !isValidUUID(messageId)) return failure("invalid_id", 0);

  // Local preview without a backend: mirror what the server would do, nothing leaves the device.
  if (!isSupabaseConfigured()) {
    return {
      ok: true,
      status: scope === "me" ? "deleted_for_me" : "deleted",
      messageId,
      deletedAt: scope === "everyone" ? new Date().toISOString() : undefined,
      local: true,
      attempts: 0,
    };
  }

  const sleep = options.sleep ?? defaultSleep;
  const delays = options.delaysMs ?? RETRY_DELAYS_MS;
  const maxAttempts = delays.length + 1;
  let last: DeleteMessageResult = failure("unknown", 0);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    last = await callOnce(scope, messageId, attempt);
    if (last.ok || !last.retryable) return last;
    if (attempt < maxAttempts) await sleep(delays[attempt - 1] ?? 0);
  }
  return last;
}

async function callOnce(scope: DeleteScope, messageId: string, attempt: number): Promise<DeleteMessageResult> {
  try {
    const res: any = await supabase.rpc(RPC_NAME[scope], { _message_id: messageId });
    if (res?.error) {
      const { reason, retryable } = classifyRpcError(res.error, res.status);
      return failure(reason, attempt, retryable);
    }

    const data = res?.data;
    if (!data || typeof data !== "object") return failure("unknown", attempt);

    if (data.success === false) {
      const code = String(data.error ?? "");
      return failure(KNOWN_RPC_ERRORS.has(code) ? (code as DeleteFailureReason) : "unknown", attempt);
    }
    if (data.success !== true) return failure("unknown", attempt);

    const status =
      data.status === "deleted_for_me" || data.status === "deleted" || data.status === "already_deleted"
        ? data.status
        : scope === "me"
          ? "deleted_for_me"
          : "deleted";

    return {
      ok: true,
      status,
      messageId,
      deletedAt: scope === "everyone" && typeof data.deleted_at === "string" ? data.deleted_at : undefined,
      attempts: attempt,
    };
  } catch (err: any) {
    // supabase-js normally returns errors; a throw here is almost always a transport failure.
    const { reason, retryable } = classifyRpcError({ message: err?.message ?? "network error" });
    return failure(reason === "unknown" ? "network" : reason, attempt, reason === "unknown" ? true : retryable);
  }
}

export const deleteMessageForMe = (messageId: string, options?: DeleteOptions) =>
  deleteMessage("me", messageId, options);

export const deleteMessageForEveryone = (messageId: string, options?: DeleteOptions) =>
  deleteMessage("everyone", messageId, options);
