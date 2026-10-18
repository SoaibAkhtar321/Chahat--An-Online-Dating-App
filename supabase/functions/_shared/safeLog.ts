// Pure helpers (no Deno globals, no URL imports) so they are unit-tested under jest and reused by Edge Functions.
//
// Edge Function logs are retained by the platform and are readable by anyone with dashboard access, so they must
// not carry personal data. Database and Storage error messages routinely embed user ids, e-mail addresses, object
// paths or constraint detail such as `Key (user_id)=(<uuid>)`. Log a short, redacted summary instead of the raw error.

const UUID_G = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const EMAIL_G = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const JWT_G = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g;
const POSTGRES_KEY_DETAIL_G = /\([^()]*\)=\([^()]*\)/g;
const LONG_TOKEN_G = /[A-Za-z0-9_-]{32,}/g;

const DEFAULT_MAX_LENGTH = 200;

/** Redacts identifiers and secrets from free text and truncates it. Never throws. */
export function sanitizeForLog(value: unknown, maxLength = DEFAULT_MAX_LENGTH): string {
  let text: string;
  try {
    text = typeof value === "string" ? value : String(value ?? "");
  } catch {
    return "<unprintable>";
  }
  text = text
    .replace(JWT_G, "<jwt>")
    .replace(POSTGRES_KEY_DETAIL_G, "(<redacted>)")
    .replace(UUID_G, "<uuid>")
    .replace(EMAIL_G, "<email>")
    .replace(LONG_TOKEN_G, "<token>")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

/**
 * One-line, redacted description of a thrown value: error name, optional code/status, and a sanitized message.
 * Objects are never stringified wholesale (they could contain request bodies or rows).
 */
export function safeErrorSummary(error: unknown): string {
  if (error === null || error === undefined) return "unknown error";
  if (typeof error === "string") return sanitizeForLog(error);
  if (typeof error !== "object") return `non-error value (${typeof error})`;

  const candidate = error as { name?: unknown; message?: unknown; code?: unknown; status?: unknown };
  const name = typeof candidate.name === "string" && candidate.name ? sanitizeForLog(candidate.name, 60) : "Error";
  const codeValue =
    typeof candidate.code === "string" || typeof candidate.code === "number"
      ? candidate.code
      : typeof candidate.status === "number"
        ? candidate.status
        : undefined;
  const code = codeValue === undefined ? "" : ` [${sanitizeForLog(codeValue, 40)}]`;
  const message = typeof candidate.message === "string" ? sanitizeForLog(candidate.message) : "no message";
  return `${name}${code}: ${message}`;
}

/**
 * Mirror of SQL public.is_valid_chat_media_path(_path, _match_id): exactly "<match id>/<one safe file name>".
 * Rejects non-strings, other matches' folders, nested folders, leading "/", "..", backslashes, empty names and
 * anything outside [A-Za-z0-9._-]. `matchId` must itself be a canonical lower-case UUID string.
 */
export function isSafeChatMediaPath(path: unknown, matchId: unknown): path is string {
  if (typeof path !== "string" || typeof matchId !== "string" || matchId.length === 0) return false;
  if (path.includes("..")) return false;
  const prefix = `${matchId}/`;
  if (!path.startsWith(prefix)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(path.slice(prefix.length));
}
