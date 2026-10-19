// expo-secure-store only accepts keys made of letters, digits, ".", "-" and "_". Any other character (for example the
// ":" used when a key embeds a user id) makes every read/write/delete throw "Invalid key provided to SecureStore".
// All SecureStore keys in the app must go through this helper.
export function secureKey(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9._-]/g, "_");
  return cleaned.length > 0 ? cleaned : "_";
}
