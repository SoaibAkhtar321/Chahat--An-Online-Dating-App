import React from "react";
import TestRenderer, { act } from "react-test-renderer";

// Wiring test: the real chat screen must switch screenshot protection on while it is focused and off again
// when it is covered or closed. Everything around it is stubbed, like in chatDeleteScreen.test.tsx.
const { createFakeScreenCapture } = require("./helpers/fakeScreenCapture");

const ME = "aaaaaaaa-0000-4000-8000-000000000001";
const MATCH = "f6c60000-0000-4000-8000-000000000001";
const mockUser = { id: ME };
const mockMiloValue = { matches: [], refreshMatches: jest.fn() };

const mockFake = createFakeScreenCapture();
jest.mock("expo-screen-capture", () => mockFake.module);
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}), { virtual: true });
jest.mock("react-native-safe-area-context", () => {
  const { View } = require("react-native");
  return { SafeAreaView: View };
});
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "f6c60000-0000-4000-8000-000000000001" }),
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
  useFocusEffect: (effect: () => void) => require("@react-navigation/core").useFocusEffect(effect),
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
  getAudioPlayerAdapter: () => ({ stopAsync: jest.fn(), pauseAsync: jest.fn(), playAsync: jest.fn() }),
}));
jest.mock("../mobile/src/services/supabase", () => ({
  supabase: { removeChannel: jest.fn(), rpc: jest.fn() },
  isSupabaseConfigured: () => true,
}));
jest.mock("../mobile/src/services/chat", () => ({
  fetchMessagesForMatch: jest.fn().mockResolvedValue([]),
  sendChatMessage: jest.fn(),
  sendVoiceMessage: jest.fn(),
  markChatRead: jest.fn(),
  fetchReactionsForMatch: jest.fn(async () => []),
  setMessageReaction: jest.fn(async () => ({ success: true })),
  subscribeToMatchMessages: jest.fn(() => ({ id: "channel" })),
}));
jest.mock("../mobile/src/utils/alert", () => ({ Alert: { alert: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { NavigationContext } = require("@react-navigation/core");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Platform } = require("react-native");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ChatDetailScreen = require("../mobile/app/chat/[id]").default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { screenProtectionHolderCount } = require("../mobile/src/services/screenProtection");

const native = mockFake.state;

function createNav() {
  let focused = true;
  const listeners: Record<"focus" | "blur", Set<() => void>> = { focus: new Set(), blur: new Set() };
  return {
    isFocused: () => focused,
    addListener: (type: "focus" | "blur", cb: () => void) => {
      listeners[type].add(cb);
      return () => listeners[type].delete(cb);
    },
    focus() {
      focused = true;
      listeners.focus.forEach((cb) => cb());
    },
    blur() {
      focused = false;
      listeners.blur.forEach((cb) => cb());
    },
  };
}

const flush = () => act(async () => { await jest.advanceTimersByTimeAsync(0); });

beforeEach(() => {
  jest.useFakeTimers();
  Platform.OS = "android";
  native.reset();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("Phase 3C: chat screen screenshot protection", () => {
  it("protects the chat while it is open, drops protection when covered, and clears it on unmount", async () => {
    const nav = createNav();
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <NavigationContext.Provider value={nav}>
          <ChatDetailScreen />
        </NavigationContext.Provider>,
      );
    });
    await flush();
    expect(MATCH).toBeTruthy();
    expect(native.flagSecure).toBe(true);
    expect(screenProtectionHolderCount()).toBe(1);

    // Profile or call screen pushed on top: no chat content is visible any more.
    await act(async () => nav.blur());
    await flush();
    expect(native.flagSecure).toBe(false);

    // Back on the chat.
    await act(async () => nav.focus());
    await flush();
    expect(native.flagSecure).toBe(true);

    await act(async () => renderer.unmount());
    await flush();
    expect(native.flagSecure).toBe(false);
    expect(screenProtectionHolderCount()).toBe(0);
    expect(native.tags.size).toBe(0);
  });
});
