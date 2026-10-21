import type { Message, ReplyPreview } from "../types";

/**
 * Pure helpers for "reply to a message" (quoted preview). No React, no network: everything here is unit-testable.
 *
 * The server builds the preview in get_match_messages (so it respects "deleted for me" / "deleted for everyone" and
 * never returns media or view-once text). The helpers below cover the cases the server cannot: a message that just
 * arrived through Realtime, a message I just sent, and a deletion that happens while the chat is open.
 */

/** Error code of a send whose original message is gone, deleted, hidden or from another chat (see the database trigger). */
export const REPLY_TARGET_UNAVAILABLE = "reply_target_unavailable";

export const REPLY_SNIPPET_MAX = 120;
export const REPLY_UNAVAILABLE_TEXT = "Original message unavailable";
export const REPLY_PHOTO_TEXT = "Photo";
export const REPLY_VOICE_TEXT = "Voice message";

/** Server shape of the reply columns of a get_match_messages row. */
function kindFromServer(kind: unknown): ReplyPreview["kind"] {
  return kind === "image" || kind === "voice" ? kind : "text";
}

/** Maps the reply columns of a `get_match_messages` row. Rows without the columns (table fallback, Realtime) give undefined. */
export function replyPreviewFromRow(row: any, currentUserId: string): ReplyPreview | null | undefined {
  const replyToId: string | null = row?.reply_to_id ?? null;
  if (!replyToId) return null;
  // Realtime payloads and the table fallback carry reply_to_id only; the preview is resolved later.
  if (!("reply_unavailable" in row)) return undefined;
  if (row.reply_unavailable) {
    return { id: replyToId, from: null, text: "", kind: "text", unavailable: true };
  }
  const kind = kindFromServer(row.reply_kind);
  return {
    id: replyToId,
    from: row.reply_sender === currentUserId ? "me" : "them",
    text: kind === "text" ? String(row.reply_body ?? "").slice(0, REPLY_SNIPPET_MAX) : "",
    kind,
    unavailable: false,
  };
}

/** Preview of a message that is in the local list (used for the draft bar, optimistic sends and Realtime inserts). */
export function buildReplyPreview(target: Message): ReplyPreview {
  if (target.deletedAt) {
    return { id: target.id, from: null, text: "", kind: "text", unavailable: true };
  }
  const isVoice = target.messageType === "voice" || !!target.audio;
  const isImage = !isVoice && (target.messageType === "image" || !!target.image);
  const kind: ReplyPreview["kind"] = isVoice ? "voice" : isImage ? "image" : "text";
  return {
    id: target.id,
    from: target.from,
    // Photos and voice notes quote no text, exactly like the server preview (a view-once caption must not leak).
    text: kind === "text" ? (target.text ?? "").slice(0, REPLY_SNIPPET_MAX) : "",
    kind,
    unavailable: false,
  };
}

/** What the quote (and the draft bar) shows as its body line. */
export function replySnippet(preview: ReplyPreview): string {
  if (preview.unavailable) return REPLY_UNAVAILABLE_TEXT;
  if (preview.kind === "image") return REPLY_PHOTO_TEXT;
  if (preview.kind === "voice") return REPLY_VOICE_TEXT;
  return preview.text || "Message";
}

/** Name line of the quote: "You" for my own message, the partner's name otherwise. */
export function replyAuthorLabel(preview: ReplyPreview, partnerName: string): string {
  if (preview.unavailable || !preview.from) return "";
  return preview.from === "me" ? "You" : partnerName || "Match";
}

/** A message can be replied to while it has content (not deleted for everyone, not a failed send). */
export function canReplyTo(message: Pick<Message, "deletedAt" | "status"> | null | undefined): boolean {
  return !!message && !message.deletedAt && message.status !== "failed";
}

export interface ReplyContext {
  hidden: ReadonlySet<string>;
  tombstones: ReadonlyMap<string, string>;
}

/**
 * Whether the quote of a reply must be shown as unavailable right now. Derived at render time from the deletion state
 * the chat already keeps, so an optimistic delete and its rollback both work without rewriting the other messages.
 */
export function isReplyUnavailable(message: Pick<Message, "replyTo">, list: readonly Message[], ctx: ReplyContext): boolean {
  const preview = message.replyTo;
  if (!preview) return false;
  if (preview.unavailable) return true;
  if (ctx.hidden.has(preview.id) || ctx.tombstones.has(preview.id)) return true;
  const original = list.find((m) => m.id === preview.id);
  return !!original?.deletedAt;
}

/**
 * Fills the quote of replies that only know `replyToId`, using originals found in the same list.
 * Replies whose original is not in the list stay unresolved (replyTo undefined) so the caller can ask the server.
 * Returns the same array when nothing changed.
 */
export function fillReplyPreviews(list: Message[], source: readonly Message[] = list): Message[] {
  let changed = false;
  const next = list.map((m) => {
    if (m.deletedAt || !m.replyToId || m.replyTo) return m;
    const original = source.find((x) => x.id === m.replyToId);
    if (!original) return m;
    changed = true;
    return { ...m, replyTo: buildReplyPreview(original) };
  });
  return changed ? next : list;
}

/** True when some reply in the list has a link but no preview yet (a refetch will resolve it). */
export function hasUnresolvedReplies(list: readonly Message[]): boolean {
  return list.some((m) => !m.deletedAt && !!m.replyToId && !m.replyTo);
}

/**
 * Takes previews from a fresh server fetch for replies that are still unresolved locally. Nothing else changes:
 * no message is added, removed or re-ordered. Returns the same array when nothing changed.
 */
export function mergeReplyPreviews(list: Message[], fetched: readonly Message[]): Message[] {
  const byId = new Map(fetched.map((m) => [m.id, m]));
  let changed = false;
  const next = list.map((m) => {
    if (m.deletedAt || !m.replyToId || m.replyTo) return m;
    const fresh = byId.get(m.id);
    if (!fresh?.replyTo) return m;
    changed = true;
    return { ...m, replyTo: fresh.replyTo };
  });
  return changed ? next : list;
}
