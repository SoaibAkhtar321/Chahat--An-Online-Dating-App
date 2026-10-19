import React from "react";
import { Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

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
const mockRecorder = {
  requestPermissionsAsync: jest.fn(),
  startRecordingAsync: jest.fn(),
  stopRecordingAsync: jest.fn(),
  cancelRecordingAsync: jest.fn(async () => undefined),
};
const mockCleanup = jest.fn(async () => undefined);
jest.mock("../mobile/src/services/voiceMedia", () => ({
  VOICE_LIMITS: { maxDurationMs: 60000 },
  getAudioRecorderAdapter: () => mockRecorder,
  cleanupAbandonedVoiceFile: (...a: unknown[]) => mockCleanup(...a),
  getAudioPlayerAdapter: () => ({ stopAsync: jest.fn(async () => undefined), pauseAsync: jest.fn(async () => undefined), playAsync: jest.fn() }),
}));
const mockSendVoice = jest.fn();
// Expo inlines EXPO_PUBLIC_* at transform time, so the flag is controlled through the config module.
let mockVoiceFlag = true;
jest.mock("../mobile/src/config/appConfig", () => ({
  isServiceConfigured: (name: string) => (name === "voiceMessages" ? mockVoiceFlag : false),
}));
jest.mock("../mobile/src/services/supabase", () => ({
  supabase: { removeChannel: jest.fn(), rpc: jest.fn() },
  isSupabaseConfigured: () => true,
}));
jest.mock("../mobile/src/services/chat", () => ({
  fetchMessagesForMatch: (...a: unknown[]) => mockFetch(...a),
  sendChatMessage: jest.fn(),
  sendVoiceMessage: (...a: unknown[]) => mockSendVoice(...a),
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

let renderer: TestRenderer.ReactTestRenderer;
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

async function mount() {
  mockFetch.mockResolvedValue([]);
  await act(async () => {
    renderer = TestRenderer.create(<ChatDetailScreen />);
  });
  await flush();
}
const byId = (id: string) => renderer.root.findAll((n) => n.props?.testID === id && typeof n.props.onPress === "function")[0] ?? null;
const anyId = (id: string) => renderer.root.findAll((n) => n.props?.testID === id).length > 0;
const press = async (id: string) => {
  const n = byId(id);
  if (!n) throw new Error(`nothing to press: ${id}`);
  await act(async () => { await n.props.onPress(); });
};

const RESULT = { uri: "file:///cache/rec.m4a", durationMs: 4200, fileSizeBytes: 16384, mimeType: "audio/m4a" };

beforeEach(() => {
  jest.clearAllMocks();
  mockVoiceFlag = true;
  mockRecorder.requestPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
  mockRecorder.startRecordingAsync.mockResolvedValue({ success: true });
  mockRecorder.stopRecordingAsync.mockResolvedValue({ success: true, result: RESULT });
  mockSendVoice.mockResolvedValue({ success: true, message: { id: "m1", matchId: MATCH, sender: ME, from: "me", text: "Voice message", messageType: "voice", at: 5000, status: "sent", deletedAt: null } });
});
afterEach(async () => {
  await act(async () => { renderer?.unmount(); });
});

describe("chat composer voice messages", () => {
  test("mic is hidden when the voice flag is off (production default)", async () => {
    mockVoiceFlag = false;
    await mount();
    expect(anyId("voice-record")).toBe(false);
  });

  test("mic is shown when the flag is on", async () => {
    await mount();
    expect(anyId("voice-record")).toBe(true);
  });

  test("record then send uploads the real recording and deletes the local file", async () => {
    await mount();
    await press("voice-record");
    expect(mockRecorder.startRecordingAsync).toHaveBeenCalledWith(60000);
    expect(anyId("voice-recording-bar")).toBe(true);

    await press("voice-send");
    expect(mockRecorder.stopRecordingAsync).toHaveBeenCalledTimes(1);
    expect(mockSendVoice).toHaveBeenCalledWith(MATCH, ME, RESULT.uri, 4, "audio/m4a");
    expect(mockCleanup).toHaveBeenCalledWith(RESULT.uri);
    expect(anyId("voice-recording-bar")).toBe(false);
  });

  test("cancel discards the recording and sends nothing", async () => {
    await mount();
    await press("voice-record");
    await press("voice-cancel");
    expect(mockRecorder.cancelRecordingAsync).toHaveBeenCalledTimes(1);
    expect(mockRecorder.stopRecordingAsync).not.toHaveBeenCalled();
    expect(mockSendVoice).not.toHaveBeenCalled();
    expect(anyId("voice-recording-bar")).toBe(false);
  });

  test("denied microphone permission shows guidance and does not start recording", async () => {
    mockRecorder.requestPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
    await mount();
    await press("voice-record");
    expect(mockRecorder.startRecordingAsync).not.toHaveBeenCalled();
    expect(mockAlert).toHaveBeenCalledWith(expect.stringMatching(/microphone/i), expect.stringMatching(/Settings/));
    expect(anyId("voice-recording-bar")).toBe(false);
  });

  test("upload failure is reported and the local file is still removed", async () => {
    mockSendVoice.mockResolvedValue({ success: false, error: "Network request failed" });
    await mount();
    await press("voice-record");
    await press("voice-send");
    expect(mockAlert).toHaveBeenCalledWith(expect.stringMatching(/couldn't send/i), "Network request failed");
    expect(mockCleanup).toHaveBeenCalledWith(RESULT.uri);
  });

  test("leaving the chat mid-recording discards the recording", async () => {
    await mount();
    await press("voice-record");
    await act(async () => { renderer.unmount(); });
    expect(mockRecorder.cancelRecordingAsync).toHaveBeenCalled();
  });
});
