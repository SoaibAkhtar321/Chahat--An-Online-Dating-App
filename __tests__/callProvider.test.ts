import {
  CallError,
  isCallingAvailable,
  notConfiguredMediaProvider,
  setCallMediaProviderForTests,
  getCallMediaProvider,
  type CallMediaProvider,
} from "../mobile/src/services/callMedia";

const configuredProvider: CallMediaProvider = {
  name: "fake",
  configured: true,
  requestPermissions: jest.fn().mockResolvedValue(true),
  join: jest.fn(),
};

afterEach(() => setCallMediaProviderForTests(null));

describe("client call media provider foundation", () => {
  it("ships with no media provider and does not claim one is configured", () => {
    expect(getCallMediaProvider()).toBe(notConfiguredMediaProvider);
    expect(notConfiguredMediaProvider.configured).toBe(false);
  });

  it("fails explicitly rather than simulating a successful join", async () => {
    await expect(
      notConfiguredMediaProvider.join(
        { provider: "x", roomId: "r", token: "t", expiresAt: "2026-10-16T00:00:00Z", callType: "audio" },
        { callType: "audio" },
      ),
    ).rejects.toMatchObject({ code: "provider_not_configured" });
    await expect(notConfiguredMediaProvider.requestPermissions("audio")).resolves.toBe(false);
  });

  it("gates calling on BOTH the feature flag and a configured provider", () => {
    expect(isCallingAvailable(false, configuredProvider)).toBe(false);
    expect(isCallingAvailable(true, notConfiguredMediaProvider)).toBe(false);
    expect(isCallingAvailable(false, notConfiguredMediaProvider)).toBe(false);
    expect(isCallingAvailable(true, configuredProvider)).toBe(true);
  });

  it("defaults to unavailable with the real environment (flag off, no adapter)", () => {
    expect(isCallingAvailable()).toBe(false);
  });

  it("CallError carries a stable code and a user-safe message", () => {
    const error = new CallError("rate_limited");
    expect(error.code).toBe("rate_limited");
    expect(error.message).not.toMatch(/token|secret|key/i);
  });
});
