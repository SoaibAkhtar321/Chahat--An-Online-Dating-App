import React from "react";
import { Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

const { createFakeScreenCapture } = require("./helpers/fakeScreenCapture");

const mockFake = createFakeScreenCapture();
jest.mock("expo-screen-capture", () => mockFake.module);
// Use the real react-navigation focus semantics (focus, blur, cleanup on unmount) rather than a stub.
jest.mock("expo-router", () => ({
  useFocusEffect: (effect: () => void) => require("@react-navigation/core").useFocusEffect(effect),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { NavigationContext } = require("@react-navigation/core");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Platform } = require("react-native");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useScreenProtection } = require("../mobile/src/hooks/useScreenProtection");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { screenProtectionHolderCount } = require("../mobile/src/services/screenProtection");

const native = mockFake.state;

/** Just enough of a navigation object for useFocusEffect: isFocused(), focus/blur events. */
function createNav(initiallyFocused = true) {
  let focused = initiallyFocused;
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
type Nav = ReturnType<typeof createNav>;

function Screen({ nav, enabled = true, explode = false }: { nav: Nav; enabled?: boolean; explode?: boolean }) {
  return (
    <NavigationContext.Provider value={nav}>
      <Inner enabled={enabled} explode={explode} />
    </NavigationContext.Provider>
  );
}

function Inner({ enabled, explode }: { enabled: boolean; explode: boolean }) {
  useScreenProtection(enabled);
  if (explode) throw new Error("render failed");
  return <Text>chat</Text>;
}

class Boundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <Text>error screen</Text> : this.props.children;
  }
}

const flush = () => act(async () => { await jest.advanceTimersByTimeAsync(0); });

const mounted: TestRenderer.ReactTestRenderer[] = [];
async function mount(element: React.ReactElement) {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    r = TestRenderer.create(element);
  });
  mounted.push(r);
  await flush();
  return r;
}

let consoleError: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  Platform.OS = "android";
  native.reset();
  consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach((r) => r.unmount());
  });
  await flush();
  // Whatever a test did, nothing may stay protected once every screen is gone.
  expect(screenProtectionHolderCount()).toBe(0);
  expect(native.flagSecure).toBe(false);
  consoleError.mockRestore();
  jest.useRealTimers();
});

describe("screen protection lifecycle (useScreenProtection)", () => {
  it("protects while the screen is mounted and focused, and releases on unmount", async () => {
    const nav = createNav();
    const r = await mount(<Screen nav={nav} />);
    expect(native.flagSecure).toBe(true);

    await act(async () => r.unmount());
    mounted.pop();
    await flush();
    expect(native.flagSecure).toBe(false);
  });

  it("releases when another screen covers the chat (blur) and protects again on return (focus)", async () => {
    const nav = createNav();
    await mount(<Screen nav={nav} />);
    expect(native.flagSecure).toBe(true);

    await act(async () => nav.blur());
    await flush();
    expect(native.flagSecure).toBe(false);

    await act(async () => nav.focus());
    await flush();
    expect(native.flagSecure).toBe(true);
  });

  it("does not protect a screen that is mounted but not focused", async () => {
    const nav = createNav(false);
    await mount(<Screen nav={nav} />);
    expect(native.flagSecure).toBe(false);
    await act(async () => nav.focus());
    await flush();
    expect(native.flagSecure).toBe(true);
  });

  it("releases when a render error tears the screen down", async () => {
    const nav = createNav();
    const r = await mount(
      <Boundary>
        <Screen nav={nav} />
      </Boundary>,
    );
    expect(native.flagSecure).toBe(true);

    await act(async () => {
      r.update(
        <Boundary>
          <Screen nav={nav} explode />
        </Boundary>,
      );
    });
    await flush();
    expect(JSON.stringify(r.toJSON())).toContain("error screen");
    expect(native.flagSecure).toBe(false);
  });

  it("switching to another chat in one navigation step never allows capture in between", async () => {
    const navA = createNav();
    const navB = createNav(false);
    await mount(<Screen nav={navA} />);
    await mount(<Screen nav={navB} />);
    expect(native.flagSecure).toBe(true);
    native.nativeCalls.length = 0;

    // react-navigation may deliver the old screen's blur before the new screen's focus.
    await act(async () => {
      navA.blur();
      navB.focus();
    });
    await flush();
    expect(native.nativeCalls).toEqual([]);
    expect(native.flagSecure).toBe(true);

    await act(async () => navB.blur());
    await flush();
    expect(native.flagSecure).toBe(false);
  });

  it("one screen leaving never switches off protection for another that is still showing", async () => {
    const navA = createNav();
    const navB = createNav();
    const a = await mount(<Screen nav={navA} />);
    await mount(<Screen nav={navB} />);

    await act(async () => a.unmount());
    mounted.splice(mounted.indexOf(a), 1);
    await flush();
    expect(native.flagSecure).toBe(true);

    await act(async () => navB.blur());
    await flush();
    expect(native.flagSecure).toBe(false);
  });

  it("`enabled = false` never protects, and turning it off later releases", async () => {
    const nav = createNav();
    const r = await mount(<Screen nav={nav} enabled={false} />);
    expect(native.flagSecure).toBe(false);

    await act(async () => r.update(<Screen nav={nav} enabled />));
    await flush();
    expect(native.flagSecure).toBe(true);

    await act(async () => r.update(<Screen nav={nav} enabled={false} />));
    await flush();
    expect(native.flagSecure).toBe(false);
  });

  it("is a no-op on iOS", async () => {
    Platform.OS = "ios";
    await mount(<Screen nav={createNav()} />);
    expect(native.nativeCalls).toEqual([]);
    expect(native.flagSecure).toBe(false);
  });
});
