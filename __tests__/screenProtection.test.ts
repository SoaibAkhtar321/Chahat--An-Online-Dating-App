const { createFakeScreenCapture } = require("./helpers/fakeScreenCapture");

const mockFake = createFakeScreenCapture();
jest.mock("expo-screen-capture", () => mockFake.module);

const native = mockFake.state;

type Service = typeof import("../mobile/src/services/screenProtection");

let svc: Service;
let appStateHandler: ((state: string) => void) | undefined;
let removeAppStateListener: jest.Mock;
let addAppStateListener: jest.SpyInstance;
let warn: jest.SpyInstance;

/** Fresh module state (holders, retry budget, listeners) for every test. */
function load(platform: string = "android") {
  jest.resetModules();
  const RN = require("react-native");
  RN.Platform.OS = platform;
  removeAppStateListener = jest.fn();
  appStateHandler = undefined;
  addAppStateListener = jest.spyOn(RN.AppState, "addEventListener").mockImplementation(((_t: string, handler: (s: string) => void) => {
    appStateHandler = handler;
    return { remove: removeAppStateListener };
  }) as never);
  svc = require("../mobile/src/services/screenProtection");
}

const flush = () => jest.advanceTimersByTimeAsync(0);

beforeEach(() => {
  jest.useFakeTimers();
  native.reset();
  warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  load();
});

afterEach(() => {
  jest.useRealTimers();
  warn.mockRestore();
  addAppStateListener.mockRestore();
});

describe("screen protection: platform", () => {
  it.each(["ios", "web"])("does nothing on %s", async (platform) => {
    load(platform);
    const release = svc.acquireScreenProtection();
    await flush();
    expect(native.nativeCalls).toEqual([]);
    expect(svc.screenProtectionHolderCount()).toBe(0);
    expect(addAppStateListener).not.toHaveBeenCalled();
    release();
    await flush();
    expect(native.nativeCalls).toEqual([]);
  });

  it("turns FLAG_SECURE on for the first holder and off when it releases (Android)", async () => {
    const release = svc.acquireScreenProtection();
    await flush();
    expect(native.flagSecure).toBe(true);
    release();
    await flush();
    expect(native.flagSecure).toBe(false);
    expect(native.tags.size).toBe(0);
  });
});

describe("screen protection: conflicting holders", () => {
  it("stays on until the last holder releases", async () => {
    const a = svc.acquireScreenProtection();
    const b = svc.acquireScreenProtection();
    await flush();
    expect(native.nativeCalls).toEqual(["prevent"]);

    a();
    await flush();
    expect(native.flagSecure).toBe(true);
    expect(native.nativeCalls).toEqual(["prevent"]);

    b();
    await flush();
    expect(native.flagSecure).toBe(false);
    expect(native.nativeCalls).toEqual(["prevent", "allow"]);
  });

  it("releasing the same holder twice never drops another holder's protection", async () => {
    const a = svc.acquireScreenProtection();
    const b = svc.acquireScreenProtection();
    a();
    a();
    a();
    await flush();
    expect(svc.screenProtectionHolderCount()).toBe(1);
    expect(native.flagSecure).toBe(true);
    b();
    await flush();
    expect(native.flagSecure).toBe(false);
  });

  it("leaving one chat and entering another in the same tick never allows capture", async () => {
    const chatA = svc.acquireScreenProtection();
    await flush();
    native.nativeCalls.length = 0;
    native.flagHistory.length = 0;

    chatA();
    const chatB = svc.acquireScreenProtection();
    await flush();

    expect(native.nativeCalls).toEqual([]);
    expect(native.flagHistory).toEqual([]);
    expect(native.flagSecure).toBe(true);
    chatB();
    await flush();
    expect(native.flagSecure).toBe(false);
  });

  it("a leave followed by an enter ends protected, in order", async () => {
    const chatA = svc.acquireScreenProtection();
    await flush();
    chatA();
    await flush();
    expect(native.flagSecure).toBe(false);
    const chatB = svc.acquireScreenProtection();
    await flush();
    expect(native.flagSecure).toBe(true);
    chatB();
    await flush();
    expect(native.flagSecure).toBe(false);
  });
});

describe("screen protection: native failures", () => {
  it("clears the stale key and retries when enabling fails, so protection really turns on", async () => {
    native.fail("prevent", 1);
    const release = svc.acquireScreenProtection();
    await flush();
    expect(native.flagSecure).toBe(false);
    expect(native.tags.size).toBe(0); // the library's recorded key was cleaned up, not left to block retries

    await jest.advanceTimersByTimeAsync(400);
    expect(native.flagSecure).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    release();
    await flush();
    expect(native.flagSecure).toBe(false);
  });

  it("gives up after the retry budget with one warning, and a later acquire tries again", async () => {
    native.fail("prevent", 3);
    const first = svc.acquireScreenProtection();
    await flush();
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(1500);
    expect(native.flagSecure).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/Screen protection could not be updated/);

    await jest.advanceTimersByTimeAsync(10_000);
    expect(warn).toHaveBeenCalledTimes(1); // no endless retry loop

    const second = svc.acquireScreenProtection(); // failures are exhausted now, so this succeeds
    await flush();
    expect(native.flagSecure).toBe(true);
    first();
    second();
    await flush();
    expect(native.flagSecure).toBe(false);
  });

  it("retries when removing protection fails, and the window ends up unprotected", async () => {
    const release = svc.acquireScreenProtection();
    await flush();
    native.fail("allow", 1);
    release();
    await flush();
    expect(native.flagSecure).toBe(true); // the native clear failed
    await jest.advanceTimersByTimeAsync(400);
    expect(native.flagSecure).toBe(false);
  });

  it("a failed release followed by a new chat still ends protected", async () => {
    const a = svc.acquireScreenProtection();
    await flush();
    native.fail("allow", 1);
    a();
    await flush();
    const b = svc.acquireScreenProtection();
    await jest.advanceTimersByTimeAsync(2000);
    expect(native.flagSecure).toBe(true);
    b();
    await flush();
    expect(native.flagSecure).toBe(false);
  });
});

describe("screen protection: foreground re-apply", () => {
  it("only listens for app state while a holder exists", async () => {
    expect(addAppStateListener).not.toHaveBeenCalled();
    const a = svc.acquireScreenProtection();
    const b = svc.acquireScreenProtection();
    expect(addAppStateListener).toHaveBeenCalledTimes(1);
    a();
    expect(removeAppStateListener).not.toHaveBeenCalled();
    b();
    expect(removeAppStateListener).toHaveBeenCalledTimes(1);
    await flush();
  });

  it("re-applies the flag when the app returns to the foreground, without a gap", async () => {
    const release = svc.acquireScreenProtection();
    await flush();
    native.flagHistory.length = 0;

    appStateHandler!("active");
    await flush();

    expect(native.flagSecure).toBe(true);
    expect(native.flagHistory).not.toContain(false);
    expect(native.tags.size).toBe(1);
    release();
    await flush();
    expect(native.flagSecure).toBe(false);
    expect(native.tags.size).toBe(0);
  });

  it("restores protection on a recreated activity window", async () => {
    const release = svc.acquireScreenProtection();
    await flush();
    native.flagSecure = false; // Android recreated the activity: the new window has no FLAG_SECURE

    appStateHandler!("active");
    await flush();
    expect(native.flagSecure).toBe(true);
    release();
    await flush();
    expect(native.flagSecure).toBe(false);
  });

  it("ignores background transitions and does nothing without holders", async () => {
    const release = svc.acquireScreenProtection();
    await flush();
    native.nativeCalls.length = 0;
    appStateHandler!("background");
    await flush();
    expect(native.nativeCalls).toEqual([]);
    release();
    await flush();
    native.nativeCalls.length = 0;
    appStateHandler?.("active");
    await flush();
    expect(native.nativeCalls).toEqual([]);
  });
});
