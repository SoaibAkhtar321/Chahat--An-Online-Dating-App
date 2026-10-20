import React from "react";
import { Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

// The first test loads and transforms the whole chat screen. On a cold Jest cache (always the case on CI)
// that alone can exceed the 5 s default, so this suite gets explicit headroom.
jest.setTimeout(30000);

const ME = "aaaaaaaa-0000-4000-8000-000000000001";
const THEM = "bbbbbbbb-0000-4000-8000-000000000002";
const MATCH = "f6c60000-0000-4000-8000-000000000001";
const MINE_ID = "11111111-1111-4111-8111-111111111111";
const THEIRS_ID = "22222222-2222-4222-8222-222222222222";

// Stable references, like the real providers: the screen's effects depend on `user`.
const mockUser = { id: ME };
const mockMatches = [
  {
    id: MATCH,
    otherUser: { id: THEM, name: "Ananya", age: 25, city: "", distanceKm: null, bio: "", photos: [], interests: [], intent: "" },
    createdAt: "2026-10-01T00:00:00Z",
    unreadCount: 0,
  },
];
const mockMiloValue = { matches: mockMatches, refreshMatches: (...a: unknown[]) => mockRefresh(...a) };

const mockFetch = jest.fn();
const mockDelete = jest.fn();
const mockRefresh = jest.fn();
const mockAlert = jest.fn();
const mockMarkRead = jest.fn();
let mockHandlers: any;
let mockOnReceived: ((m: any) => void) | undefined;

jest.mock(
  "@react-native-async-storage/async-storage",
  () => ({
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  }),
  { virtual: true },
);
jest.mock("react-native-safe-area-context", () => {
  const { View } = require("react-native");
  return { SafeAreaView: View };
});
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "f6c60000-0000-4000-8000-000000000001" }),
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
  useFocusEffect: () => undefined,
}));
jest.mock("expo-image", () => {
  const { View } = require("react-native");
  return { Image: View };
});
jest.mock("expo-image-picker", () => ({ MediaTypeOptions: { Images: "Images" } }));
jest.mock("lucide-react-native", () => new Proxy({ __esModule: true }, { get: (t: any, k: string) => (k in t ? t[k] : () => null) }));
jest.mock("../mobile/src/components/profile/ProfilePhoto", () => ({ ProfilePhoto: () => null }));
jest.mock("../mobile/src/components/chat/CoupleGamesModal", () => ({ CoupleGamesModal: () => null }));
jest.mock("../mobile/src/context/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock("../mobile/src/context/MiloContext", () => ({ useMilo: () => mockMiloValue }));
jest.mock("../mobile/src/services/activeConversation", () => ({ setActiveConversation: jest.fn(), clearActiveConversation: jest.fn() }));
jest.mock("../mobile/src/services/calls", () => ({ buildNewCallRoute: jest.fn() }));
jest.mock("../mobile/src/services/callMedia", () => ({ isCallingAvailable: () => false }));
jest.mock("../mobile/src/services/moderation", () => ({ blockUser: jest.fn(), reportUser: jest.fn(), unmatchUser: jest.fn() }));
jest.mock("../mobile/src/services/voiceMedia", () => ({
  VOICE_LIMITS: { maxDurationMs: 60000 },
  getAudioRecorderAdapter: jest.fn(),
  getAudioPlayerAdapter: () => ({ stopAsync: jest.fn(async () => undefined), pauseAsync: jest.fn(async () => undefined), playAsync: jest.fn() }),
}));
jest.mock("../mobile/src/services/supabase", () => ({
  supabase: { removeChannel: jest.fn(), rpc: jest.fn() },
  isSupabaseConfigured: () => true,
}));
jest.mock("../mobile/src/services/chat", () => ({
  fetchMessagesForMatch: (...a: unknown[]) => mockFetch(...a),
  sendChatMessage: jest.fn(),
  sendVoiceMessage: jest.fn(),
  markChatRead: (...a: unknown[]) => mockMarkRead(...a),
  subscribeToMatchMessages: (_m: string, onReceived: (m: any) => void, _u: string, handlers: any) => {
    mockOnReceived = onReceived;
    mockHandlers = handlers;
    return { id: "channel" };
  },
}));
jest.mock("../mobile/src/services/messageDeletion", () => ({
  ...jest.requireActual("../mobile/src/services/messageDeletion"),
  deleteMessage: (...a: unknown[]) => mockDelete(...a),
}));
jest.mock("../mobile/src/utils/alert", () => ({ Alert: { alert: (...a: unknown[]) => mockAlert(...a) } }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ChatDetailScreen = require("../mobile/app/chat/[id]").default;

const base = { matchId: MATCH, messageType: "text", isViewOnce: false, viewedAt: null, deletedAt: null, status: "sent" };
const MINE = { ...base, id: MINE_ID, sender: ME, from: "me", text: "my secret text", at: 1000 };
const THEIRS = { ...base, id: THEIRS_ID, sender: THEM, from: "them", text: "their text", at: 2000 };

let renderer: TestRenderer.ReactTestRenderer;

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

async function mount(initial: any[] = [MINE, THEIRS]) {
  mockFetch.mockResolvedValue(initial);
  await act(async () => {
    renderer = TestRenderer.create(<ChatDetailScreen />);
  });
  await flush();
}

const texts = () => renderer.root.findAllByType(Text).map((n) => React.Children.toArray(n.props.children).join(""));
const has = (s: string) => texts().some((t) => t.includes(s));
const count = (s: string) => texts().filter((t) => t.includes(s)).length;

const node = (pred: (n: TestRenderer.ReactTestInstance) => boolean) => {
  const found = renderer.root.findAll(pred);
  return found.length ? found[0]! : null;
};
const bubble = (id: string) =>
  node((n) => n.props?.testID === `message-bubble-${id}` && typeof n.props.onLongPress === "function");
const byTestId = (id: string) => node((n) => n.props?.testID === id && typeof n.props.onPress === "function");
const button = (title: string) => node((n) => n.props?.title === title && typeof n.props.onPress === "function");

const longPress = async (id: string) => {
  const b = bubble(id);
  if (!b) throw new Error(`no bubble for ${id}`);
  await act(async () => {
    b.props.onLongPress();
  });
};
const press = async (n: TestRenderer.ReactTestInstance | null, label: string) => {
  if (!n) throw new Error(`nothing to press: ${label}`);
  await act(async () => {
    n.props.onPress();
  });
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const OK_ME = { ok: true, status: "deleted_for_me", messageId: THEIRS_ID, attempts: 1 };
const OK_EVERYONE = { ok: true, status: "deleted", messageId: MINE_ID, deletedAt: "2026-10-20T01:00:00Z", attempts: 1 };

beforeEach(() => {
  jest.clearAllMocks();
  mockHandlers = undefined;
  mockOnReceived = undefined;
});

afterEach(async () => {
  await act(async () => {
    renderer?.unmount();
  });
});

describe("Phase 3B: chat screen message deletion", () => {
  it("offers Delete for me on the other person's message but not Delete for everyone", async () => {
    await mount();
    await longPress(THEIRS_ID);
    expect(byTestId("message-action-delete-for-me")).not.toBeNull();
    expect(byTestId("message-action-delete-for-everyone")).toBeNull();
  });

  it("offers both actions on the current user's own message", async () => {
    await mount();
    await longPress(MINE_ID);
    expect(byTestId("message-action-delete-for-me")).not.toBeNull();
    expect(byTestId("message-action-delete-for-everyone")).not.toBeNull();
  });

  it("Delete for me removes the message immediately and it stays removed once the server confirms", async () => {
    const d = deferred<any>();
    mockDelete.mockReturnValue(d.promise);
    await mount();
    expect(has("their text")).toBe(true);

    await longPress(THEIRS_ID);
    await press(byTestId("message-action-delete-for-me"), "delete for me");

    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledWith("me", THEIRS_ID);
    expect(has("their text")).toBe(false); // gone before the server answered
    expect(has("my secret text")).toBe(true);

    await act(async () => d.resolve(OK_ME));
    expect(has("their text")).toBe(false);
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("a failed Delete for me puts the message back in place and Try again retries it", async () => {
    mockDelete.mockResolvedValueOnce({
      ok: false,
      reason: "network",
      retryable: true,
      message: "Couldn't reach the server. Check your connection and try again.",
      attempts: 3,
    });
    await mount();

    await longPress(THEIRS_ID);
    await press(byTestId("message-action-delete-for-me"), "delete for me");
    await flush();

    expect(count("their text")).toBe(1); // restored, not duplicated
    const all = texts();
    expect(all.findIndex((t) => t.includes("my secret text"))).toBeLessThan(all.findIndex((t) => t.includes("their text")));
    expect(mockAlert).toHaveBeenCalledTimes(1);
    const [title, , buttons] = mockAlert.mock.calls[0]!;
    expect(title).toBe("Couldn't delete message");
    const retry = (buttons as any[]).find((b) => b.text === "Try again");
    expect(retry).toBeTruthy();

    mockDelete.mockResolvedValueOnce(OK_ME);
    await act(async () => retry.onPress());
    await flush();

    expect(mockDelete).toHaveBeenCalledTimes(2);
    expect(has("their text")).toBe(false);
  });

  it("a permanent failure restores the message and offers no retry", async () => {
    mockDelete.mockResolvedValueOnce({
      ok: false,
      reason: "unavailable",
      retryable: false,
      message: "Message deletion isn't available yet. Please try again later.",
      attempts: 1,
    });
    await mount();
    await longPress(THEIRS_ID);
    await press(byTestId("message-action-delete-for-me"), "delete for me");
    await flush();

    expect(has("their text")).toBe(true);
    expect(mockAlert).toHaveBeenCalledTimes(1);
    expect(mockAlert.mock.calls[0]!.length).toBe(2); // title + message, no buttons
  });

  it("Delete for everyone asks for confirmation before anything is sent", async () => {
    const d = deferred<any>();
    mockDelete.mockReturnValue(d.promise);
    await mount();

    await longPress(MINE_ID);
    await press(byTestId("message-action-delete-for-everyone"), "delete for everyone");

    expect(mockDelete).not.toHaveBeenCalled();
    expect(has("Delete for everyone?")).toBe(true);
    expect(has("my secret text")).toBe(true);

    await press(button("Delete for everyone"), "confirm");

    expect(mockDelete).toHaveBeenCalledWith("everyone", MINE_ID);
    expect(has("my secret text")).toBe(false); // tombstone immediately
    expect(has("You deleted this message")).toBe(true);

    await act(async () => d.resolve(OK_EVERYONE));
    expect(has("You deleted this message")).toBe(true);
    expect(count("my secret text")).toBe(0);
  });

  it("cancelling the confirmation deletes nothing", async () => {
    await mount();
    await longPress(MINE_ID);
    await press(byTestId("message-action-delete-for-everyone"), "delete for everyone");
    await press(button("Cancel"), "cancel");

    expect(mockDelete).not.toHaveBeenCalled();
    expect(has("my secret text")).toBe(true);
    expect(has("Delete for everyone?")).toBe(false);
  });

  it("a failed Delete for everyone restores the original message", async () => {
    mockDelete.mockResolvedValueOnce({
      ok: false,
      reason: "forbidden",
      retryable: false,
      message: "You can only delete your own messages for everyone.",
      attempts: 1,
    });
    await mount();
    await longPress(MINE_ID);
    await press(byTestId("message-action-delete-for-everyone"), "delete for everyone");
    await press(button("Delete for everyone"), "confirm");
    await flush();

    expect(has("my secret text")).toBe(true);
    expect(has("You deleted this message")).toBe(false);
    expect(mockAlert).toHaveBeenCalledWith("Couldn't delete for everyone", "You can only delete your own messages for everyone.");
  });

  it("ignores a second delete of the same message while the first is still in flight", async () => {
    const d = deferred<any>();
    mockDelete.mockReturnValue(d.promise);
    await mount();
    await longPress(MINE_ID);
    await press(byTestId("message-action-delete-for-everyone"), "delete for everyone");
    await press(button("Delete for everyone"), "confirm");

    await longPress(MINE_ID); // the tombstone can still be hidden for me
    await press(byTestId("message-action-delete-for-me"), "delete for me");

    expect(mockDelete).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve(OK_EVERYONE));
  });

  it("a Realtime UPDATE turns the other person's deleted message into a tombstone", async () => {
    await mount();
    expect(has("their text")).toBe(true);

    await act(async () => mockHandlers.onMessageDeleted({ id: THEIRS_ID, deletedAt: "2026-10-20T01:00:00Z" }));

    expect(has("their text")).toBe(false);
    expect(has("This message was deleted")).toBe(true);
    expect(has("my secret text")).toBe(true);
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("a Realtime deletion that arrives while the sheet is open for that message closes the sheet", async () => {
    await mount();
    await longPress(THEIRS_ID);
    expect(byTestId("message-action-delete-for-me")).not.toBeNull();

    await act(async () => mockHandlers.onMessageDeleted({ id: THEIRS_ID, deletedAt: "2026-10-20T01:00:00Z" }));

    expect(byTestId("message-action-delete-for-me")).toBeNull();
  });

  it("a message deleted for me is not restored by a refresh, a reconnect or a Realtime INSERT", async () => {
    mockDelete.mockResolvedValue(OK_ME);
    await mount();
    await longPress(THEIRS_ID);
    await press(byTestId("message-action-delete-for-me"), "delete for me");
    await flush();
    expect(has("their text")).toBe(false);

    // A stale answer from the server still contains it (for example a fetch that started before the delete).
    mockFetch.mockResolvedValue([MINE, THEIRS]);
    await act(async () => mockHandlers.onResync());
    await flush();
    expect(has("their text")).toBe(false);

    // And so does a late Realtime INSERT for the same id.
    await act(async () => mockOnReceived!(THEIRS));
    expect(has("their text")).toBe(false);
  });

  it("a message deleted for everyone is not shown with its old content by a stale refresh", async () => {
    mockDelete.mockResolvedValue(OK_EVERYONE);
    await mount();
    await longPress(MINE_ID);
    await press(byTestId("message-action-delete-for-everyone"), "delete for everyone");
    await press(button("Delete for everyone"), "confirm");
    await flush();

    mockFetch.mockResolvedValue([MINE, THEIRS]); // stale copy with the original content
    await act(async () => mockHandlers.onResync());
    await flush();

    expect(has("my secret text")).toBe(false);
    expect(has("You deleted this message")).toBe(true);
    expect(has("their text")).toBe(true);
  });

  it("does not duplicate a message that Realtime delivers twice or that is already on screen", async () => {
    await mount();
    await act(async () => mockOnReceived!(THEIRS));
    await act(async () => mockOnReceived!({ ...THEIRS }));
    expect(count("their text")).toBe(1);
  });

  it("a reconnect that returns nothing does not blank the conversation", async () => {
    await mount();
    mockFetch.mockResolvedValue([]); // fetchMessagesForMatch also returns [] on network errors
    await act(async () => mockHandlers.onResync());
    await flush();
    expect(has("their text")).toBe(true);
    expect(has("my secret text")).toBe(true);
  });

  it("renders a tombstone from the initial fetch with no content", async () => {
    await mount([MINE, { ...THEIRS, text: "", deletedAt: "2026-10-20T01:00:00Z" }]);
    expect(has("This message was deleted")).toBe(true);
    expect(has("their text")).toBe(false);
  });
});
