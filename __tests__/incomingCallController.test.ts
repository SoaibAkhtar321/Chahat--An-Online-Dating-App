import {
  createIncomingCallController,
  type IncomingCallDeps,
} from "../mobile/src/services/incomingCallController";
import type { CallEvent, CallSyncSnapshot } from "../mobile/src/services/incomingCallState";
import { CALL_ACTION_ANSWER, CALL_ACTION_DECLINE, NOTIFICATION_DEFAULT_ACTION } from "../mobile/src/services/callNotificationPolicy";

const CALL = "11111111-1111-4111-8111-111111111111";
const CALL2 = "33333333-3333-4333-8333-333333333333";
const MATCH = "22222222-2222-4222-8222-222222222222";
const CALLER = "44444444-4444-4444-8444-444444444444";
const NOW0 = Date.parse("2026-10-19T10:00:00Z");

let clock = NOW0;
const iso = (offsetSec: number) => new Date(NOW0 + offsetSec * 1000).toISOString();
const incomingEntry = (callId = CALL, expiresInSec = 60) => ({
  callId, matchId: MATCH, callerId: CALLER, callType: "video" as const, expiresAt: iso(expiresInSec),
});
const snapshot = (over: Partial<CallSyncSnapshot> = {}): CallSyncSnapshot => ({
  serverTime: new Date(clock).toISOString(), lastEventId: 1, incoming: [], active: [], ...over,
});
const event = (id: number, name: string, callId = CALL): CallEvent => ({
  id, callId, event: name, callType: "video", matchId: MATCH, callerId: CALLER, expiresAt: iso(60),
});

function setup(initial: CallSyncSnapshot = snapshot({ incoming: [incomingEntry()] })) {
  let current = initial;
  const deps = {
    fetchSync: jest.fn(async () => current),
    transition: jest.fn(async (_id: string, action: "accept" | "decline") => (action === "accept" ? "accepted" : "declined")),
    openCall: jest.fn(),
    dismissNotifications: jest.fn(async () => undefined),
    startRinging: jest.fn(),
    stopRinging: jest.fn(),
    tell: jest.fn(),
    isCallingAvailable: jest.fn(() => true),
    now: () => clock,
  };
  const controller = createIncomingCallController(deps as IncomingCallDeps);
  return { controller, deps, setSnapshot: (s: CallSyncSnapshot) => { current = s; } };
}

beforeEach(() => {
  clock = NOW0;
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe("ringing", () => {
  it("rings once for a call found at start-up and exposes it to the UI", async () => {
    const { controller, deps } = setup();
    await controller.start("user-b");
    expect(controller.getView().ringing?.callId).toBe(CALL);
    expect(deps.startRinging).toHaveBeenCalledTimes(1);
  });
  it("duplicate pushes/events for the same call never ring twice", async () => {
    const { controller, deps } = setup(snapshot());
    await controller.start("user-b");
    controller.handleEvent(event(5, "incoming"));
    controller.handleEvent(event(5, "incoming"));
    await controller.sync();
    controller.handleEvent(event(6, "incoming"));
    expect(deps.startRinging).toHaveBeenCalledTimes(1);
  });
  it("stops ringing and clears the notification when the caller cancels", async () => {
    const { controller, deps } = setup(snapshot());
    await controller.start("user-b");
    controller.handleEvent(event(5, "incoming"));
    controller.handleEvent(event(6, "cancelled"));
    expect(controller.getView().ringing).toBeNull();
    expect(deps.stopRinging).toHaveBeenCalled();
    expect(deps.dismissNotifications).toHaveBeenCalledWith(CALL);
  });
  it("stops ringing by itself when the invitation expires", async () => {
    const { controller, deps } = setup(snapshot({ incoming: [incomingEntry(CALL, 30)] }));
    await controller.start("user-b");
    expect(controller.getView().ringing).not.toBeNull();
    clock += 31_000;
    jest.advanceTimersByTime(31_000);
    expect(controller.getView().ringing).toBeNull();
    expect(deps.stopRinging).toHaveBeenCalled();
    expect(deps.dismissNotifications).toHaveBeenCalledWith(CALL);
  });
  it("does not ring when another call is already active (second call while busy)", async () => {
    const { controller, deps } = setup(
      snapshot({ incoming: [incomingEntry(CALL2)], active: [{ callId: CALL, matchId: MATCH, callType: "audio" }] }),
    );
    await controller.start("user-b");
    expect(controller.getView().ringing).toBeNull();
    expect(deps.startRinging).not.toHaveBeenCalled();
  });
  it("does not ring when this build cannot connect calls", async () => {
    const { controller, deps } = setup();
    deps.isCallingAvailable.mockReturnValue(false);
    await controller.start("user-b");
    expect(controller.getView().ringing).toBeNull();
    expect(deps.startRinging).not.toHaveBeenCalled();
  });
  it("recovers after being offline: a failed first sync is retried by sync()", async () => {
    const { controller, deps } = setup();
    deps.fetchSync.mockRejectedValueOnce(new Error("offline"));
    await controller.start("user-b");
    expect(controller.getView().ringing).toBeNull();
    await controller.sync();
    expect(controller.getView().ringing?.callId).toBe(CALL);
  });
});

describe("answer", () => {
  it("asks the server, opens the call and silences everything", async () => {
    const { controller, deps } = setup();
    await controller.start("user-b");
    const result = await controller.answer(CALL);
    expect(deps.transition).toHaveBeenCalledWith(CALL, "accept");
    expect(result).toEqual({ kind: "answered", route: { callId: CALL, matchId: MATCH, callType: "video" } });
    expect(deps.openCall).toHaveBeenCalledWith({ callId: CALL, matchId: MATCH, callType: "video" });
    expect(controller.getView().ringing).toBeNull();
    expect(deps.stopRinging).toHaveBeenCalled();
    expect(deps.dismissNotifications).toHaveBeenCalledWith(CALL);
  });
  it("concurrent answer taps send exactly one request", async () => {
    const { controller, deps } = setup();
    await controller.start("user-b");
    const [a, b, c] = await Promise.all([controller.answer(CALL), controller.answer(CALL), controller.answer(CALL)]);
    expect(deps.transition).toHaveBeenCalledTimes(1);
    expect([a.kind, b.kind, c.kind].sort()).toEqual(["answered", "busy", "busy"]);
    expect(deps.openCall).toHaveBeenCalledTimes(1);
  });
  it("answer and decline triggered together resolve to the single outcome that got there first", async () => {
    const { controller, deps } = setup();
    await controller.start("user-b");
    const [a, d] = await Promise.all([controller.answer(CALL), controller.decline(CALL)]);
    expect(a.kind).toBe("answered");
    expect(d.kind).toBe("busy");
    expect(deps.transition).toHaveBeenCalledTimes(1);
    expect(deps.transition).toHaveBeenCalledWith(CALL, "accept");
  });
  it("does not accept when the build cannot connect calls, and says so", async () => {
    const { controller, deps } = setup();
    await controller.start("user-b");
    deps.isCallingAvailable.mockReturnValue(false);
    const result = await controller.answer(CALL);
    expect(result.kind).toBe("unavailable");
    expect(deps.transition).not.toHaveBeenCalled();
    expect(deps.openCall).not.toHaveBeenCalled();
    expect(deps.tell).toHaveBeenCalled();
  });
  it("tells the user when the caller already cancelled or the call expired, without opening anything", async () => {
    const { controller, deps, setSnapshot } = setup();
    await controller.start("user-b");
    deps.transition.mockRejectedValueOnce(new Error("Invalid call transition"));
    setSnapshot(snapshot({ lastEventId: 9, incoming: [] }));
    const result = await controller.answer(CALL);
    expect(result.kind).toBe("gone");
    expect(deps.openCall).not.toHaveBeenCalled();
    expect(deps.tell).toHaveBeenCalledWith("Call ended", "This call is no longer available.");
    expect(controller.getView().ringing).toBeNull();
    expect(deps.dismissNotifications).toHaveBeenCalledWith(CALL);
  });
  it("treats a server answer of timed_out as gone", async () => {
    const { controller, deps, setSnapshot } = setup();
    await controller.start("user-b");
    deps.transition.mockResolvedValueOnce("timed_out");
    setSnapshot(snapshot({ lastEventId: 9, incoming: [] }));
    expect((await controller.answer(CALL)).kind).toBe("gone");
    expect(deps.openCall).not.toHaveBeenCalled();
  });
  it("keeps ringing and offers a retry when the network drops mid-answer", async () => {
    const { controller, deps } = setup();
    await controller.start("user-b");
    deps.transition.mockRejectedValueOnce(new Error("network"));
    deps.fetchSync.mockRejectedValueOnce(new Error("network"));
    const result = await controller.answer(CALL);
    expect(result.kind).toBe("network");
    expect(controller.getView().ringing?.callId).toBe(CALL);
    expect(deps.openCall).not.toHaveBeenCalled();
    const retry = await controller.answer(CALL);
    expect(retry.kind).toBe("answered");
  });
  it("joins the call if the answer reached the server but the reply was lost", async () => {
    const { controller, deps, setSnapshot } = setup();
    await controller.start("user-b");
    deps.transition.mockRejectedValueOnce(new Error("timeout"));
    setSnapshot(snapshot({ lastEventId: 9, incoming: [], active: [{ callId: CALL, matchId: MATCH, callType: "video" }] }));
    const result = await controller.answer(CALL);
    expect(result.kind).toBe("answered");
    expect(deps.openCall).toHaveBeenCalledTimes(1);
  });
  it("ignores an answer result that arrives after sign-out and opens nothing", async () => {
    const { controller, deps } = setup();
    await controller.start("user-b");
    let release!: (v: string) => void;
    deps.transition.mockImplementationOnce(() => new Promise<string>((r) => { release = r; }));
    const pending = controller.answer(CALL);
    controller.stop();
    release("accepted");
    expect((await pending).kind).toBe("gone");
    expect(deps.openCall).not.toHaveBeenCalled();
  });
});

describe("decline", () => {
  it("declines through the server, silences the ring and dismisses the notification", async () => {
    const { controller, deps } = setup();
    await controller.start("user-b");
    expect((await controller.decline(CALL)).kind).toBe("declined");
    expect(deps.transition).toHaveBeenCalledWith(CALL, "decline");
    expect(controller.getView().ringing).toBeNull();
    expect(deps.dismissNotifications).toHaveBeenCalledWith(CALL);
    expect(deps.openCall).not.toHaveBeenCalled();
  });
  it("repeated declines are safe (server replays are idempotent) and never open the call", async () => {
    const { controller, deps } = setup();
    await controller.start("user-b");
    expect((await controller.decline(CALL)).kind).toBe("declined");
    expect((await controller.decline(CALL)).kind).toBe("declined");
    expect(deps.openCall).not.toHaveBeenCalled();
    expect(deps.tell).not.toHaveBeenCalled();
  });
  it("concurrent decline taps send one request", async () => {
    const { controller, deps } = setup();
    await controller.start("user-b");
    const results = await Promise.all([controller.decline(CALL), controller.decline(CALL)]);
    expect(results.map((r) => r.kind).sort()).toEqual(["busy", "declined"]);
    expect(deps.transition).toHaveBeenCalledTimes(1);
  });
  it("declining a call that is already gone is quiet", async () => {
    const { controller, deps, setSnapshot } = setup();
    await controller.start("user-b");
    deps.transition.mockRejectedValueOnce(new Error("Invalid call transition"));
    setSnapshot(snapshot({ lastEventId: 9, incoming: [] }));
    expect((await controller.decline(CALL)).kind).toBe("gone");
    expect(deps.tell).not.toHaveBeenCalled();
    expect(controller.getView().ringing).toBeNull();
  });
  it("offline: silences this device and does not claim the caller was told", async () => {
    const { controller, deps } = setup();
    await controller.start("user-b");
    deps.transition.mockRejectedValueOnce(new Error("offline"));
    deps.fetchSync.mockRejectedValueOnce(new Error("offline"));
    expect((await controller.decline(CALL)).kind).toBe("offline");
    expect(controller.getView().ringing).toBeNull();
    expect(deps.stopRinging).toHaveBeenCalled();
  });
});

describe("accounts", () => {
  it("sign-out stops the ring, clears every call notification and drops all state", async () => {
    const { controller, deps } = setup();
    await controller.start("user-b");
    controller.stop();
    expect(controller.getView().ringing).toBeNull();
    expect(deps.stopRinging).toHaveBeenCalled();
    expect(deps.dismissNotifications).toHaveBeenCalledWith();
    // nothing can be answered or declined once signed out
    expect((await controller.answer(CALL)).kind).toBe("gone");
    expect((await controller.decline(CALL)).kind).toBe("gone");
    expect(deps.transition).not.toHaveBeenCalled();
    controller.handleEvent(event(50, "incoming"));
    expect(controller.getView().ringing).toBeNull();
  });
  it("switching accounts clears the previous account's call before loading the next", async () => {
    const { controller, deps, setSnapshot } = setup();
    await controller.start("user-a");
    expect(controller.getView().ringing?.callId).toBe(CALL);
    setSnapshot(snapshot({ incoming: [] }));
    await controller.start("user-b");
    expect(controller.getView().ringing).toBeNull();
    expect(deps.dismissNotifications).toHaveBeenCalledWith();
  });
  it("starting twice for the same account is a no-op", async () => {
    const { controller, deps } = setup();
    await controller.start("user-b");
    await controller.start("user-b");
    expect(deps.fetchSync).toHaveBeenCalledTimes(1);
  });
});

describe("notification action routing", () => {
  const data = { category: "call", callId: CALL, matchId: MATCH, callType: "video", notificationId: "n1" };

  it("Answer from a cold start joins the right call using the server's answer", async () => {
    const { controller, deps } = setup(snapshot());
    await controller.start("user-b");
    await controller.handleNotificationResponse({ actionIdentifier: CALL_ACTION_ANSWER, data });
    expect(deps.transition).toHaveBeenCalledWith(CALL, "accept");
    expect(deps.openCall).toHaveBeenCalledWith({ callId: CALL, matchId: MATCH, callType: "video" });
  });
  it("Answer with an incomplete payload recovers the match from the server's active list", async () => {
    const { controller, deps, setSnapshot } = setup(snapshot());
    await controller.start("user-b");
    setSnapshot(snapshot({ lastEventId: 5, active: [{ callId: CALL, matchId: MATCH, callType: "audio" }] }));
    await controller.handleNotificationResponse({
      actionIdentifier: CALL_ACTION_ANSWER,
      data: { category: "call", callId: CALL },
    });
    expect(deps.openCall).toHaveBeenCalledWith({ callId: CALL, matchId: MATCH, callType: "audio" });
  });
  it("Decline from the notification declines on the server without opening the app screen", async () => {
    const { controller, deps } = setup();
    await controller.start("user-b");
    await controller.handleNotificationResponse({ actionIdentifier: CALL_ACTION_DECLINE, data });
    expect(deps.transition).toHaveBeenCalledWith(CALL, "decline");
    expect(deps.openCall).not.toHaveBeenCalled();
  });
  it("tapping the notification body for an expired call says so and clears the notification", async () => {
    const { controller, deps } = setup(snapshot());
    await controller.start("user-b");
    await controller.handleNotificationResponse({ actionIdentifier: NOTIFICATION_DEFAULT_ACTION, data });
    expect(deps.tell).toHaveBeenCalledWith("Call ended", "This call is no longer available.");
    expect(deps.dismissNotifications).toHaveBeenCalledWith(CALL);
    expect(deps.transition).not.toHaveBeenCalled();
  });
  it("tapping the notification body for a live call leaves the in-app incoming screen to answer", async () => {
    const { controller, deps } = setup();
    await controller.start("user-b");
    await controller.handleNotificationResponse({ actionIdentifier: NOTIFICATION_DEFAULT_ACTION, data });
    expect(deps.tell).not.toHaveBeenCalled();
    expect(deps.transition).not.toHaveBeenCalled();
    expect(controller.getView().ringing?.callId).toBe(CALL);
  });
  it("ignores unknown actions, malformed data and non-call categories", async () => {
    const { controller, deps } = setup();
    await controller.start("user-b");
    await controller.handleNotificationResponse({ actionIdentifier: "forged", data });
    await controller.handleNotificationResponse({ actionIdentifier: CALL_ACTION_ANSWER, data: { category: "call", callId: "bad" } });
    await controller.handleNotificationResponse({ actionIdentifier: CALL_ACTION_ANSWER, data: { category: "message", callId: CALL } });
    expect(deps.transition).not.toHaveBeenCalled();
    expect(deps.openCall).not.toHaveBeenCalled();
  });
  it("does nothing for a response delivered while signed out or for another account's state", async () => {
    const { controller, deps } = setup();
    await controller.handleNotificationResponse({ actionIdentifier: CALL_ACTION_ANSWER, data });
    expect(deps.transition).not.toHaveBeenCalled();
    await controller.start("user-b");
    controller.stop();
    await controller.handleNotificationResponse({ actionIdentifier: CALL_ACTION_ANSWER, data });
    expect(deps.transition).not.toHaveBeenCalled();
  });
});
