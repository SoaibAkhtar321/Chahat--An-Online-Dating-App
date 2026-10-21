/**
 * Pure helpers for message reactions (one reaction per person per message). No React, no network.
 * The allowed set is enforced by the database too (message_reactions_emoji_allowed): keep both lists identical.
 */

export const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

/** messageId -> (userId -> emoji). A user appears at most once per message. */
export type ReactionMap = Record<string, Record<string, string>>;

export interface ReactionRow {
  messageId: string;
  userId: string;
  /** null = the user removed their reaction. */
  emoji: string | null;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  mine: boolean;
}

export function isAllowedReaction(emoji: string | null | undefined): emoji is ReactionEmoji {
  return !!emoji && (REACTION_EMOJIS as readonly string[]).includes(emoji);
}

/** Maps a `message_reactions` row (table select or Realtime payload) to a ReactionRow. */
export function mapReactionRow(row: any): ReactionRow | null {
  if (!row?.message_id || !row?.user_id) return null;
  return {
    messageId: String(row.message_id),
    userId: String(row.user_id),
    emoji: isAllowedReaction(row.emoji) ? row.emoji : null,
  };
}

/** Applies one change. Returns the same object when nothing changed so React skips the render. */
export function applyReactionRow(map: ReactionMap, row: ReactionRow): ReactionMap {
  const current = map[row.messageId]?.[row.userId] ?? null;
  if (current === row.emoji) return map;

  if (row.emoji === null) {
    const { [row.userId]: _removed, ...rest } = map[row.messageId] ?? {};
    if (Object.keys(rest).length === 0) {
      const { [row.messageId]: _gone, ...others } = map;
      return others;
    }
    return { ...map, [row.messageId]: rest };
  }
  return { ...map, [row.messageId]: { ...(map[row.messageId] ?? {}), [row.userId]: row.emoji } };
}

export function buildReactionMap(rows: ReactionRow[]): ReactionMap {
  return rows.reduce<ReactionMap>((map, row) => applyReactionRow(map, row), {});
}

/** Drops a message's reactions (it was deleted for everyone). */
export function clearMessageReactions(map: ReactionMap, messageId: string): ReactionMap {
  if (!(messageId in map)) return map;
  const { [messageId]: _removed, ...rest } = map;
  return rest;
}

/** Chips for one message: biggest group first, ties in the fixed emoji order. */
export function summarizeReactions(
  byUser: Record<string, string> | undefined,
  currentUserId: string | null | undefined,
): ReactionSummary[] {
  if (!byUser) return [];
  const counts = new Map<string, { count: number; mine: boolean }>();
  for (const [userId, emoji] of Object.entries(byUser)) {
    const entry = counts.get(emoji) ?? { count: 0, mine: false };
    entry.count += 1;
    if (userId === currentUserId) entry.mine = true;
    counts.set(emoji, entry);
  }
  const order = (e: string) => {
    const i = (REACTION_EMOJIS as readonly string[]).indexOf(e);
    return i === -1 ? REACTION_EMOJIS.length : i;
  };
  return [...counts.entries()]
    .map(([emoji, v]) => ({ emoji, ...v }))
    .sort((a, b) => b.count - a.count || order(a.emoji) - order(b.emoji));
}

/** What to send when the user taps `tapped`: tapping your current reaction again removes it. */
export function nextReaction(current: string | null | undefined, tapped: string): string | null {
  return current === tapped ? null : tapped;
}
