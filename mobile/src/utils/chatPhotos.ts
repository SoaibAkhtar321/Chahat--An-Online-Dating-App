// Several photos can be sent from the chat at once. Each photo becomes its own chat message (the first one also
// carries any typed text), so the server's per-message checks and the 30 messages/minute limit still apply.
export const MAX_PHOTOS_PER_SEND = 10;

/** Adds newly picked photos after the ones already chosen, without duplicates, up to the limit. */
export function addPickedPhotos(current: string[], picked: string[]): string[] {
  const out = [...current];
  for (const uri of picked) {
    if (out.length >= MAX_PHOTOS_PER_SEND) break;
    if (uri && !out.includes(uri)) out.push(uri);
  }
  return out;
}
