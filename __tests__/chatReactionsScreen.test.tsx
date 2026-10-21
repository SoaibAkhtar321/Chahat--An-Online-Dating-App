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

const mockFetchReactions = jest.fn(async (..._a: unknown[]): Promise<any[]> => []);
const mockSetReaction = jest.fn(async (..._a: unknown[]): Promise<any> => ({ success: true }));
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
  fetchReactionsForMatch: (...a: unknown[]) => mockFetchReactions(...a),
  setMessageReaction: (...a: unknown[]) => mockSetReaction(...a),
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

const node = (pred: (n: TestRenderer.ReactTestInstance) => boolean) => {
  const found = renderer.root.findAll(pred);
  return found.length ? found[0]! : null;
};
const chip = (id: string, emoji: string) =>
  node((n) => n.props?.testID === `message-reaction-chip-${id}-${emoji}` && typeof n.props.onPress === "function");
const bubble = (id: string) =>
  node((n) => n.props?.testID === `message-bubble-${id}` && typeof n.props.onLongPress === "function");
const byTestId = (id: string) => node((n) => n.props?.testID === id && typeof n.props.onPress === "function");
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

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchReactions.mockImplementation(async () => []);
  mockSetReaction.mockImplementation(async () => ({ success: true }));
  mockHandlers = undefined;
  mockOnReceived = undefined;
});

afterEach(async () => {
  await act(async () => {
    renderer?.unmount();
  });
});

describe("chat screen emoji reactions", () => {
  it("shows reactions loaded with the thread", async () => {
    mockFetchReactions.mockImplementation(async () => [{ messageId: THEIRS_ID, userId: THEM, emoji: "😂" }]);
    await mount();
    expect(chip(THEIRS_ID, "😂")).not.toBeNull();
    expect(chip(MINE_ID, "😂")).toBeNull();
  });

  it("long-press, pick an emoji: sends it, closes the sheet and shows my chip right away", async () => {
    await mount();
    await longPress(THEIRS_ID);
    expect(byTestId("message-react-👍")).not.toBeNull();
    await press(byTestId("message-react-👍"), "react");
    expect(mockSetReaction).toHaveBeenCalledWith(THEIRS_ID, "👍");
    expect(byTestId("message-react-👍")).toBeNull();
    expect(chip(THEIRS_ID, "👍")).not.toBeNull();
  });

  it("works on my own messages too", async () => {
    await mount();
    await longPress(MINE_ID);
    await press(byTestId("message-react-❤️"), "react");
    expect(mockSetReaction).toHaveBeenCalledWith(MINE_ID, "❤️");
  });

  it("rolls the chip back and tells the user when the server refuses", async () => {
    mockSetReaction.mockImplementation(async () => ({ success: false, error: "network" }));
    await mount();
    await longPress(THEIRS_ID);
    await press(byTestId("message-react-👍"), "react");
    await flush();
    expect(chip(THEIRS_ID, "👍")).toBeNull();
    expect(mockAlert).toHaveBeenCalledWith("Reaction not sent", expect.stringContaining("connection"));
  });

  it("picking my current reaction again removes it", async () => {
    mockFetchReactions.mockImplementation(async () => [{ messageId: THEIRS_ID, userId: ME, emoji: "👍" }]);
    await mount();
    await longPress(THEIRS_ID);
    await press(byTestId("message-react-👍"), "toggle");
    expect(mockSetReaction).toHaveBeenCalledWith(THEIRS_ID, null);
    expect(chip(THEIRS_ID, "👍")).toBeNull();
  });

  it("tapping my own chip removes it; tapping someone else's emoji adds mine", async () => {
    mockFetchReactions.mockImplementation(async () => [
      { messageId: THEIRS_ID, userId: ME, emoji: "👍" },
      { messageId: MINE_ID, userId: THEM, emoji: "🙏" },
    ]);
    await mount();
    await press(chip(THEIRS_ID, "👍"), "own chip");
    expect(mockSetReaction).toHaveBeenLastCalledWith(THEIRS_ID, null);
    await press(chip(MINE_ID, "🙏"), "their chip");
    expect(mockSetReaction).toHaveBeenLastCalledWith(MINE_ID, "🙏");
  });

  it("the partner's reaction appears and disappears live", async () => {
    await mount();
    await act(async () => mockHandlers.onReaction({ messageId: MINE_ID, userId: THEM, emoji: "❤️" }));
    expect(chip(MINE_ID, "❤️")).not.toBeNull();
    await act(async () => mockHandlers.onReaction({ messageId: MINE_ID, userId: THEM, emoji: null }));
    expect(chip(MINE_ID, "❤️")).toBeNull();
  });

  it("a message deleted for everyone loses its reactions and cannot be reacted to", async () => {
    mockFetchReactions.mockImplementation(async () => [{ messageId: THEIRS_ID, userId: ME, emoji: "👍" }]);
    await mount();
    await act(async () => mockHandlers.onMessageDeleted({ id: THEIRS_ID, deletedAt: "2026-10-21T10:00:00Z" }));
    expect(chip(THEIRS_ID, "👍")).toBeNull();
    await longPress(THEIRS_ID);
    expect(byTestId("message-react-👍")).toBeNull();
    expect(byTestId("message-action-delete-for-me")).not.toBeNull();
  });

  it("reloads reactions when the live connection resyncs", async () => {
    await mount();
    mockFetchReactions.mockImplementation(async () => [{ messageId: MINE_ID, userId: THEM, emoji: "😮" }]);
    await act(async () => mockHandlers.onResync());
    await flush();
    expect(chip(MINE_ID, "😮")).not.toBeNull();
  });
});
