// Requests a join token for an accepted call. Authorization is decided entirely by the server:
// the client sends only the call id and the server derives the user from the verified JWT.
import { supabase, isSupabaseConfigured } from "./supabase";
import { CallError, type CallErrorCode, type CallJoinGrant } from "./callMedia";

export interface InvokeResult {
  data: unknown;
  error: unknown;
}
export type InvokeFunction = (callId: string) => Promise<InvokeResult>;

const SERVER_CODE_MAP: Record<string, CallErrorCode> = {
  unauthenticated: "unauthenticated",
  rate_limited: "rate_limited",
  insufficient_coins: "insufficient_coins",
  provider_not_configured: "provider_not_configured",
  provider_error: "provider_error",
  call_not_found: "call_unavailable",
  call_not_allowed: "call_unavailable",
  call_not_accepted: "call_unavailable",
  call_ended: "call_unavailable",
  call_expired: "call_unavailable",
};

const defaultInvoke: InvokeFunction = (callId) =>
  supabase.functions.invoke("issue-call-token", { body: { call_id: callId } });

async function readServerCode(error: unknown): Promise<string | null> {
  const context = (error as { context?: unknown } | null)?.context;
  if (context && typeof (context as Response).json === "function") {
    try {
      const body = await (context as Response).json();
      return typeof body?.code === "string" ? body.code : null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function requestCallToken(
  callId: string,
  invoke: InvokeFunction = defaultInvoke,
  configured: boolean = isSupabaseConfigured(),
): Promise<CallJoinGrant> {
  if (!configured) throw new CallError("network", "Calls require a configured backend.");
  if (typeof callId !== "string" || callId.length === 0) throw new CallError("call_unavailable");

  let result: InvokeResult;
  try {
    result = await invoke(callId);
  } catch {
    throw new CallError("network");
  }

  if (result.error) {
    const serverCode = await readServerCode(result.error);
    if (serverCode) throw new CallError(SERVER_CODE_MAP[serverCode] ?? "provider_error");
    throw new CallError("network");
  }

  const data = result.data as Record<string, unknown> | null;
  if (
    !data ||
    data.success !== true ||
    typeof data.provider !== "string" ||
    typeof data.room_id !== "string" ||
    typeof data.token !== "string" ||
    data.token.length === 0 ||
    typeof data.expires_at !== "string" ||
    data.call_type !== "video"
  ) {
    throw new CallError("provider_error");
  }
  return {
    provider: data.provider,
    roomId: data.room_id,
    token: data.token,
    expiresAt: data.expires_at,
    callType: data.call_type,
  };
}
