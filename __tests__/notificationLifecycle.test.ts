const mockStorage = new Map<string, string>();
const mockRpc = jest.fn();

jest.resetModules();

jest.doMock("../mobile/node_modules/@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStorage.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockStorage.delete(key);
    }),
    multiRemove: jest.fn(async (keys: string[]) => {
      keys.forEach((key) => mockStorage.delete(key));
    }),
  },
}));

jest.doMock("../mobile/node_modules/expo-secure-store", () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.doMock("../mobile/node_modules/react-native", () => ({
  Platform: { OS: "android" },
}));

jest.doMock("../mobile/node_modules/expo-application", () => ({
  nativeApplicationVersion: "1.0.0",
}));

jest.doMock("../mobile/src/services/supabase", () => ({
  isSupabaseConfigured: () => true,
  supabase: {
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-a" } }, error: null }),
    },
    rpc: (...args: any[]) => mockRpc(...args),
  },
}));

const {
  clearNotificationState,
  fetchNotificationInbox,
  getNotificationPreferences,
  registerPushNotificationToken,
  saveNotificationPreferences,
} =
  require("../mobile/src/services/notifications") as typeof import("../mobile/src/services/notifications");

beforeEach(() => {
  mockStorage.clear();
  mockRpc.mockReset();
});

describe("account-scoped notification state", () => {
  it("does not seed a fabricated welcome notice", async () => {
    await expect(fetchNotificationInbox("user-a")).resolves.toEqual([]);
    expect(mockStorage.size).toBe(0);
  });

  it("keeps preferences isolated between account IDs", async () => {
    await saveNotificationPreferences("user-a", { matches: false, messages: true, likes: false });
    await expect(getNotificationPreferences("user-a")).resolves.toEqual({
      matches: false,
      messages: true,
      likes: false,
    });
    await expect(getNotificationPreferences("user-b")).resolves.toEqual({
      matches: true,
      messages: true,
      likes: true,
    });
  });

  it("clears only the specified account cache and legacy global keys", async () => {
    await saveNotificationPreferences("user-a", { matches: false, messages: false, likes: false });
    await saveNotificationPreferences("user-b", { matches: true, messages: false, likes: true });
    await clearNotificationState("user-a");
    await expect(getNotificationPreferences("user-a")).resolves.toEqual({
      matches: true,
      messages: true,
      likes: true,
    });
    await expect(getNotificationPreferences("user-b")).resolves.toEqual({
      matches: true,
      messages: false,
      likes: true,
    });
  });

  it("never fabricates a push token or calls registration without a real token", async () => {
    await expect(registerPushNotificationToken("user-a", "")).resolves.toMatchObject({
      success: false,
      error: expect.stringMatching(/Expo push token/i),
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
