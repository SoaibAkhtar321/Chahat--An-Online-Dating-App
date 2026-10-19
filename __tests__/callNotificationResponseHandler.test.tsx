import React from "react";
import TestRenderer, { act } from "react-test-renderer";

const mockListeners: Array<(response: unknown) => void> = [];
const mockRemove = jest.fn();
const mockGetLast = jest.fn();
const mockClearLast = jest.fn(async () => undefined);
const mockStart = jest.fn(async () => undefined);
const mockHandleCall = jest.fn(async () => undefined);
const mockPush = jest.fn();
let mockUser: { id: string } | null = { id: "user-b" };
let mockController: { start: jest.Mock; handleNotificationResponse: jest.Mock } | null;

jest.mock("expo-notifications", () => ({
  addNotificationResponseReceivedListener: (fn: (r: unknown) => void) => {
    mockListeners.push(fn);
    return { remove: mockRemove };
  },
  getLastNotificationResponseAsync: (...a: unknown[]) => mockGetLast(...a),
  clearLastNotificationResponseAsync: (...a: unknown[]) => mockClearLast(...a),
}));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
  useRootNavigationState: () => ({ key: "root" }),
}));
jest.mock("../mobile/src/context/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock("../mobile/src/context/IncomingCallContext", () => ({ useIncomingCallController: () => mockController }));
jest.mock("../mobile/src/services/supabase", () => ({ supabase: { from: jest.fn() } }));
jest.mock("../mobile/src/services/likes", () => ({ checkLikesAccessRaw: jest.fn() }));
jest.mock("../mobile/src/utils/alert", () => ({ Alert: { alert: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { NotificationResponseHandler } = require("../mobile/src/components/notifications/NotificationResponseHandler");

const CALL = "11111111-1111-4111-8111-111111111111";
const MATCH = "22222222-2222-4222-8222-222222222222";
const response = (actionIdentifier: string, id = "notif-1", data: Record<string, unknown> = { category: "call", callId: CALL, matchId: MATCH, callType: "video" }) => ({
  actionIdentifier,
  notification: { request: { identifier: id, content: { data } } },
});
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

async function mount() {
  await act(async () => {
    TestRenderer.create(<NotificationResponseHandler />);
  });
  await flush();
}

beforeEach(() => {
  mockListeners.length = 0;
  jest.clearAllMocks();
  mockUser = { id: "user-b" };
  mockGetLast.mockResolvedValue(null);
  mockController = { start: mockStart, handleNotificationResponse: mockHandleCall };
});

describe("incoming-call notification responses", () => {
  it("cold start: Answer tapped while the app was dead reaches the controller after it is started for this account", async () => {
    mockGetLast.mockResolvedValue(response("answer"));
    await mount();
    expect(mockStart).toHaveBeenCalledWith("user-b");
    expect(mockHandleCall).toHaveBeenCalledWith({
      actionIdentifier: "answer",
      data: { category: "call", callId: CALL, matchId: MATCH, callType: "video" },
    });
    expect(mockStart.mock.invocationCallOrder[0]).toBeLessThan(mockHandleCall.mock.invocationCallOrder[0]!);
    expect(mockClearLast).toHaveBeenCalled(); // the launch response is consumed once
  });
  it("background: Decline and Answer taps are routed with their action identifiers", async () => {
    await mount();
    expect(mockListeners).toHaveLength(1);
    await act(async () => { mockListeners[0]!(response("decline", "notif-2")); });
    await flush();
    await act(async () => { mockListeners[0]!(response("answer", "notif-3")); });
    await flush();
    expect(mockHandleCall.mock.calls.map((c: any[]) => c[0].actionIdentifier)).toEqual(["decline", "answer"]);
  });
  it("the same notification response is never handled twice", async () => {
    await mount();
    await act(async () => {
      mockListeners[0]!(response("answer", "same"));
      mockListeners[0]!(response("answer", "same"));
    });
    await flush();
    expect(mockHandleCall).toHaveBeenCalledTimes(1);
  });
  it("does nothing for a call response while nobody is signed in", async () => {
    mockUser = null;
    mockGetLast.mockResolvedValue(response("answer"));
    await mount();
    expect(mockListeners).toHaveLength(0);
    expect(mockHandleCall).not.toHaveBeenCalled();
  });
  it("does not open a chat or the likes screen for a call push", async () => {
    await mount();
    await act(async () => { mockListeners[0]!(response("answer", "n9")); });
    await flush();
    expect(mockPush).not.toHaveBeenCalled();
  });
  it("is a no-op, not a crash, when the call controller is unavailable", async () => {
    mockController = null;
    await mount();
    await act(async () => { mockListeners[0]!(response("answer", "n10")); });
    await flush();
    expect(mockHandleCall).not.toHaveBeenCalled();
  });
});
