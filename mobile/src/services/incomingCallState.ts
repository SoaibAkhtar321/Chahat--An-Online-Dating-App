// Pure incoming-call state. The database row is the truth; Realtime events and push are hints. This
// reducer applies the documented recovery rules (docs/CALLS.md): take the snapshot, then only events
// newer than the snapshot, and never let a late event ring a call that is already closed.

export type CallKind = "video";

export interface IncomingCall {
  callId: string;
  matchId: string;
  callerId: string;
  callType: CallKind;
  expiresAt: string;
}

export interface ActiveCallRef {
  callId: string;
  matchId: string;
  callType: CallKind;
}

export interface CallSyncSnapshot {
  serverTime: string;
  lastEventId: number;
  incoming: IncomingCall[];
  active: ActiveCallRef[];
}

export interface CallEvent {
  id: number;
  callId: string;
  event: string;
  callType: CallKind;
  matchId: string;
  callerId: string;
  expiresAt: string;
}

export interface IncomingState {
  lastEventId: number;
  incoming: Record<string, IncomingCall>;
  active: Record<string, ActiveCallRef>;
  /** Calls known to be over. A late or replayed `incoming` event for one of these is ignored. */
  closed: Record<string, true>;
  /** Server clock minus device clock (ms), from the last snapshot. Expiry uses the server's clock. */
  clockOffsetMs: number;
}

export const EMPTY_INCOMING_STATE: IncomingState = {
  lastEventId: 0,
  incoming: {},
  active: {},
  closed: {},
  clockOffsetMs: 0,
};

const TERMINAL_EVENTS = new Set(["accepted", "declined", "cancelled", "timed_out", "ended"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CLOSED = 50;

function isKind(value: unknown): value is CallKind {
  return value === "video";
}
function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
function isTime(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/** Defensive parse of get_call_sync(). Returns null for a malformed payload instead of throwing. */
export function parseCallSync(data: unknown): CallSyncSnapshot | null {
  if (!data || typeof data !== "object") return null;
  const raw = data as Record<string, unknown>;
  if (!isTime(raw.server_time) || typeof raw.last_event_id !== "number") return null;
  const incoming: IncomingCall[] = [];
  for (const item of Array.isArray(raw.incoming) ? raw.incoming : []) {
    const r = item as Record<string, unknown>;
    if (isUuid(r?.call_id) && isUuid(r.match_id) && isUuid(r.caller_id) && isKind(r.call_type) && isTime(r.expires_at)) {
      incoming.push({
        callId: r.call_id.toLowerCase(),
        matchId: r.match_id.toLowerCase(),
        callerId: r.caller_id.toLowerCase(),
        callType: r.call_type,
        expiresAt: r.expires_at,
      });
    }
  }
  const active: ActiveCallRef[] = [];
  for (const item of Array.isArray(raw.active) ? raw.active : []) {
    const r = item as Record<string, unknown>;
    if (isUuid(r?.call_id) && isUuid(r.match_id) && isKind(r.call_type)) {
      active.push({ callId: r.call_id.toLowerCase(), matchId: r.match_id.toLowerCase(), callType: r.call_type });
    }
  }
  return { serverTime: raw.server_time, lastEventId: raw.last_event_id, incoming, active };
}

/** Defensive parse of a call_events Realtime row. */
export function parseCallEvent(row: unknown): CallEvent | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (
    typeof r.id !== "number" ||
    typeof r.event !== "string" ||
    !isUuid(r.call_id) ||
    !isUuid(r.match_id) ||
    !isUuid(r.caller_id) ||
    !isKind(r.call_type) ||
    !isTime(r.expires_at)
  ) {
    return null;
  }
  return {
    id: r.id,
    callId: r.call_id.toLowerCase(),
    event: r.event,
    callType: r.call_type,
    matchId: r.match_id.toLowerCase(),
    callerId: r.caller_id.toLowerCase(),
    expiresAt: r.expires_at,
  };
}

function remember(closed: Record<string, true>, callIds: string[]): Record<string, true> {
  const next = { ...closed };
  for (const id of callIds) next[id] = true;
  const keys = Object.keys(next);
  if (keys.length > MAX_CLOSED) for (const key of keys.slice(0, keys.length - MAX_CLOSED)) delete next[key];
  return next;
}

/** The snapshot replaces what we believe; calls that disappeared from it are remembered as closed. */
export function applySnapshot(state: IncomingState, snapshot: CallSyncSnapshot, nowMs: number): IncomingState {
  const incoming: Record<string, IncomingCall> = {};
  for (const call of snapshot.incoming) incoming[call.callId] = call;
  const active: Record<string, ActiveCallRef> = {};
  for (const call of snapshot.active) active[call.callId] = call;
  const gone = [...Object.keys(state.incoming), ...Object.keys(state.active)].filter(
    (id) => !incoming[id] && !active[id],
  );
  // A call the server lists as still ringing cannot be "closed", even if an older event said so.
  const closed = { ...state.closed };
  for (const id of Object.keys(incoming)) delete closed[id];
  return {
    lastEventId: Math.max(state.lastEventId, snapshot.lastEventId),
    incoming,
    active,
    closed: remember(closed, gone),
    clockOffsetMs: Date.parse(snapshot.serverTime) - nowMs,
  };
}

export function applyEvent(state: IncomingState, event: CallEvent): IncomingState {
  // Already covered by a snapshot or applied before: duplicate delivery changes nothing.
  if (event.id <= state.lastEventId) return state;
  const lastEventId = event.id;
  if (event.event === "incoming") {
    if (state.closed[event.callId] || state.active[event.callId]) return { ...state, lastEventId };
    return {
      ...state,
      lastEventId,
      incoming: {
        ...state.incoming,
        [event.callId]: {
          callId: event.callId,
          matchId: event.matchId,
          callerId: event.callerId,
          callType: event.callType,
          expiresAt: event.expiresAt,
        },
      },
    };
  }
  if (!TERMINAL_EVENTS.has(event.event)) return { ...state, lastEventId };
  const incoming = { ...state.incoming };
  delete incoming[event.callId];
  const active = { ...state.active };
  if (event.event === "accepted") {
    active[event.callId] = { callId: event.callId, matchId: event.matchId, callType: event.callType };
  } else {
    delete active[event.callId];
  }
  return { ...state, lastEventId, incoming, active, closed: remember(state.closed, [event.callId]) };
}

/** Marks a call as locally resolved (answered, declined, or found to be gone) without waiting for an event. */
export function markResolved(state: IncomingState, callId: string, active?: ActiveCallRef): IncomingState {
  const incoming = { ...state.incoming };
  delete incoming[callId];
  const nextActive = { ...state.active };
  if (active) nextActive[callId] = active;
  return { ...state, incoming, active: active ? nextActive : state.active, closed: remember(state.closed, [callId]) };
}

export function isExpired(call: IncomingCall, nowMs: number, clockOffsetMs: number): boolean {
  return Date.parse(call.expiresAt) <= nowMs + clockOffsetMs;
}

/**
 * The call to ring for right now: the newest unexpired one, and none while another call is active
 * (the server already refuses a second call to a busy participant; this keeps the UI consistent).
 */
export function pickRingingCall(state: IncomingState, nowMs: number): IncomingCall | null {
  if (Object.keys(state.active).length > 0) return null;
  const live = Object.values(state.incoming).filter((call) => !isExpired(call, nowMs, state.clockOffsetMs));
  if (live.length === 0) return null;
  return live.sort((a, b) => Date.parse(b.expiresAt) - Date.parse(a.expiresAt))[0]!;
}
