import { supabase, isSupabaseConfigured } from "./supabase";

// Chahat supports video calls only. There is no voice-only call type on the client.
export type CallType = "video";
export type CallStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "cancelled"
  | "timed_out"
  | "ended";
export type CallAction = "accept" | "decline" | "cancel" | "end";

export interface VideoCall {
  id: string;
  match_id: string;
  caller_id: string;
  recipient_id: string;
  call_type: CallType;
  status: CallStatus;
  created_at: string;
  expires_at: string;
  free_seconds_remaining: number | null;
}

/** Route params for opening the call screen. The id is ALWAYS the match id, never a user id. */
export function buildNewCallRoute(matchId: string, callType: CallType) {
  return { pathname: "/call/[id]" as const, params: { id: matchId, type: callType } };
}

export function buildExistingCallRoute(call: Pick<VideoCall, "id" | "match_id" | "call_type">) {
  return {
    pathname: "/call/[id]" as const,
    params: { id: call.match_id, callId: call.id, type: call.call_type },
  };
}

export async function createVideoCall(
  matchId: string,
  callType: CallType,
): Promise<{ callId: string; freeCallUntil: string | null }> {
  if (!isSupabaseConfigured()) throw new Error("Calls require a configured backend.");
  const { data, error } = await supabase.rpc("create_video_call", {
    _match_id: matchId,
    _call_type: callType,
  });
  if (error) throw new Error(`Could not create call invitation: ${error.message}`);
  if (!data?.success || typeof data.call_id !== "string") {
    throw new Error("The server did not create a call invitation.");
  }
  return { callId: data.call_id, freeCallUntil: data.free_call_until ?? null };
}

export async function transitionVideoCall(callId: string, action: CallAction): Promise<CallStatus> {
  if (!isSupabaseConfigured()) throw new Error("Calls require a configured backend.");
  const { data, error } = await supabase.rpc("transition_video_call", {
    _call_id: callId,
    _action: action,
  });
  if (error) throw new Error(`Could not update call: ${error.message}`);
  if (data?.success === false && data?.error === "daily_call_allowance_used") {
    throw new Error("The caller has used today's video-call time. It renews tomorrow.");
  }
  if (typeof data?.status !== "string") throw new Error("The server returned an invalid call state.");
  return data.status as CallStatus;
}

export async function getMyVideoCalls(): Promise<VideoCall[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await supabase.rpc("get_my_video_calls");
  if (error) throw new Error(`Could not load calls: ${error.message}`);
  if (!Array.isArray(data)) throw new Error("The server returned an invalid call list.");
  return data as VideoCall[];
}
