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
  fetchReactionsForMatch: jest.fn(async () => []),
  setMessageReaction: jest.fn(async () => ({ success: true })),
  subscribeToMatchMessages: (_m: string, onReceived: (m: any) => void, _u: string, handlers: any) => {
    mockOnReceived = onReceived;
    mockHandlers = handlers;
    return { id: "channel" };
  },
}));
const mockPresence = { notifyInput: jest.fn(), notifyStopped: jest.fn(), leave: jest.fn() };
let mockPresenceHandlers: any;
const mockJoin = jest.fn((_m: string, _u: string, handlers: any) => {
  mockPresenceHandlers = handlers;
  return mockPresence;
});
jest.mock("../mobile/src/services/chatPresence", () => ({
  joinChatPresence: (...a: unknown[]) => (mockJoin as any)(...a),
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
const label = () => renderer.root.findAll((n) => n.props?.testID === "chat-presence-label" && typeof n.props.children !== "undefined");
const labelText = () => (label().length ? React.Children.toArray(label()[0]!.props.children).join("") : "");
const input = () => renderer.root.find((n) => typeof n.props?.onChangeText === "function" && n.props?.placeholder !== undefined);

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(async () => {
  await act(async () => {
    try {
      renderer.unmount();
    } catch {
      // already unmounted by the test
    }
  });
});

describe("chat screen presence wiring", () => {
  it("joins the presence channel for this match as this user and leaves on unmount", async () => {
    await mount();
    expect(mockJoin).toHaveBeenCalledWith(MATCH, ME, expect.any(Object));
    await act(async () => {
      renderer.unmount();
    });
    expect(mockPresence.leave).toHaveBeenCalled();
  });

  it("shows nothing until the partner is online, then online, then typing", async () => {
    await mount();
    expect(labelText()).toBe("");
    expect(texts().some((t) => t.includes("Active recently"))).toBe(false);
    await act(async () => mockPresenceHandlers.onPartnerOnline(true));
    expect(labelText()).toBe("online");
    await act(async () => mockPresenceHandlers.onPartnerTyping(true));
    expect(labelText()).toBe("typing…");
    await act(async () => mockPresenceHandlers.onPartnerTyping(false));
    expect(labelText()).toBe("online");
    await act(async () => mockPresenceHandlers.onPartnerOnline(false));
    expect(labelText()).toBe("");
  });

  it("tells the partner when I type and when the box is emptied", async () => {
    await mount();
    await act(async () => input().props.onChangeText("hel"));
    expect(mockPresence.notifyInput).toHaveBeenLastCalledWith(true);
    await act(async () => input().props.onChangeText("   "));
    expect(mockPresence.notifyInput).toHaveBeenLastCalledWith(false);
  });
});
