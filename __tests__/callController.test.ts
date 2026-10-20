import { CallController, type CallControllerDeps } from "../mobile/src/services/callController";
import {
  CallError,
  notConfiguredMediaProvider,
  type CallJoinGrant,
  type CallMediaProvider,
  type CallMediaSession,
} from "../mobile/src/services/callMedia";

const grant: CallJoinGrant = {
  provider: "fake",
  roomId: "room-1",
  token: "t",
  expiresAt: "2026-10-16T12:02:00Z",
  callType: "video",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeSession() {
  let endedListener: (() => void) | null = null;
  const unsubscribe = jest.fn(() => {
    endedListener = null;
  });
  const session = {
    setMicrophoneEnabled: jest.fn(async () => undefined),
    setCameraEnabled: jest.fn(async () => undefined),
    leave: jest.fn(async () => undefined),
    onEnded: jest.fn((listener: () => void) => {
      endedListener = listener;
      return unsubscribe;
    }),
  };
  return { session: session as CallMediaSession & typeof session, unsubscribe, fireEnded: () => endedListener?.() };
}

function setup(overrides: Partial<CallControllerDeps> = {}, providerOverrides: Partial<CallMediaProvider> = {}) {
  const made = makeSession();
  const provider = {
    name: "fake",
    configured: true,
    requestPermissions: jest.fn(async () => true),
    join: jest.fn(async () => made.session as CallMediaSession),
    ...providerOverrides,
  } as CallMediaProvider & { requestPermissions: jest.Mock; join: jest.Mock };
  const requestToken = jest.fn(async () => grant);
  const controller = new CallController({ provider, requestToken, isEnabled: () => true, ...overrides });
  return { controller, provider, requestToken, ...made };
}

describe("CallController join", () => {
  it("fails clearly, without any network call, when no provider is configured", async () => {
    const requestToken = jest.fn();
    const controller = new CallController({
      provider: notConfiguredMediaProvider,
      requestToken,
      isEnabled: () => true,
    });
    await controller.join("call-1", "video");
    expect(controller.getState()).toMatchObject({ phase: "failed", error: { code: "provider_not_configured" } });
    expect(requestToken).not.toHaveBeenCalled();
  });

  it("fails when the calling flag is off", async () => {
    const { controller, requestToken } = setup({ isEnabled: () => false });
    await controller.join("call-1", "video");
    expect(controller.getState().error?.code).toBe("calling_disabled");
    expect(requestToken).not.toHaveBeenCalled();
  });

  it("stops before requesting a token when permission is denied", async () => {
    const { controller, requestToken, provider } = setup({}, { requestPermissions: jest.fn(async () => false) });
    await controller.join("call-1", "video");
    expect(controller.getState()).toMatchObject({ phase: "failed", error: { code: "permission_denied" } });
    expect(requestToken).not.toHaveBeenCalled();
    expect(provider.join).not.toHaveBeenCalled();
  });

  it.each(["rate_limited", "unauthenticated", "network", "call_unavailable"] as const)(
    "surfaces a %s token error and never joins",
    async (code) => {
      const { controller, provider } = setup({
        requestToken: jest.fn(async () => {
          throw new CallError(code);
        }),
      });
      await controller.join("call-1", "video");
      expect(controller.getState()).toMatchObject({ phase: "failed", error: { code } });
      expect(provider.join).not.toHaveBeenCalled();
    },
  );

  it("wraps unexpected provider errors without leaking details", async () => {
    const { controller } = setup({}, {
      join: jest.fn(async () => {
        throw new Error("SECRET internal sdk detail");
      }),
    });
    await controller.join("call-1", "video");
    expect(controller.getState().error?.code).toBe("provider_error");
    expect(controller.getState().error?.message).not.toContain("SECRET");
  });

  it("joins a video call with microphone and camera on", async () => {
    const { controller, provider, requestToken, session } = setup();
    await controller.join("call-1", "video");
    expect(requestToken).toHaveBeenCalledWith("call-1");
    expect(provider.join).toHaveBeenCalledWith(grant, { callType: "video" });
    expect(session.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    expect(session.setCameraEnabled).toHaveBeenCalledWith(true);
    expect(controller.getState()).toMatchObject({
      phase: "connected",
      callId: "call-1",
      microphoneEnabled: true,
      cameraEnabled: true,
      error: null,
    });
  });

  it("ignores duplicate join requests while joining and after connecting", async () => {
    const gate = deferred<CallJoinGrant>();
    const requestToken = jest.fn(() => gate.promise);
    const { controller, provider } = setup({ requestToken });
    const first = controller.join("call-1", "video");
    const second = controller.join("call-1", "video");
    expect(second).toBe(first);
    gate.resolve(grant);
    await first;
    await controller.join("call-1", "video");
    expect(requestToken).toHaveBeenCalledTimes(1);
    expect(provider.join).toHaveBeenCalledTimes(1);
  });

  it("allows retrying after a failure", async () => {
    const requestToken = jest
      .fn()
      .mockRejectedValueOnce(new CallError("network"))
      .mockResolvedValueOnce(grant);
    const { controller } = setup({ requestToken });
    await controller.join("call-1", "video");
    expect(controller.getState().phase).toBe("failed");
    await controller.join("call-1", "video");
    expect(controller.getState()).toMatchObject({ phase: "connected", error: null });
  });
});

describe("CallController mute, camera and hang up", () => {
  it("toggles microphone and camera and reflects state", async () => {
    const { controller, session } = setup();
    await controller.join("call-1", "video");
    await expect(controller.setMicrophoneEnabled(false)).resolves.toBe(true);
    expect(controller.getState().microphoneEnabled).toBe(false);
    await expect(controller.setMicrophoneEnabled(true)).resolves.toBe(true);
    await expect(controller.setCameraEnabled(false)).resolves.toBe(true);
    expect(controller.getState()).toMatchObject({ microphoneEnabled: true, cameraEnabled: false });
    expect(session.setMicrophoneEnabled).toHaveBeenLastCalledWith(true);
    expect(session.setCameraEnabled).toHaveBeenLastCalledWith(false);
  });

  it("keeps the previous state and reports an error when a toggle fails", async () => {
    const { controller, session } = setup();
    await controller.join("call-1", "video");
    session.setMicrophoneEnabled.mockRejectedValueOnce(new Error("sdk"));
    await expect(controller.setMicrophoneEnabled(false)).resolves.toBe(false);
    expect(controller.getState()).toMatchObject({ phase: "connected", microphoneEnabled: true });
    expect(controller.getState().error?.code).toBe("provider_error");
  });

  it("rejects controls before connecting and after hanging up", async () => {
    const { controller, session } = setup();
    await expect(controller.setMicrophoneEnabled(false)).resolves.toBe(false);
    await controller.join("call-1", "video");
    await controller.hangUp();
    await expect(controller.setMicrophoneEnabled(false)).resolves.toBe(false);
    await expect(controller.setCameraEnabled(false)).resolves.toBe(false);
    expect(session.setMicrophoneEnabled).toHaveBeenCalledTimes(1);
  });

  it("hangs up once, releases the session and listeners, and survives duplicate taps", async () => {
    const { controller, session, unsubscribe } = setup();
    await controller.join("call-1", "video");
    await Promise.all([controller.hangUp(), controller.hangUp()]);
    await controller.hangUp();
    expect(session.leave).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(controller.getState().phase).toBe("ended");
    await controller.join("call-1", "video"); // cannot rejoin an ended controller
    expect(controller.getState().phase).toBe("ended");
  });

  it("does not throw when leaving the provider fails", async () => {
    const { controller, session } = setup();
    await controller.join("call-1", "video");
    session.leave.mockRejectedValueOnce(new Error("sdk"));
    await expect(controller.hangUp()).resolves.toBeUndefined();
    expect(controller.getState().phase).toBe("ended");
  });

  it("leaves a late session when the user hangs up while joining", async () => {
    const gate = deferred<CallMediaSession>();
    const { controller, session } = setup({}, { join: jest.fn(() => gate.promise) });
    const joining = controller.join("call-1", "video");
    await Promise.resolve();
    await Promise.resolve();
    await controller.hangUp();
    gate.resolve(session);
    await joining;
    expect(session.leave).toHaveBeenCalledTimes(1);
    expect(session.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(controller.getState().phase).toBe("ended");
  });

  it("hanging up before joining just ends the controller", async () => {
    const { controller, requestToken } = setup();
    await controller.hangUp();
    expect(controller.getState().phase).toBe("ended");
    await controller.join("call-1", "video");
    expect(requestToken).not.toHaveBeenCalled();
  });

  it("moves to ended and cleans up when the provider reports the session ended", async () => {
    const { controller, session, fireEnded } = setup();
    await controller.join("call-1", "video");
    fireEnded();
    expect(controller.getState().phase).toBe("ended");
    expect(session.leave).toHaveBeenCalledTimes(1);
    await controller.hangUp();
    expect(session.leave).toHaveBeenCalledTimes(1);
  });
});

describe("CallController cleanup", () => {
  it("notifies subscribers until unsubscribed or disposed", async () => {
    const { controller } = setup();
    const listener = jest.fn();
    const unsubscribe = controller.subscribe(listener);
    await controller.join("call-1", "video");
    const calls = listener.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    unsubscribe();
    await controller.setMicrophoneEnabled(false);
    expect(listener.mock.calls.length).toBe(calls);
  });

  it("dispose leaves the session, clears listeners and ignores later actions", async () => {
    const { controller, session, unsubscribe } = setup();
    const listener = jest.fn();
    controller.subscribe(listener);
    await controller.join("call-1", "video");
    listener.mockClear();
    await controller.dispose();
    await controller.dispose();
    expect(session.leave).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    await controller.join("call-2", "video");
    await controller.hangUp();
    expect(listener).not.toHaveBeenCalled();
  });

  it("dispose during joining releases the late session and never connects", async () => {
    const gate = deferred<CallMediaSession>();
    const { controller, session } = setup({}, { join: jest.fn(() => gate.promise) });
    const joining = controller.join("call-1", "video");
    await Promise.resolve();
    await Promise.resolve();
    await controller.dispose();
    gate.resolve(session);
    await joining;
    expect(session.leave).toHaveBeenCalledTimes(1);
    expect(controller.getState().phase).not.toBe("connected");
  });
});
