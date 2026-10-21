import React from "react";
import { FlatList, Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

// The first test loads and transforms the whole chat screen; give a cold Jest cache explicit headroom.
jest.setTimeout(30000);

const ME = "aaaaaaaa-0000-4000-8000-000000000001";
const THEM = "bbbbbbbb-0000-4000-8000-000000000002";
const MATCH = "f6c60000-0000-4000-8000-000000000001";
const MINE_ID = "11111111-1111-4111-8111-111111111111";
const THEIRS_ID = "22222222-2222-4222-8222-222222222222";
const REPLY_ID = "33333333-3333-4333-8333-333333333333";
const LIVE_ID = "44444444-4444-4444-8444-444444444444";
const OLD_ID = "55555555-5555-4555-8555-555555555555";

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
const mockSend = jest.fn();
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
  sendChatMessage: (...a: unknown[]) => mockSend(...a),
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
const MINE = { ...base, id: MINE_ID, sender: ME, from: "me", text: "my own text", at: 1000 };
const THEIRS = { ...base, id: THEIRS_ID, sender: THEM, from: "them", text: "what are you doing tonight?", at: 2000 };
// An existing reply of mine to THEIRS, as the server returns it.
const REPLY = {
  ...base,
  id: REPLY_ID,
  sender: ME,
  from: "me",
  text: "nothing much",
  at: 3000,
  replyToId: THEIRS_ID,
  replyTo: { id: THEIRS_ID, from: "them", text: "what are you doing tonight?", kind: "text", unavailable: false },
};

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
const any = (id: string) => renderer.root.findAll((n) => n.props?.testID === id).length > 0;
const byTestId = (id: string) => node((n) => n.props?.testID === id && typeof n.props.onPress === "function");
const bubble = (id: string) => node((n) => n.props?.testID === `message-bubble-${id}` && typeof n.props.onLongPress === "function");
const quoteOf = (id: string) => node((n) => n.props?.testID === `message-reply-quote-${id}` && typeof n.props.onPress === "function");
const anyQuote = (id: string) => any(`message-reply-quote-${id}`);
const flat = (c: any): string => (Array.isArray(c) ? c.map(flat).join("") : typeof c === "string" || typeof c === "number" ? String(c) : "");
const allText = () => renderer.root.findAllByType(Text).map((t) => flat(t.props.children)).join(" | ");
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
const typeText = async (value: string) => {
  const input = node((n) => typeof n.props?.placeholder === "string" && n.props.placeholder.startsWith("Type a message") && typeof n.props.onChangeText === "function");
  if (!input) throw new Error("no text input");
  await act(async () => {
    input.props.onChangeText(value);
  });
};
const inputValue = () =>
  node((n) => typeof n.props?.placeholder === "string" && n.props.placeholder.startsWith("Type a message") && "value" in n.props)?.props.value;

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchReactions.mockImplementation(async () => []);
  mockSetReaction.mockImplementation(async () => ({ success: true }));
  mockSend.mockImplementation(async (_m: string, _u: string, text: string, _i: unknown, _v: unknown, replyToId?: string) => ({
    success: true,
    message: { ...base, id: LIVE_ID, sender: ME, from: "me", text, at: 9000, ...(replyToId ? { replyToId } : {}) },
  }));
  mockDelete.mockResolvedValue({ ok: true, deletedAt: "2026-10-22T10:00:00Z" });
  mockHandlers = undefined;
  mockOnReceived = undefined;
});

afterEach(async () => {
  await act(async () => {
    renderer?.unmount();
  });
});

describe("chat screen replies", () => {
  it("long-press, Reply: shows who and what is being replied to above the input", async () => {
    await mount();
    await longPress(THEIRS_ID);
    expect(byTestId("message-action-reply")).not.toBeNull();
    await press(byTestId("message-action-reply"), "reply");
    expect(any("message-action-sheet")).toBe(false);
    expect(any("reply-draft-bar")).toBe(true);
    expect(allText()).toContain("Replying to Ananya");
    expect(allText()).toContain("what are you doing tonight?");
  });

  it("replying to my own message says You", async () => {
    await mount();
    await longPress(MINE_ID);
    await press(byTestId("message-action-reply"), "reply");
    expect(allText()).toContain("Replying to You");
  });

  it("the X on the bar cancels the reply", async () => {
    await mount();
    await longPress(THEIRS_ID);
    await press(byTestId("message-action-reply"), "reply");
    await press(byTestId("reply-draft-cancel"), "cancel");
    expect(any("reply-draft-bar")).toBe(false);
  });

  it("sending sends the reply link, clears the bar, and shows the quote on the new message right away", async () => {
    await mount();
    await longPress(THEIRS_ID);
    await press(byTestId("message-action-reply"), "reply");
    await typeText("nothing much");
    await press(byTestId("chat-send"), "send");
    await flush();
    expect(mockSend).toHaveBeenCalledWith(MATCH, ME, "nothing much", undefined, false, THEIRS_ID);
    expect(any("reply-draft-bar")).toBe(false);
    expect(anyQuote(LIVE_ID)).toBe(true);
    expect(allText()).toContain("what are you doing tonight?");
  });

  it("a normal send after a cancelled reply carries no reply link", async () => {
    await mount();
    await longPress(THEIRS_ID);
    await press(byTestId("message-action-reply"), "reply");
    await press(byTestId("reply-draft-cancel"), "cancel");
    await typeText("hello");
    await press(byTestId("chat-send"), "send");
    await flush();
    expect(mockSend).toHaveBeenCalledWith(MATCH, ME, "hello", undefined, false, undefined);
    expect(anyQuote(LIVE_ID)).toBe(false);
  });

  it("the reply bar only lasts for one message", async () => {
    await mount();
    await longPress(THEIRS_ID);
    await press(byTestId("message-action-reply"), "reply");
    await typeText("first");
    await press(byTestId("chat-send"), "send");
    await flush();
    await typeText("second");
    await press(byTestId("chat-send"), "send");
    await flush();
    expect(mockSend).toHaveBeenLastCalledWith(MATCH, ME, "second", undefined, false, undefined);
  });

  it("when the original disappeared on the server the text is kept and the person is told", async () => {
    mockSend.mockImplementation(async () => ({ success: false, error: "reply_target_unavailable" }));
    await mount();
    await longPress(THEIRS_ID);
    await press(byTestId("message-action-reply"), "reply");
    await typeText("nothing much");
    await press(byTestId("chat-send"), "send");
    await flush();
    expect(mockAlert).toHaveBeenCalledWith("Message unavailable", expect.stringContaining("no longer available"));
    expect(inputValue()).toBe("nothing much");
    expect(anyQuote(LIVE_ID)).toBe(false);
    expect(any("reply-draft-bar")).toBe(false);
  });

  it("a message deleted for everyone has no Reply option", async () => {
    await mount([MINE, { ...THEIRS, text: "", deletedAt: "2026-10-22T09:00:00Z" }]);
    await longPress(THEIRS_ID);
    expect(byTestId("message-action-delete-for-me")).not.toBeNull();
    expect(byTestId("message-action-reply")).toBeNull();
  });

  it("the partner deleting the original while I am replying cancels the reply", async () => {
    await mount();
    await longPress(THEIRS_ID);
    await press(byTestId("message-action-reply"), "reply");
    expect(any("reply-draft-bar")).toBe(true);
    await act(async () => mockHandlers.onMessageDeleted({ id: THEIRS_ID, deletedAt: "2026-10-22T10:00:00Z" }));
    expect(any("reply-draft-bar")).toBe(false);
  });

  it("deleting the original for me cancels the reply and blanks the quote of earlier replies", async () => {
    await mount([MINE, THEIRS, REPLY]);
    expect(allText()).toContain("what are you doing tonight?");
    await longPress(THEIRS_ID);
    await press(byTestId("message-action-reply"), "reply");
    await longPress(THEIRS_ID);
    await press(byTestId("message-action-delete-for-me"), "delete for me");
    await flush();
    expect(any("reply-draft-bar")).toBe(false);
    expect(allText()).toContain("Original message unavailable");
    expect(allText()).not.toContain("what are you doing tonight?");
  });

  it("the original deleted for everyone blanks the quotes of replies to it, live", async () => {
    await mount([MINE, THEIRS, REPLY]);
    await act(async () => mockHandlers.onMessageDeleted({ id: THEIRS_ID, deletedAt: "2026-10-22T10:00:00Z" }));
    expect(allText()).toContain("Original message unavailable");
    expect(allText()).not.toContain("what are you doing tonight?");
  });

  it("tapping a quote scrolls to the original message", async () => {
    await mount([MINE, THEIRS, REPLY]);
    const list = renderer.root.findByType(FlatList).instance as any;
    list.scrollToIndex = jest.fn();
    await press(quoteOf(REPLY_ID), "quote");
    expect(list.scrollToIndex).toHaveBeenCalledWith(expect.objectContaining({ index: 1, animated: true }));
  });

  it("tapping a quote whose original is not loaded says so instead of doing nothing", async () => {
    const farReply = { ...REPLY, replyToId: OLD_ID, replyTo: { id: OLD_ID, from: "them", text: "ancient", kind: "text", unavailable: false } };
    await mount([MINE, farReply]);
    await press(quoteOf(REPLY_ID), "quote");
    expect(mockAlert).toHaveBeenCalledWith("Message not loaded", expect.any(String));
  });

  it("a live reply from the partner is quoted from the chat without asking the server", async () => {
    await mount();
    mockFetch.mockClear();
    await act(async () =>
      mockOnReceived?.({ ...base, id: LIVE_ID, sender: THEM, from: "them", text: "me neither", at: 9000, replyToId: MINE_ID }),
    );
    await flush();
    expect(anyQuote(LIVE_ID)).toBe(true);
    expect(allText()).toContain("my own text");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("a live reply to a message that is not loaded gets its quote from one server refetch", async () => {
    await mount();
    const bare = { ...base, id: LIVE_ID, sender: THEM, from: "them", text: "re: long ago", at: 9000, replyToId: OLD_ID };
    mockFetch.mockClear();
    mockFetch.mockResolvedValue([
      MINE,
      THEIRS,
      { ...bare, replyTo: { id: OLD_ID, from: "me", text: "an old message", kind: "text", unavailable: false } },
    ]);
    await act(async () => mockOnReceived?.(bare));
    await flush();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(anyQuote(LIVE_ID)).toBe(true);
    expect(allText()).toContain("an old message");
    // it does not loop: a second unrelated message does not refetch for the same reply
    await act(async () => mockOnReceived?.({ ...base, id: "66666666-6666-4666-8666-666666666666", sender: THEM, from: "them", text: "hi", at: 9500 }));
    await flush();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
