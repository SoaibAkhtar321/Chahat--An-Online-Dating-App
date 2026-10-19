// Supabase wiring for incoming-call signaling: the recovery snapshot and the Realtime subscription to
// the signed-in user's own call_events rows (RLS limits them to user_id = auth.uid()).
import { supabase, isSupabaseConfigured } from "./supabase";
import {
  parseCallEvent,
  parseCallSync,
  type CallEvent,
  type CallSyncSnapshot,
} from "./incomingCallState";

export async function fetchCallSync(): Promise<CallSyncSnapshot> {
  if (!isSupabaseConfigured()) throw new Error("Calls require a configured backend.");
  const { data, error } = await supabase.rpc("get_call_sync");
  if (error) throw new Error(`Could not load call state: ${error.message}`);
  const snapshot = parseCallSync(data);
  if (!snapshot) throw new Error("The server returned an invalid call snapshot.");
  return snapshot;
}

/**
 * Subscribes to this user's call events. `onSubscribed` fires on every (re)connection so the caller can
 * re-run the recovery snapshot and not miss anything that happened while the socket was down.
 * Returns an unsubscribe function.
 */
export function subscribeToCallEvents(
  userId: string,
  onEvent: (event: CallEvent) => void,
  onSubscribed: () => void,
): () => void {
  if (!isSupabaseConfigured()) return () => undefined;
  const channel = supabase
    .channel(`call_events:${userId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "call_events", filter: `user_id=eq.${userId}` },
      (payload) => {
        const event = parseCallEvent(payload.new);
        if (event) onEvent(event);
      },
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") onSubscribed();
    });
  return () => {
    void supabase.removeChannel(channel);
  };
}
