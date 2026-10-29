// Orchestrates the incoming-call lifecycle for the signed-in user. Framework-free: every side effect is
// injected, so the whole state machine (answer, decline, races, expiry, offline, sign-out) is unit tested.
//
// Authority: the server decides. Answer and Decline call transition_video_call, which validates the
// recipient and applies the change atomically under a row lock. This controller never trusts the push
// payload, a cached tier or its own state to decide that a call may be answered.
import {
  applyEvent,
  applySnapshot,
  EMPTY_INCOMING_STATE,
  isExpired,
  markResolved,
  pickRingingCall,
  type ActiveCallRef,
  type CallEvent,
  type CallSyncSnapshot,
  type IncomingCall,
  type IncomingState,
} from "./incomingCallState";
import { parseCallNotificationData, resolveCallNotificationAction } from "./callNotificationPolicy";

export interface CallRoute {
  callId: string;
  matchId: string;
  callType: "video";
}

export interface IncomingCallDeps {
  fetchSync(): Promise<CallSyncSnapshot>;
  /** Server transition. Resolves to the resulting call status; rejects on RPC error. */
  transition(callId: string, action: "accept" | "decline"): Promise<string>;
  openCall(route: CallRoute): void;
  /** Remove system notifications for this call (all call notifications when callId is omitted). */
  dismissNotifications(callId?: string): Promise<void>;
  startRinging(): void;
  stopRinging(): void;
  tell(title: string, message: string): void;
  isCallingAvailable(): boolean;
  /** True while the phone is in another phone / VoIP call (optional; answering is then refused). */
  isPhoneBusy?(): boolean;
  now(): number;
}

export type AnswerOutcome =
  | { kind: "answered"; route: CallRoute }
  | { kind: "unavailable" }
  | { kind: "gone" }
  | { kind: "busy" }
  | { kind: "network" };
export type DeclineOutcome = { kind: "declined" } | { kind: "gone" } | { kind: "busy" } | { kind: "offline" };

export interface IncomingCallView {
  ringing: IncomingCall | null;
}

export interface IncomingCallController {
  start(userId: string): Promise<void>;
  stop(): void;
  sync(): Promise<void>;
  handleEvent(event: CallEvent): void;
  answer(callId: string, hint?: { matchId?: string | null; callType?: "video" | null }): Promise<AnswerOutcome>;
  decline(callId: string): Promise<DeclineOutcome>;
  handleNotificationResponse(response: { actionIdentifier: unknown; data: unknown }): Promise<void>;
  getView(): IncomingCallView;
  subscribe(listener: () => void): () => void;
}

const GONE_TITLE = "Call ended";
const GONE_MESSAGE = "This call is no longer available.";

export function createIncomingCallController(deps: IncomingCallDeps): IncomingCallController {
  let userId: string | null = null;
  let generation = 0; // bumps on stop()/user change so late async results are dropped
  let state: IncomingState = EMPTY_INCOMING_STATE;
  let view: IncomingCallView = { ringing: null };
  let expiryTimer: ReturnType<typeof setTimeout> | null = null;
  let ringingId: string | null = null;
  const inflight = new Set<string>();
  const listeners = new Set<() => void>();

  const emit = () => listeners.forEach((listener) => listener());

  function clearTimer() {
    if (expiryTimer) clearTimeout(expiryTimer);
    expiryTimer = null;
  }

  /** Recomputes what is ringing, starts/stops the ring, and clears notifications of finished calls. */
  function reconcile(previous: IncomingState | null) {
    const ringing = deps.isCallingAvailable() ? pickRingingCall(state, deps.now()) : null;
    if (ringing?.callId !== ringingId) {
      if (ringing) deps.startRinging();
      else deps.stopRinging();
      ringingId = ringing?.callId ?? null;
    }
    clearTimer();
    if (ringing) {
      const remaining = Date.parse(ringing.expiresAt) - (deps.now() + state.clockOffsetMs);
      expiryTimer = setTimeout(() => reconcile(null), Math.max(0, remaining) + 50);
    }
    // A call that left the ringing set (answered elsewhere, cancelled, declined, expired) must not
    // leave a stale notification behind.
    if (previous) {
      for (const id of Object.keys(previous.incoming)) {
        const still = state.incoming[id] && !isExpired(state.incoming[id]!, deps.now(), state.clockOffsetMs);
        if (!still) void deps.dismissNotifications(id).catch(() => undefined);
      }
    }
    for (const call of Object.values(state.incoming)) {
      if (isExpired(call, deps.now(), state.clockOffsetMs)) void deps.dismissNotifications(call.callId).catch(() => undefined);
    }
    if (view.ringing?.callId !== ringing?.callId) {
      view = { ringing };
      emit();
    }
  }

  function set(next: IncomingState) {
    const previous = state;
    state = next;
    reconcile(previous);
  }

  async function sync(): Promise<void> {
    if (!userId) return;
    const mine = generation;
    const snapshot = await deps.fetchSync();
    if (mine !== generation) return;
    set(applySnapshot(state, snapshot, deps.now()));
  }

  function routeFor(callId: string, hint?: { matchId?: string | null; callType?: "video" | null }): CallRoute | null {
    const known: IncomingCall | ActiveCallRef | undefined = state.incoming[callId] ?? state.active[callId];
    const matchId = known?.matchId ?? hint?.matchId ?? null;
    const callType = known?.callType ?? hint?.callType ?? null;
    return matchId && callType ? { callId, matchId, callType } : null;
  }

  async function answer(callId: string, hint?: { matchId?: string | null; callType?: "video" | null }): Promise<AnswerOutcome> {
    if (!userId) return { kind: "gone" };
    if (inflight.has(callId)) return { kind: "busy" };
    if (!deps.isCallingAvailable()) {
      deps.tell("Calling isn't available yet", "This version of Chahat can't connect calls yet, so the call was not answered.");
      return { kind: "unavailable" };
    }
    if (deps.isPhoneBusy?.()) {
      deps.tell("You're on another call", "End your current phone or WhatsApp call to answer this video call.");
      return { kind: "busy" };
    }
    const mine = generation;
    inflight.add(callId);
    try {
      let status: string | null = null;
      let failed = false;
      try {
        status = await deps.transition(callId, "accept");
      } catch {
        failed = true;
      }
      if (mine !== generation) return { kind: "gone" };
      if (!failed && status === "accepted") {
        let route = routeFor(callId, hint);
        set(markResolved(state, callId, route ?? undefined));
        void deps.dismissNotifications(callId).catch(() => undefined);
        if (!route) {
          // Cold start with an incomplete payload: the server's active list names the match.
          try {
            await sync();
            route = routeFor(callId, hint);
          } catch {
            /* the call screen can still load the call by id */
          }
        }
        if (!route) {
          deps.tell(GONE_TITLE, "Couldn't open the call. Please try again from the Calls screen.");
          return { kind: "gone" };
        }
        deps.openCall(route);
        return { kind: "answered", route };
      }
      // Failed or not accepted (expired, cancelled, declined elsewhere, answered on another device...).
      // Ask the server what the call really is before telling the user anything.
      try {
        await sync();
      } catch {
        if (mine !== generation) return { kind: "gone" };
        deps.tell("Couldn't answer", "Check your connection and try again.");
        return { kind: "network" };
      }
      if (mine !== generation) return { kind: "gone" };
      const active = routeFor(callId, hint);
      if (state.active[callId] && active) {
        void deps.dismissNotifications(callId).catch(() => undefined);
        deps.openCall(active);
        return { kind: "answered", route: active };
      }
      if (state.incoming[callId] && !isExpired(state.incoming[callId]!, deps.now(), state.clockOffsetMs)) {
        deps.tell("Couldn't answer", "Check your connection and try again.");
        return { kind: "network" };
      }
      set(markResolved(state, callId));
      void deps.dismissNotifications(callId).catch(() => undefined);
      deps.tell(GONE_TITLE, GONE_MESSAGE);
      return { kind: "gone" };
    } finally {
      inflight.delete(callId);
    }
  }

  async function decline(callId: string): Promise<DeclineOutcome> {
    if (!userId) return { kind: "gone" };
    if (inflight.has(callId)) return { kind: "busy" };
    const mine = generation;
    inflight.add(callId);
    try {
      // Stop the noise immediately; the server confirms (or corrects) below.
      void deps.dismissNotifications(callId).catch(() => undefined);
      let status: string | null = null;
      let failed = false;
      try {
        status = await deps.transition(callId, "decline");
      } catch {
        failed = true;
      }
      if (mine !== generation) return { kind: "gone" };
      if (!failed && status === "declined") {
        set(markResolved(state, callId));
        return { kind: "declined" };
      }
      try {
        await sync();
      } catch {
        // Offline: silence this device. The invitation expires on the server within its 60 s window and
        // the caller then sees "no answer". Never claim the caller was told.
        set(markResolved(state, callId));
        return { kind: "offline" };
      }
      if (mine !== generation) return { kind: "gone" };
      set(markResolved(state, callId));
      return { kind: "gone" };
    } finally {
      inflight.delete(callId);
    }
  }

  function stop() {
    generation += 1;
    userId = null;
    clearTimer();
    inflight.clear();
    state = EMPTY_INCOMING_STATE;
    ringingId = null;
    deps.stopRinging();
    void deps.dismissNotifications().catch(() => undefined);
    if (view.ringing) {
      view = { ringing: null };
      emit();
    }
  }

  async function start(nextUserId: string): Promise<void> {
    if (userId === nextUserId) return;
    if (userId) stop();
    userId = nextUserId;
    try {
      await sync();
    } catch {
      // Offline at start-up: the Realtime reconnect and foreground hooks call sync() again.
    }
  }

  return {
    start,
    stop,
    sync,
    handleEvent(event) {
      if (!userId) return;
      set(applyEvent(state, event));
    },
    answer,
    decline,
    async handleNotificationResponse(response) {
      const data = parseCallNotificationData(response.data);
      const action = resolveCallNotificationAction(response.actionIdentifier);
      if (!data || !action || !userId) return;
      if (action === "answer") {
        await answer(data.callId, data);
        return;
      }
      if (action === "decline") {
        await decline(data.callId);
        return;
      }
      // Plain tap: show the in-app incoming-call screen if the call is still ringing, otherwise say so.
      try {
        await sync();
      } catch {
        deps.tell("Couldn't check the call", "Check your connection and try again.");
        return;
      }
      const call = state.incoming[data.callId];
      if (state.active[data.callId]) {
        const route = routeFor(data.callId, data);
        if (route) deps.openCall(route);
        return;
      }
      if (!call || isExpired(call, deps.now(), state.clockOffsetMs)) {
        void deps.dismissNotifications(data.callId).catch(() => undefined);
        deps.tell(GONE_TITLE, GONE_MESSAGE);
      }
    },
    getView: () => view,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
