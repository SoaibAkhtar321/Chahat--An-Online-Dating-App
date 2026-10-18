// Tracks which chat the signed-in user is looking at right now, so a foreground push for that same
// conversation can be suppressed. Module-level on purpose: the notification handler runs outside React.
let activeMatchId: string | null = null;

export function setActiveConversation(matchId: string | null | undefined): void {
  activeMatchId = typeof matchId === "string" && matchId.length > 0 ? matchId.toLowerCase() : null;
}

/** Clears only if `matchId` is still the active one, so a late blur can't wipe a newer chat. */
export function clearActiveConversation(matchId: string | null | undefined): void {
  if (typeof matchId === "string" && activeMatchId === matchId.toLowerCase()) activeMatchId = null;
}

export function getActiveConversation(): string | null {
  return activeMatchId;
}
