const mockSetChannel = jest.fn(async () => undefined);
const mockSetCategory = jest.fn(async () => undefined);
const mockPresented = jest.fn();
const mockDismiss = jest.fn(async () => undefined);
const mockVibrate = jest.fn();
const mockCancel = jest.fn();
let mockOs = "android";

jest.mock("react-native", () => ({
  Platform: { get OS() { return mockOs; } },
  Vibration: { vibrate: (...a: unknown[]) => mockVibrate(...a), cancel: () => mockCancel() },
}));
jest.mock("expo-notifications", () => ({
  AndroidImportance: { MAX: 5 },
  AndroidNotificationVisibility: { PRIVATE: 0 },
  AndroidAudioUsage: { NOTIFICATION_RINGTONE: 6 },
  AndroidAudioContentType: { SONIFICATION: 4 },
  setNotificationChannelAsync: (...a: unknown[]) => mockSetChannel(...a),
  deleteNotificationChannelAsync: async () => undefined,
  setNotificationCategoryAsync: (...a: unknown[]) => mockSetCategory(...a),
  getPresentedNotificationsAsync: () => mockPresented(),
  dismissNotificationAsync: (...a: unknown[]) => mockDismiss(...a),
}));

import {
  dismissCallNotifications,
  ensureCallNotificationSetup,
  startInAppRing,
  stopInAppRing,
} from "../mobile/src/services/callNotifications";

const CALL = "11111111-1111-4111-8111-111111111111";
const OTHER = "33333333-3333-4333-8333-333333333333";
const shown = (identifier: string, data: Record<string, unknown>) => ({ request: { identifier, content: { data } } });

beforeEach(() => {
  jest.clearAllMocks();
  mockOs = "android";
});

describe("call channel and actions", () => {
  it("registers a max-importance ringing channel that hides content on the lock screen", async () => {
    await ensureCallNotificationSetup();
    expect(mockSetChannel).toHaveBeenCalledWith(
      "calls_ring",
      expect.objectContaining({
        importance: 5,
        // Bundled ~30 s ringtone, played as a ringtone (not the short default notification beep).
        sound: "chahat_ringtone.wav",
        audioAttributes: expect.objectContaining({ usage: 6 }),
        enableVibrate: true,
        lockscreenVisibility: 0,
        bypassDnd: false,
      }),
    );
  });
  it("registers Answer (opens the app) and Decline (does not) on the incoming_call category", async () => {
    await ensureCallNotificationSetup();
    expect(mockSetCategory).toHaveBeenCalledWith("incoming_call", [
      expect.objectContaining({ identifier: "answer", buttonTitle: "Answer", options: { opensAppToForeground: true } }),
      expect.objectContaining({ identifier: "decline", buttonTitle: "Decline", options: { opensAppToForeground: false, isDestructive: true } }),
    ]);
  });
  it("does nothing off Android", async () => {
    mockOs = "ios";
    await ensureCallNotificationSetup();
    await dismissCallNotifications();
    startInAppRing();
    expect(mockSetChannel).not.toHaveBeenCalled();
    expect(mockPresented).not.toHaveBeenCalled();
    expect(mockVibrate).not.toHaveBeenCalled();
  });
});

describe("clearing notifications", () => {
  beforeEach(() => {
    mockPresented.mockResolvedValue([
      shown("a", { category: "call", callId: CALL }),
      shown("b", { category: "call", callId: OTHER }),
      shown("c", { category: "message", matchId: CALL }),
      shown("d", { category: "call", callId: "not-a-uuid" }),
    ]);
  });
  it("dismisses only the notifications of the finished call", async () => {
    await dismissCallNotifications(CALL);
    expect(mockDismiss.mock.calls.map((c) => c[0])).toEqual(["a"]);
  });
  it("on sign-out dismisses every call notification but never chat or like ones", async () => {
    await dismissCallNotifications();
    expect(mockDismiss.mock.calls.map((c) => c[0]).sort()).toEqual(["a", "b"]);
  });
});

describe("in-app ring", () => {
  it("vibrates in a repeating pattern and cancels", () => {
    startInAppRing();
    expect(mockVibrate).toHaveBeenCalledWith([0, 800, 600], true);
    stopInAppRing();
    expect(mockCancel).toHaveBeenCalled();
  });
});
