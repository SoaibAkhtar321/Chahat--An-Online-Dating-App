import type { Message } from "../types";
import { fillReplyPreviews, replyPreviewFromRow } from "./replies";

/**
 * Pure helpers for chat message state. No React, no network: everything here is unit-testable.
 *
 * Two kinds of "gone" messages exist (see docs/MESSAGE_DELETION.md):
 *  - hidden:     "Delete for me". The server stops returning the row to this user. The client keeps the
 *                id in a local set so a stale fetch or a late event can never bring it back.
 *  - tombstoned: "Delete for everyone". The row stays, content is scrubbed, `deletedAt` is set.
 *                The client keeps id -> deletedAt so a stale fetch can never show the old content again.
 */

export const DELETED_PREVIEW_TEXT = "This message was deleted";
export const DELETED_BY_ME_PREVIEW_TEXT = "You deleted this message";

export interface DeletionContext {
  hidden: ReadonlySet<string>;
  tombstones: ReadonlyMap<string, string>;
}

export function isTombstone(message: Pick<Message, "deletedAt"> | null | undefined): boolean {
  return !!message?.deletedAt;
}

type Signed = Record<string, string | undefined | null>;

/**
 * Tick state of a message row. `read_at` is already masked server-side for senders without read receipts
 * (get_match_messages), so a masked row simply stays at "delivered" or "sent".
 */
export function messageStatusFromRow(row: { read_at?: string | null; delivered_at?: string | null }): "sent" | "delivered" | "read" {
  if (row.read_at) return "read";
  if (row.delivered_at) return "delivered";
  return "sent";
}

const STATUS_RANK: Record<Message["status"], number> = { failed: -1, sent: 0, delivered: 1, read: 2 };

/**
 * Upgrades the tick state of my own messages from a fresh (server-masked) fetch. Receipts only ever move forward:
 * nothing is added, removed, re-ordered or downgraded, so deletions, optimistic and failed messages are untouched.
 * Returns the same array when nothing changed so React skips the render.
 */
export function mergeReceipts(list: Message[], fetched: Message[]): Message[] {
  const byId = new Map(fetched.map((m) => [m.id, m]));
  let changed = false;
  const next = list.map((m) => {
    if (m.from !== "me" || m.deletedAt || m.status === "failed") return m;
    const fresh = byId.get(m.id);
    if (!fresh || fresh.deletedAt) return m;
    if (STATUS_RANK[fresh.status] <= STATUS_RANK[m.status]) return m;
    changed = true;
    return { ...m, status: fresh.status };
  });
  return changed ? next : list;
}

/** Maps a `messages` row (table, RPC or Realtime payload) to the client Message shape. */
export function mapMessageRow(row: any, currentUserId: string, signed: Signed = {}): Message {
  const deletedAt: string | null = row.deleted_at ?? null;
  const base = {
    id: row.id as string,
    matchId: row.match_id as string,
    sender: row.sender as string,
    from: (row.sender === currentUserId ? "me" : "them") as "me" | "them",
    at: new Date(row.created_at).getTime(),
    status: messageStatusFromRow(row),
  };

  // A tombstone never carries content, whatever the row says (defence in depth for the table fallback path).
  if (deletedAt) {
    return {
      ...base,
      text: "",
      messageType: "text",
      isViewOnce: false,
      viewedAt: null,
      deletedAt,
    };
  }

  return {
    ...base,
    text: row.body ?? "",
    image: row.image_path ? (signed[row.image_path] ?? undefined) : undefined,
    audio: row.audio_path ? (signed[row.audio_path] ?? undefined) : undefined,
    audioDurationSec: row.audio_duration_sec,
    messageType: row.message_type || (row.audio_path ? "voice" : row.image_path ? "image" : "text"),
    isViewOnce: !!row.is_view_once,
    viewedAt: row.viewed_at ?? null,
    deletedAt: null,
    // Reply link + quoted preview. A row without preview columns (Realtime, table fallback) keeps only the link.
    ...(row.reply_to_id
      ? { replyToId: row.reply_to_id as string, replyTo: replyPreviewFromRow(row, currentUserId) }
      : {}),
  };
}

/** Returns the message with all content removed and `deletedAt` set. Keeps identity, side and time. */
export function tombstoneMessage(message: Message, deletedAt: string): Message {
  return {
    id: message.id,
    matchId: message.matchId,
    sender: message.sender,
    from: message.from,
    text: "",
    messageType: "text",
    isViewOnce: false,
    viewedAt: null,
    deletedAt,
    at: message.at,
    status: message.status,
  };
}

export function removeMessage(list: Message[], id: string): Message[] {
  return list.some((m) => m.id === id) ? list.filter((m) => m.id !== id) : list;
}

/** Inserts (or replaces) a message at its chronological place. Used to roll back an optimistic delete. */
export function insertChronologically(list: Message[], message: Message): Message[] {
  const without = list.filter((m) => m.id !== message.id);
  const index = without.findIndex((m) => m.at > message.at);
  if (index === -1) return [...without, message];
  return [...without.slice(0, index), message, ...without.slice(index)];
}

/** Applies a tombstone to a message that is already in the list. Unknown ids are ignored, never added. */
export function applyTombstone(list: Message[], id: string, deletedAt: string): Message[] {
  const index = list.findIndex((m) => m.id === id);
  if (index === -1) return list;
  const current = list[index]!;
  if (current.deletedAt) return list;
  const next = list.slice();
  next[index] = tombstoneMessage(current, deletedAt);
  return next;
}

/**
 * Adds a message that arrived through Realtime INSERT. It is appended (newest last, as before), never duplicated,
 * never added when the user hid it, and never shown with content when it is already known to be tombstoned.
 */
export function appendIncoming(list: Message[], incoming: Message, ctx: DeletionContext): Message[] {
  if (ctx.hidden.has(incoming.id)) return list;
  if (list.some((m) => m.id === incoming.id)) return list;
  const knownDeletedAt = ctx.tombstones.get(incoming.id);
  const message = knownDeletedAt && !incoming.deletedAt ? tombstoneMessage(incoming, knownDeletedAt) : incoming;
  // A reply that arrived without its preview is quoted from the original when that is already in the chat.
  const [resolved] = fillReplyPreviews([message], list);
  return [...list, resolved!];
}

/**
 * Cleans a fresh server fetch before it replaces the list. Covers a fetch that started before a delete was
 * committed and answers after the optimistic update: hidden rows are dropped, tombstoned rows lose their content.
 */
export function reconcileFetched(fetched: Message[], ctx: DeletionContext): Message[] {
  const result: Message[] = [];
  for (const message of fetched) {
    if (ctx.hidden.has(message.id)) continue;
    const knownDeletedAt = ctx.tombstones.get(message.id);
    result.push(knownDeletedAt && !message.deletedAt ? tombstoneMessage(message, knownDeletedAt) : message);
  }
  return result;
}

/** Text for chat-list previews. Never exposes content of a deleted message. */
export function messagePreviewText(message: Message | null | undefined, fallback = "Shared an image"): string {
  if (!message) return "";
  if (message.deletedAt) return message.from === "me" ? DELETED_BY_ME_PREVIEW_TEXT : DELETED_PREVIEW_TEXT;
  return message.text || fallback;
}
