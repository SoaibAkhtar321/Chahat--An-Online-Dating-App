/**
 * Pure typing-indicator logic. No React, no network: the timers are injectable so everything is unit-testable.
 *
 * Sender: while the user keeps typing, "typing" is re-sent at most every TYPING_REFRESH_MS; "stopped" is sent after
 * TYPING_IDLE_MS without a keystroke, when the box is emptied, or when the message is sent.
 * Receiver: a "typing" signal expires on its own after TYPING_EXPIRE_MS, so a lost "stopped" can never leave the
 * indicator stuck on.
 */

export const TYPING_REFRESH_MS = 3000;
export const TYPING_IDLE_MS = 4000;
export const TYPING_EXPIRE_MS = 6000;

export interface TypingEmitter {
  /** Call on every change of the input box. */
  input(hasText: boolean): void;
  /** The user sent the message or left the screen. Emits "stopped" if a "typing" is outstanding. */
  stop(): void;
}

export function createTypingEmitter(send: (typing: boolean) => void, now: () => number = Date.now): TypingEmitter {
  let active = false;
  let lastSentAt = 0;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const clearIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  };

  const stop = () => {
    clearIdle();
    if (!active) return;
    active = false;
    send(false);
  };

  return {
    input(hasText: boolean) {
      if (!hasText) {
        stop();
        return;
      }
      const t = now();
      if (!active || t - lastSentAt >= TYPING_REFRESH_MS) {
        active = true;
        lastSentAt = t;
        send(true);
      }
      clearIdle();
      idleTimer = setTimeout(stop, TYPING_IDLE_MS);
    },
    stop,
  };
}

export interface TypingReceiver {
  receive(typing: boolean): void;
  dispose(): void;
}

export function createTypingReceiver(onChange: (typing: boolean) => void): TypingReceiver {
  let typing = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const set = (next: boolean) => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (next) timer = setTimeout(() => set(false), TYPING_EXPIRE_MS);
    if (next === typing) return;
    typing = next;
    onChange(next);
  };

  return {
    receive: set,
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

/** Header line under the partner's name. Typing wins over online; nothing is claimed when neither is known. */
export function presenceLabel(online: boolean, typing: boolean): string {
  if (typing) return "typing…";
  if (online) return "online";
  return "";
}
