import {
  applyEvent,
  applySnapshot,
  EMPTY_INCOMING_STATE,
  markResolved,
  parseCallEvent,
  parseCallSync,
  pickRingingCall,
  type CallEvent,
  type CallSyncSnapshot,
} from "../mobile/src/services/incomingCallState";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NOW = Date.parse("2026-10-19T10:00:00Z");
const iso = (offsetSec: number) => new Date(NOW + offsetSec * 1000).toISOString();

const snap = (over: Partial<CallSyncSnapshot> = {}): CallSyncSnapshot => ({
  serverTime: iso(0),
  lastEventId: 10,
  incoming: [],
  active: [],
  ...over,
});
const ringing = (callId = U(1), expiresInSec = 60) => ({
  callId,
  matchId: U(100),
  callerId: U(200),
  callType: "video" as const,
  expiresAt: iso(expiresInSec),
});
const event = (id: number, name: string, callId = U(1), expiresInSec = 60): CallEvent => ({
  id,
  callId,
  event: name,
  callType: "video",
  matchId: U(100),
  callerId: U(200),
  expiresAt: iso(expiresInSec),
});

describe("snapshot and events", () => {
  it("rings for a call in the snapshot", () => {
    const s = applySnapshot(EMPTY_INCOMING_STATE, snap({ incoming: [ringing()] }), NOW);
    expect(pickRingingCall(s, NOW)?.callId).toBe(U(1));
  });
  it("ignores events the snapshot already covers (duplicate or replayed delivery)", () => {
    const s = applySnapshot(EMPTY_INCOMING_STATE, snap({ lastEventId: 10 }), NOW);
    expect(applyEvent(s, event(10, "incoming"))).toBe(s);
    expect(applyEvent(s, event(7, "incoming"))).toBe(s);
  });
  it("applies the same incoming event only once", () => {
    let s = applySnapshot(EMPTY_INCOMING_STATE, snap(), NOW);
    s = applyEvent(s, event(11, "incoming"));
    const again = applyEvent(s, event(11, "incoming"));
    expect(again).toBe(s);
    expect(Object.keys(s.incoming)).toEqual([U(1)]);
  });
  it.each(["cancelled", "declined", "timed_out", "ended", "accepted"])(
    "%s clears the ringing call and a late incoming event cannot ring it again",
    (terminal) => {
      let s = applySnapshot(EMPTY_INCOMING_STATE, snap(), NOW);
      s = applyEvent(s, event(11, "incoming"));
      s = applyEvent(s, event(12, terminal));
      expect(pickRingingCall(s, NOW)).toBeNull();
      s = applyEvent(s, event(13, "incoming")); // out-of-order / replayed
      expect(pickRingingCall(s, NOW)).toBeNull();
    },
  );
  it("an accepted call makes the call active and silences any other ringing call (second call while busy)", () => {
    let s = applySnapshot(EMPTY_INCOMING_STATE, snap({ incoming: [ringing(U(1)), ringing(U(2))] }), NOW);
    s = applyEvent(s, event(11, "accepted", U(1)));
    expect(Object.keys(s.active)).toEqual([U(1)]);
    expect(pickRingingCall(s, NOW)).toBeNull();
  });
  it("a later snapshot is authoritative and un-closes a call the server still lists as ringing", () => {
    let s = applySnapshot(EMPTY_INCOMING_STATE, snap(), NOW);
    s = applyEvent(s, event(11, "cancelled"));
    s = applySnapshot(s, snap({ lastEventId: 12, incoming: [ringing()] }), NOW);
    expect(pickRingingCall(s, NOW)?.callId).toBe(U(1));
  });
  it("remembers calls that vanished from the snapshot as closed", () => {
    let s = applySnapshot(EMPTY_INCOMING_STATE, snap({ incoming: [ringing()] }), NOW);
    s = applySnapshot(s, snap({ lastEventId: 11 }), NOW);
    s = applyEvent(s, event(12, "incoming"));
    expect(pickRingingCall(s, NOW)).toBeNull();
  });
  it("does not ring an expired call, using the server clock when the device clock is wrong", () => {
    const behind = NOW - 5 * 60 * 1000; // device clock 5 minutes slow
    let s = applySnapshot(EMPTY_INCOMING_STATE, snap({ incoming: [ringing(U(1), 30)] }), behind);
    expect(pickRingingCall(s, behind)?.callId).toBe(U(1));
    expect(pickRingingCall(s, behind + 29_000)?.callId).toBe(U(1));
    expect(pickRingingCall(s, behind + 31_000)).toBeNull();
    s = markResolved(s, U(1));
    expect(pickRingingCall(s, behind)).toBeNull();
  });
  it("picks the newest ringing call when several are pending", () => {
    const s = applySnapshot(EMPTY_INCOMING_STATE, snap({ incoming: [ringing(U(1), 20), ringing(U(2), 50)] }), NOW);
    expect(pickRingingCall(s, NOW)?.callId).toBe(U(2));
  });
});

describe("defensive parsing", () => {
  it("parses a valid get_call_sync payload", () => {
    const parsed = parseCallSync({
      server_time: iso(0),
      last_event_id: 5,
      incoming: [{ call_id: U(1), match_id: U(2), caller_id: U(3), call_type: "video", expires_at: iso(60) }],
      active: [{ call_id: U(4), match_id: U(2), call_type: "video" }],
    });
    expect(parsed?.incoming[0]).toMatchObject({ callId: U(1), callType: "video" });
    expect(parsed?.active[0]).toMatchObject({ callId: U(4), callType: "video" });
  });
  it("drops audio calls: they are neither rung nor tracked as active", () => {
    const parsed = parseCallSync({
      server_time: iso(0),
      last_event_id: 5,
      incoming: [{ call_id: U(1), match_id: U(2), caller_id: U(3), call_type: "audio", expires_at: iso(60) }],
      active: [{ call_id: U(4), match_id: U(2), call_type: "audio" }],
    });
    expect(parsed?.incoming).toEqual([]);
    expect(parsed?.active).toEqual([]);
  });
  it("skips malformed entries and rejects malformed envelopes", () => {
    expect(
      parseCallSync({ server_time: iso(0), last_event_id: 1, incoming: [{ call_id: "x" }], active: [null] })?.incoming,
    ).toEqual([]);
    expect(parseCallSync(null)).toBeNull();
    expect(parseCallSync({ server_time: "bad", last_event_id: 1 })).toBeNull();
    expect(parseCallSync({ server_time: iso(0) })).toBeNull();
  });
  it("parses a call_events row and rejects forged shapes", () => {
    const row = { id: 3, call_id: U(1), user_id: U(9), event: "incoming", call_type: "video", match_id: U(2), caller_id: U(3), expires_at: iso(60) };
    expect(parseCallEvent(row)).toMatchObject({ id: 3, callId: U(1), event: "incoming" });
    expect(parseCallEvent({ ...row, call_id: "x" })).toBeNull();
    expect(parseCallEvent({ ...row, call_type: "x" })).toBeNull();
    expect(parseCallEvent({ ...row, id: "3" })).toBeNull();
    expect(parseCallEvent(undefined)).toBeNull();
  });
});
