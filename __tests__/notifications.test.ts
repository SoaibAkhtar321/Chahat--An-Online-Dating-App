const mockGetUser = jest.fn();
const mockFrom = jest.fn();
const mockRpc = jest.fn();
const mockGetPermissions = jest.fn();
const mockRequestPermissions = jest.fn();
const mockGetExpoPushToken = jest.fn();
const mockSecureGet = jest.fn();
const mockSecureSet = jest.fn();
const mockSecureDelete = jest.fn();
let mockPushConfigured = true;

// Expo inlines EXPO_PUBLIC_* at compile time (also under jest), so the flag is mocked here.
jest.mock("../mobile/src/config/appConfig", () => ({
  isServiceConfigured: () => mockPushConfigured,
}));

jest.mock(
  "@react-native-async-storage/async-storage",
  () => ({
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  }),
  { virtual: true },
);

jest.mock(
  "expo-application",
  () => ({
    nativeApplicationVersion: "1.2.3",
  }),
  { virtual: true },
);

jest.mock(
  "expo-constants",
  () => ({
    __esModule: true,
    default: {
      expoConfig: { extra: { eas: { projectId: "configured-eas-project-id" } } },
    },
  }),
  { virtual: true },
);

jest.mock("expo-device", () => ({ isDevice: true }), { virtual: true });

jest.mock(
  "expo-notifications",
  () => ({
    AndroidImportance: { HIGH: 4 },
    setNotificationHandler: jest.fn(),
    setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
    getPermissionsAsync: (...args: unknown[]) => mockGetPermissions(...args),
    requestPermissionsAsync: (...args: unknown[]) => mockRequestPermissions(...args),
    getExpoPushTokenAsync: (...args: unknown[]) => mockGetExpoPushToken(...args),
  }),
  { virtual: true },
);

jest.mock(
  "expo-secure-store",
  () => ({
    getItemAsync: (...args: unknown[]) => mockSecureGet(...args),
    setItemAsync: (...args: unknown[]) => mockSecureSet(...args),
    deleteItemAsync: (...args: unknown[]) => mockSecureDelete(...args),
  }),
  { virtual: true },
);

jest.mock(
  "react-native",
  () => ({
    Platform: { OS: "ios" },
  }),
  { virtual: true },
);

jest.mock("../mobile/src/services/supabase", () => ({
  isSupabaseConfigured: jest.fn().mockReturnValue(true),
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import {
  isExpoPushToken,
  registerPushNotificationToken,
  unregisterPushNotificationToken,
} from "../mobile/src/services/notifications";

describe("real Expo push registration", () => {
  beforeEach(() => {
    mockPushConfigured = true;
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    mockFrom.mockReturnValue({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn().mockResolvedValue({
            data: { matches: true, messages: true, likes: true },
            error: null,
          }),
        })),
      })),
    });
    mockGetPermissions.mockResolvedValue({ granted: true, canAskAgain: true });
    mockRequestPermissions.mockResolvedValue({ granted: true, canAskAgain: true });
    mockGetExpoPushToken.mockResolvedValue({
      data: "ExponentPushToken[12345678-1234-1234-1234-123456789abc]",
    });
    mockSecureGet.mockResolvedValue(null);
    mockSecureSet.mockResolvedValue(undefined);
    mockSecureDelete.mockResolvedValue(undefined);
    mockRpc.mockResolvedValue({ error: null });
  });

  it("does nothing while push is not configured (no prompt, no token, no RPC)", async () => {
    mockPushConfigured = false;
    await expect(registerPushNotificationToken("user-1")).resolves.toEqual({
      status: "not_configured",
    });
    expect(mockRequestPermissions).not.toHaveBeenCalled();
    expect(mockGetPermissions).not.toHaveBeenCalled();
    expect(mockGetExpoPushToken).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockSecureSet).not.toHaveBeenCalled();
  });

  it("registers the real Expo token with the signed-in account and configured project", async () => {
    await expect(registerPushNotificationToken("user-1")).resolves.toEqual({
      status: "registered",
    });
    expect(mockGetExpoPushToken).toHaveBeenCalledWith({
      projectId: "configured-eas-project-id",
    });
    expect(mockRpc).toHaveBeenCalledWith("register_push_device", {
      _token: "ExponentPushToken[12345678-1234-1234-1234-123456789abc]",
      _platform: "ios",
      _app_version: "1.2.3",
      _previous_token: null,
    });
    expect(mockSecureSet).toHaveBeenCalledWith(
      "milo_expo_push_token:user-1",
      "ExponentPushToken[12345678-1234-1234-1234-123456789abc]",
    );
  });

  it("asks permission only once and reports denial without fabricating a token", async () => {
    mockGetPermissions.mockResolvedValue({ granted: false, canAskAgain: false });
    await expect(registerPushNotificationToken("user-1")).resolves.toEqual({
      status: "permission_denied",
    });
    expect(mockRequestPermissions).not.toHaveBeenCalled();
    expect(mockGetExpoPushToken).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("requests permission once when the operating system permits it", async () => {
    mockGetPermissions.mockResolvedValue({ granted: false, canAskAgain: true });
    mockRequestPermissions.mockResolvedValue({ granted: true, canAskAgain: true });
    await expect(registerPushNotificationToken("user-1")).resolves.toEqual({
      status: "registered",
    });
    expect(mockRequestPermissions).toHaveBeenCalledTimes(1);
    expect(mockSecureSet).toHaveBeenCalledWith("milo_push_permission_prompted", "1");
  });

  it("does not repeat a permission prompt after the first denied attempt", async () => {
    mockGetPermissions.mockResolvedValue({ granted: false, canAskAgain: true });
    mockSecureGet.mockResolvedValue("1");
    await expect(registerPushNotificationToken("user-1")).resolves.toEqual({
      status: "permission_denied",
    });
    expect(mockRequestPermissions).not.toHaveBeenCalled();
  });

  it("submits the previous token so the server can replace this account's rotated token", async () => {
    mockSecureGet.mockResolvedValue("ExponentPushToken[32345678-1234-1234-1234-123456789abc]");
    await registerPushNotificationToken("user-1");
    expect(mockRpc).toHaveBeenCalledWith(
      "register_push_device",
      expect.objectContaining({
        _previous_token: "ExponentPushToken[32345678-1234-1234-1234-123456789abc]",
      }),
    );
  });

  it("restores the prior server token if persisting a rotated token securely fails", async () => {
    const previousToken = "ExponentPushToken[32345678-1234-1234-1234-123456789abc]";
    const nextToken = "ExponentPushToken[12345678-1234-1234-1234-123456789abc]";
    mockSecureGet.mockResolvedValue(previousToken);
    mockSecureSet.mockRejectedValueOnce(new Error("secure storage unavailable"));

    await expect(registerPushNotificationToken("user-1")).resolves.toMatchObject({
      status: "error",
      error: "secure storage unavailable",
    });
    expect(mockRpc).toHaveBeenNthCalledWith(
      2,
      "register_push_device",
      expect.objectContaining({ _token: previousToken, _previous_token: nextToken }),
    );
  });

  it("rejects a mismatched auth identity and malformed provider token", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "other-user" } },
      error: null,
    });
    await expect(registerPushNotificationToken("user-1")).resolves.toMatchObject({
      status: "error",
      error: expect.stringContaining("signed-in account"),
    });
    expect(mockRpc).not.toHaveBeenCalled();

    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mockGetExpoPushToken.mockResolvedValue({ data: "fcm_mock_user-1" });
    await expect(registerPushNotificationToken("user-1")).resolves.toMatchObject({
      status: "error",
      error: expect.stringContaining("invalid push token"),
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("unregisters only the current account's securely stored token", async () => {
    mockSecureGet.mockResolvedValue("ExponentPushToken[12345678-1234-1234-1234-123456789abc]");
    await unregisterPushNotificationToken("user-1");
    expect(mockRpc).toHaveBeenCalledWith("unregister_push_device", {
      _token: "ExponentPushToken[12345678-1234-1234-1234-123456789abc]",
    });
    expect(mockSecureDelete).toHaveBeenCalledWith("milo_expo_push_token:user-1");
  });

  it("validates only real Expo token formats", () => {
    expect(isExpoPushToken("ExponentPushToken[12345678-1234-1234-1234-123456789abc]")).toBe(true);
    expect(isExpoPushToken("ExpoPushToken[abcdefghij]")).toBe(true);
    expect(isExpoPushToken("fcm_mock_user-1")).toBe(false);
  });
});
