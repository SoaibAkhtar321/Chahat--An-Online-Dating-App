const mockSignUp = jest.fn();
const mockSignInWithPassword = jest.fn();
const mockResetPasswordForEmail = jest.fn();
const mockExchangeCodeForSession = jest.fn();
const mockSetSession = jest.fn();
const mockGetSession = jest.fn();
const mockUpdateUser = jest.fn();
const mockSignOut = jest.fn();
const mockUnregisterToken = jest.fn();

jest.resetModules();

jest.doMock("../mobile/src/services/supabase", () => ({
  supabase: {
    auth: {
      signUp: (...args: any[]) => mockSignUp(...args),
      signInWithPassword: (...args: any[]) => mockSignInWithPassword(...args),
      resetPasswordForEmail: (...args: any[]) => mockResetPasswordForEmail(...args),
      exchangeCodeForSession: (...args: any[]) => mockExchangeCodeForSession(...args),
      setSession: (...args: any[]) => mockSetSession(...args),
      getSession: (...args: any[]) => mockGetSession(...args),
      updateUser: (...args: any[]) => mockUpdateUser(...args),
      signOut: (...args: any[]) => mockSignOut(...args),
    },
  },
  isSupabaseConfigured: () => true,
  getConfigStatus: () => ({ configured: true, missing: [] }),
}));

jest.doMock("../mobile/node_modules/expo-linking", () => ({
  createURL: (path: string, options?: { queryParams?: Record<string, string> }) => {
    const query = options?.queryParams
      ? `?${new URLSearchParams(options.queryParams).toString()}`
      : "";
    return `chahat://${path}${query}`;
  },
}));

jest.doMock("../mobile/src/services/notifications", () => ({
  clearNotificationState: jest.fn().mockResolvedValue(undefined),
  unregisterPushNotificationToken: (...args: any[]) => mockUnregisterToken(...args),
}));

const { completeAuthLink, resetPassword, signInUser, signUpUser, updateRecoveryPassword } =
  require("../mobile/src/services/auth") as typeof import("../mobile/src/services/auth");

beforeEach(() => {
  jest.clearAllMocks();
  mockSignUp.mockResolvedValue({ data: { user: { identities: [{}] } }, error: null });
  mockSignInWithPassword.mockResolvedValue({ data: { user: { id: "account-1" } }, error: null });
  mockUnregisterToken.mockResolvedValue({ success: true });
  mockResetPasswordForEmail.mockResolvedValue({ error: null });
  mockExchangeCodeForSession.mockResolvedValue({ error: null });
  mockSetSession.mockResolvedValue({ error: null });
  mockGetSession.mockResolvedValue({
    data: { session: { user: { id: "account-1" } } },
    error: null,
  });
  mockUpdateUser.mockResolvedValue({ error: null });
  mockSignOut.mockResolvedValue({ error: null });
});

describe("auth email link lifecycle", () => {
  it("routes confirmation links to the registered in-app callback", async () => {
    const result = await signUpUser("person@example.test", "passWord1");
    expect(result.success).toBe(true);
    expect(mockSignUp).toHaveBeenCalledWith({
      email: "person@example.test",
      password: "passWord1",
      options: { emailRedirectTo: "chahat://callback" },
    });
  });

  it("sends password recovery links to the callback with an explicit recovery flow", async () => {
    const result = await resetPassword("person@example.test");
    expect(result.success).toBe(true);
    expect(mockResetPasswordForEmail).toHaveBeenCalledWith("person@example.test", {
      redirectTo: "chahat://callback?flow=recovery",
    });
  });

  it("keeps the push token registered when signing into the same account", async () => {
    mockGetSession.mockResolvedValueOnce({
      data: { session: { user: { id: "account-1", email: "person@example.test" } } },
      error: null,
    });
    await expect(signInUser("person@example.test", "passWord1")).resolves.toMatchObject({
      success: true,
    });
    expect(mockUnregisterToken).not.toHaveBeenCalled();
  });

  it("unregisters the previous account token before switching accounts", async () => {
    mockGetSession.mockResolvedValueOnce({
      data: { session: { user: { id: "account-1", email: "old@example.test" } } },
      error: null,
    });
    await expect(signInUser("new@example.test", "passWord1")).resolves.toMatchObject({
      success: true,
    });
    expect(mockUnregisterToken).toHaveBeenCalledWith("account-1");
  });

  it("blocks an account switch when the previous push token cannot be unregistered", async () => {
    mockGetSession.mockResolvedValueOnce({
      data: { session: { user: { id: "account-1", email: "old@example.test" } } },
      error: null,
    });
    mockUnregisterToken.mockResolvedValueOnce({ success: false, error: "network unavailable" });
    await expect(signInUser("new@example.test", "passWord1")).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("Could not securely switch accounts"),
    });
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });

  it("exchanges PKCE confirmation codes before reporting a completed callback", async () => {
    await expect(completeAuthLink("chahat://callback?code=one-time-code")).resolves.toEqual({
      success: true,
      flow: "confirmation",
    });
    expect(mockExchangeCodeForSession).toHaveBeenCalledWith("one-time-code");
  });

  it("identifies recovery callbacks and establishes fragment-token sessions", async () => {
    await expect(
      completeAuthLink("chahat://callback?flow=recovery#access_token=access&refresh_token=refresh"),
    ).resolves.toEqual({ success: true, flow: "recovery" });
    expect(mockSetSession).toHaveBeenCalledWith({
      access_token: "access",
      refresh_token: "refresh",
    });
  });

  it("fails closed for provider errors and incomplete links", async () => {
    await expect(
      completeAuthLink("chahat://callback?flow=recovery&error_description=expired"),
    ).resolves.toMatchObject({ success: false, flow: "recovery", error: "expired" });
    await expect(completeAuthLink("chahat://callback")).resolves.toMatchObject({
      success: false,
      error: expect.stringMatching(/expired/i),
    });
    await expect(
      completeAuthLink("https://attacker.example/callback?code=not-exchanged"),
    ).resolves.toMatchObject({ success: false, error: expect.stringMatching(/not a recognized/i) });
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("requires an active recovery session before changing the password", async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    await expect(updateRecoveryPassword("passWord1")).resolves.toMatchObject({
      success: false,
      error: expect.stringMatching(/session is missing/i),
    });
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it("updates the password only through the authenticated Supabase session", async () => {
    await expect(updateRecoveryPassword("passWord1")).resolves.toEqual({ success: true });
    expect(mockUpdateUser).toHaveBeenCalledWith({ password: "passWord1" });
    expect(mockSignOut).toHaveBeenCalledWith({ scope: "local" });
  });
});
