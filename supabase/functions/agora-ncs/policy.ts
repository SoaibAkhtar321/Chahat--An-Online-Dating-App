// Pure logic for the Agora channel-event webhook (Agora Console → Webhooks → RTC). No Deno globals, so it is
// unit-tested under Jest (__tests__/agoraNcs.test.ts). The handler trusts nothing until the HMAC over the RAW body
// verifies with the Signing Secret; events can then only ever REDUCE a call's allowance charge (see migration
// 20260101006000), never extend a call.

export const MAX_BODY_BYTES = 16 * 1024;
/** Communication mode (the app's profile) is 107/108; live-broadcast 103-106 are accepted for safety. */
export const JOIN_EVENTS = new Set([103, 105, 107]);
export const LEAVE_EVENTS = new Set([104, 106, 108]);
const RTC_PRODUCT_ID = 1;

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(algorithm: "SHA-256" | "SHA-1", secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: algorithm }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
}

/**
 * Agora signs the raw request body with the webhook's Signing Secret: `Agora-Signature-V2` = hex HMAC-SHA256,
 * `Agora-Signature` = hex HMAC-SHA1. V2 is required when present; V1 is accepted only when V2 is absent.
 */
export async function verifyAgoraSignature(
  rawBody: string,
  headers: { v2: string | null; v1: string | null },
  secret: string,
): Promise<boolean> {
  if (!secret || secret.length < 8) return false;
  const v2 = headers.v2?.trim().toLowerCase();
  if (v2) return constantTimeEqual(v2, await hmacHex("SHA-256", secret, rawBody));
  const v1 = headers.v1?.trim().toLowerCase();
  if (v1) return constantTimeEqual(v1, await hmacHex("SHA-1", secret, rawBody));
  return false;
}

export interface ChannelEvent {
  noticeId: string;
  eventType: number;
  channelName: string;
  account: string;
  clientSeq: number;
  tsSeconds: number;
}

/** Returns the event to record, or null for anything that is not an RTC join/leave with the required fields. */
export function parseChannelEvent(body: unknown): ChannelEvent | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.noticeId !== "string" || b.noticeId.length === 0 || b.noticeId.length > 128) return null;
  if (b.productId !== undefined && b.productId !== RTC_PRODUCT_ID) return null;
  const eventType = b.eventType;
  if (typeof eventType !== "number" || !(JOIN_EVENTS.has(eventType) || LEAVE_EVENTS.has(eventType))) return null;
  const p = b.payload;
  if (!p || typeof p !== "object" || Array.isArray(p)) return null;
  const payload = p as Record<string, unknown>;
  const channelName = payload.channelName;
  const account = payload.account;
  const clientSeq = payload.clientSeq;
  const ts = payload.ts;
  if (typeof channelName !== "string" || !/^call_[0-9a-f-]{36}$/i.test(channelName)) return null;
  if (typeof account !== "string" || !/^[0-9a-f-]{36}$/i.test(account)) return null;
  if (typeof clientSeq !== "number" || !Number.isSafeInteger(clientSeq)) return null;
  if (typeof ts !== "number" || !Number.isSafeInteger(ts)) return null;
  return { noticeId: b.noticeId, eventType, channelName, account, clientSeq, tsSeconds: ts };
}

export interface NcsDeps {
  secret: string | undefined;
  record: (event: ChannelEvent) => Promise<{ ok: boolean }>;
}

export interface NcsResponse {
  status: number;
  body: Record<string, unknown>;
}

/**
 * 200 for anything Agora should not retry (recorded, duplicate, ignored); 401 for a bad signature; 500 when the
 * database write failed so Agora retries. Never echoes the payload.
 */
export async function handleNcs(
  rawBody: string,
  headers: { v2: string | null; v1: string | null },
  deps: NcsDeps,
): Promise<NcsResponse> {
  if (!deps.secret) return { status: 503, body: { ok: false, error: "not_configured" } };
  if (rawBody.length > MAX_BODY_BYTES) return { status: 413, body: { ok: false, error: "too_large" } };
  if (!(await verifyAgoraSignature(rawBody, headers, deps.secret))) {
    return { status: 401, body: { ok: false, error: "bad_signature" } };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { status: 200, body: { ok: true, status: "ignored" } };
  }
  const event = parseChannelEvent(parsed);
  if (!event) return { status: 200, body: { ok: true, status: "ignored" } };
  try {
    const result = await deps.record(event);
    if (!result.ok) return { status: 500, body: { ok: false, error: "record_failed" } };
  } catch {
    return { status: 500, body: { ok: false, error: "record_failed" } };
  }
  return { status: 200, body: { ok: true, status: "accepted" } };
}
