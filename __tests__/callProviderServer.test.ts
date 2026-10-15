import {
  NotConfiguredCallProvider,
  resolveCallProvider,
  REGISTERED_CALL_PROVIDERS,
  type CallProvider,
} from "../supabase/functions/_shared/callProvider";

function fakeProvider(configured = true): CallProvider {
  return {
    name: "fake",
    configured,
    ensureRoom: jest.fn(async () => ({ ok: true as const, value: { roomId: "room-1" } })),
    issueJoinToken: jest.fn(async () => ({
      ok: true as const,
      value: { roomId: "room-1", token: "t", expiresAt: "2026-10-16T00:00:00Z" },
    })),
    endRoom: jest.fn(async () => ({ ok: true as const, value: undefined })),
  };
}

describe("server call provider resolution", () => {
  it("ships with no registered adapters", () => {
    expect(Object.keys(REGISTERED_CALL_PROVIDERS)).toHaveLength(0);
  });

  it.each([
    ["unset", {}],
    ["blank", { CALL_PROVIDER: "   " }],
    ["unknown adapter", { CALL_PROVIDER: "agora" }],
    ["prototype key", { CALL_PROVIDER: "toString" }],
    ["__proto__ key", { CALL_PROVIDER: "__proto__" }],
  ])("returns the not-configured provider when selection is %s", async (_label, env) => {
    const provider = resolveCallProvider(env);
    expect(provider.configured).toBe(false);
    await expect(provider.ensureRoom()).resolves.toMatchObject({ ok: false, code: "not_configured" });
    await expect(provider.issueJoinToken()).resolves.toMatchObject({ ok: false, code: "not_configured" });
    await expect(provider.endRoom()).resolves.toMatchObject({ ok: false, code: "not_configured" });
  });

  it("uses a registered adapter only when it reports configured", () => {
    const registry = { demo: () => fakeProvider(true), broken: () => fakeProvider(false), none: () => null };
    expect(resolveCallProvider({ CALL_PROVIDER: "Demo" }, registry).name).toBe("fake");
    expect(resolveCallProvider({ CALL_PROVIDER: "broken" }, registry).configured).toBe(false);
    expect(resolveCallProvider({ CALL_PROVIDER: "none" }, registry).configured).toBe(false);
  });

  it("falls back safely when an adapter factory throws", () => {
    const registry = {
      boom: () => {
        throw new Error("secret-detail");
      },
    };
    const provider = resolveCallProvider({ CALL_PROVIDER: "boom" }, registry);
    expect(provider).toBeInstanceOf(NotConfiguredCallProvider);
    expect(JSON.stringify(provider)).not.toContain("secret-detail");
  });
});
