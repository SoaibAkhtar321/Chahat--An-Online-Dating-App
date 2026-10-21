import { AppState } from "react-native";
import { supabase } from "./supabase";
import { createTypingEmitter, createTypingReceiver } from "../utils/typingState";

/**
 * Online + typing for one chat, over a Realtime channel (presence for "online", broadcast for "typing").
 * Nothing is stored in the database. Everything here is best effort: if Realtime is unavailable the chat keeps working
 * and the indicators simply stay off.
 */

export interface ChatPresenceHandlers {
  onPartnerOnline: (online: boolean) => void;
  onPartnerTyping: (typing: boolean) => void;
}

export interface ChatPresence {
  /** Call on every change of the input box. */
  notifyInput: (hasText: boolean) => void;
  /** The message was sent: tell the partner typing stopped. */
  notifyStopped: () => void;
  leave: () => void;
}

const NOOP: ChatPresence = { notifyInput: () => undefined, notifyStopped: () => undefined, leave: () => undefined };

export function joinChatPresence(matchId: string, userId: string, handlers: ChatPresenceHandlers): ChatPresence {
  try {
    const channel = supabase.channel(`chat_presence_${matchId}`, {
      config: { presence: { key: userId }, broadcast: { self: false } },
    });
    let subscribed = false;
    let left = false;

    const receiver = createTypingReceiver(handlers.onPartnerTyping);
    const emitter = createTypingEmitter((typing) => {
      if (!subscribed || left) return;
      void channel.send({ type: "broadcast", event: "typing", payload: { userId, typing } });
    });

    const partnerOnline = (): boolean => {
      const state = channel.presenceState() as Record<string, unknown[]>;
      return Object.keys(state).some((key) => key !== userId && (state[key]?.length ?? 0) > 0);
    };

    channel
      .on("presence", { event: "sync" }, () => {
        const online = partnerOnline();
        handlers.onPartnerOnline(online);
        if (!online) receiver.receive(false);
      })
      .on("broadcast", { event: "typing" }, ({ payload }: { payload?: { userId?: string; typing?: boolean } }) => {
        if (!payload || payload.userId === userId) return;
        receiver.receive(!!payload.typing);
      })
      .subscribe((status: string) => {
        if (status !== "SUBSCRIBED") {
          subscribed = false;
          return;
        }
        subscribed = true;
        if (AppState.currentState === "active") void channel.track({ online: true });
      });

    // Like WhatsApp: backgrounded means not online (and not typing).
    const appStateSub = AppState.addEventListener("change", (state) => {
      if (!subscribed || left) return;
      if (state === "active") {
        void channel.track({ online: true });
      } else {
        emitter.stop();
        void channel.untrack();
      }
    });

    return {
      // Before the channel is subscribed nothing can be delivered, so don't let the emitter think "typing" was sent.
      notifyInput: (hasText) => {
        if (subscribed && !left) emitter.input(hasText);
      },
      notifyStopped: () => emitter.stop(),
      leave: () => {
        if (left) return;
        emitter.stop();
        left = true;
        receiver.dispose();
        appStateSub?.remove?.();
        void supabase.removeChannel(channel);
      },
    };
  } catch {
    return NOOP;
  }
}
