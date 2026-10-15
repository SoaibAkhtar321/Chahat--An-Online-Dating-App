const mockStorage = new Map<string, string>();
const mockPreferences = new Map<string, Record<string, boolean>>();
const mockRpc = jest.fn();
let mockCurrentUserId = "user-a";

jest.resetModules();

jest.doMock(
  "@react-native-async-storage/async-storage",
  () => ({
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
  }),
  { virtual: true },
);

jest.doMock(
  "expo-secure-store",
  () => ({
    getItemAsync: jest.fn().mockResolvedValue(null),
    setItemAsync: jest.fn().mockResolvedValue(undefined),
    deleteItemAsync: jest.fn().mockResolvedValue(undefined),
  }),
  { virtual: true },
);

jest.doMock(
  "react-native",
  () => ({
    Platform: { OS: "android" },
  }),
  { virtual: true },
);

jest.doMock(
  "expo-application",
  () => ({
    nativeApplicationVersion: "1.0.0",
  }),
  { virtual: true },
);

jest.doMock(
  "expo-constants",
  () => ({
    __esModule: true,
    default: { expoConfig: { extra: { eas: { projectId: "test-project" } } } },
  }),
  { virtual: true },
);

jest.doMock("expo-device", () => ({ isDevice: true }), { virtual: true });

jest.doMock(
  "expo-notifications",
  () => ({
    AndroidImportance: { HIGH: 4 },
    setNotificationHandler: jest.fn(),
  }),
  { virtual: true },
);

jest.doMock("../mobile/src/services/supabase", () => ({
  isSupabaseConfigured: () => true,
  supabase: {
    auth: {
      getUser: jest.fn(async () => ({
        data: { user: { id: mockCurrentUserId } },
        error: null,
      })),
    },
    from: (table: string) => ({
      select: () => ({
        eq: (_column: string, userId: string) => ({
          maybeSingle: async () => ({
            data: mockPreferences.get(userId) ?? null,
            error: null,
          }),
        }),
      }),
      upsert: async (row: {
        user_id: string;
        matches: boolean;
        messages: boolean;
        likes: boolean;
      }) => {
        if (table === "notification_preferences") {
          mockPreferences.set(row.user_id, {
            matches: row.matches,
            messages: row.messages,
            likes: row.likes,
          });
        }
        return { error: null };
      },
    }),
    rpc: (...args: any[]) => mockRpc(...args),
  },
}));

const {
  clearNotificationState,
  fetchNotificationInbox,
  getNotificationPreferences,
  saveNotificationPreferences,
} =
  require("../mobile/src/services/notifications") as typeof import("../mobile/src/services/notifications");

beforeEach(() => {
  mockStorage.clear();
  mockPreferences.clear();
  mockCurrentUserId = "user-a";
  mockRpc.mockReset();
});

describe("account-scoped notification state", () => {
  it("does not seed a fabricated welcome notice", async () => {
    await expect(fetchNotificationInbox("user-a")).resolves.toEqual([]);
    expect(mockStorage.size).toBe(0);
  });

  it("loads and saves preferences only for the authenticated account", async () => {
    await saveNotificationPreferences("user-a", { matches: false, messages: true, likes: false });
    await expect(getNotificationPreferences("user-a")).resolves.toEqual({
      matches: false,
      messages: true,
      likes: false,
    });
    await expect(getNotificationPreferences("user-b")).rejects.toThrow(
      "limited to the signed-in account",
    );
    mockCurrentUserId = "user-b";
    await expect(getNotificationPreferences("user-b")).resolves.toEqual({
      matches: true,
      messages: true,
      likes: true,
    });
  });

  it("clears only the specified account inbox and legacy global keys", async () => {
    mockStorage.set("milo_notifications_inbox:user-a", "[]");
    mockStorage.set("milo_notifications_inbox:user-b", "[]");
    await clearNotificationState("user-a");
    await expect(fetchNotificationInbox("user-a")).resolves.toEqual([]);
    expect(mockStorage.has("milo_notifications_inbox:user-a")).toBe(false);
    expect(mockStorage.has("milo_notifications_inbox:user-b")).toBe(true);
  });

  it("does not seed notifications or issue a push registration", async () => {
    await expect(fetchNotificationInbox("user-a")).resolves.toEqual([]);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
