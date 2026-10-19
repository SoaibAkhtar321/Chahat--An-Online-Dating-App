// Pure Phase 2 rules for the "someone likes you" flow. No React Native imports so it is unit-testable.
// The server (get_my_likes_access / get_received_likes) is the only authority on entitlement; nothing
// here trusts a client-side tier, notification payload field or cached subscription.

/** `count` is present only for eligible members; the server never returns it to free users. */
export interface LikesAccess {
  eligible: boolean;
  count: number | null;
}

export type LikeTapRoute =
  | { kind: "likes" }
  | { kind: "premium" }
  | { kind: "error"; message: string };

export interface ReceivedLike {
  id: string;
  name: string;
  age: number | null;
  city: string;
  photoPaths: string[];
  likedAt: string;
  isPriority: boolean;
}

/** Strictly validates the get_my_likes_access() response. Anything malformed returns null (fail closed). */
export function parseLikesAccess(data: unknown): LikesAccess | null {
  if (!data || typeof data !== "object") return null;
  const { eligible, count } = data as { eligible?: unknown; count?: unknown };
  if (typeof eligible !== "boolean") return null;
  // A free member's response must not carry a count; ignore one defensively instead of surfacing it.
  if (!eligible) return { eligible: false, count: null };
  if (typeof count !== "number" || !Number.isFinite(count) || count < 0) return null;
  return { eligible: true, count: Math.floor(count) };
}

/** The backend signals "not entitled" with SQLSTATE 42501 / message upgrade_required. */
export function isUpgradeRequiredError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return code === "42501" || (typeof message === "string" && message.includes("upgrade_required"));
}

/**
 * Decides where a "like" push tap goes. Asks the server on every tap (never a cached tier). A failed
 * or malformed check yields an error, NOT the likes list, so a network failure can never open it.
 */
export async function resolveLikeTapRoute(
  fetchAccess: () => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<LikeTapRoute> {
  try {
    const { data, error } = await fetchAccess();
    if (error) return { kind: "error", message: "Could not check your membership. Please try again." };
    const access = parseLikesAccess(data);
    if (!access) return { kind: "error", message: "Could not check your membership. Please try again." };
    return access.eligible ? { kind: "likes" } : { kind: "premium" };
  } catch {
    return { kind: "error", message: "Could not check your membership. Please try again." };
  }
}

/** Maps get_received_likes() rows to the screen model, dropping malformed rows. */
export function parseReceivedLikes(rows: unknown): ReceivedLike[] {
  if (!Array.isArray(rows)) return [];
  const out: ReceivedLike[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== "string" || r.id.length === 0) continue;
    out.push({
      id: r.id,
      name: typeof r.name === "string" && r.name ? r.name : "Chahat Member",
      age: typeof r.age === "number" ? r.age : null,
      city: typeof r.city === "string" ? r.city : "",
      photoPaths: Array.isArray(r.photos)
        ? r.photos
            .map((p) => (p && typeof p === "object" ? (p as { path?: unknown }).path : null))
            .filter((p): p is string => typeof p === "string" && p.length > 0)
        : [],
      likedAt: typeof r.liked_at === "string" ? r.liked_at : "",
      isPriority: r.kind === "priority",
    });
  }
  return out;
}
