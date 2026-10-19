// Test double for expo-screen-capture 7.0.1 (the SDK 52 release). It reproduces the library's JS key
// bookkeeping exactly (a key is recorded BEFORE the native call; the native "allow" runs only when the last
// key is removed) on top of a fake Android window whose FLAG_SECURE state tests can read and break.
export function createFakeScreenCapture() {
  const state = {
    /** Whether the fake activity window currently has FLAG_SECURE. */
    flagSecure: false,
    /** Keys the library believes are active. */
    tags: new Set<string>(),
    /** Every native call, in order. */
    nativeCalls: [] as string[],
    /** Every value flagSecure took, in order (to prove it never dipped when it should not). */
    flagHistory: [] as boolean[],
    failNext: { prevent: 0, allow: 0 },
    fail(kind: "prevent" | "allow", times = 1) {
      state.failNext[kind] = times;
    },
    reset() {
      state.flagSecure = false;
      state.tags.clear();
      state.nativeCalls.length = 0;
      state.flagHistory.length = 0;
      state.failNext.prevent = 0;
      state.failNext.allow = 0;
    },
  };

  const setFlag = (value: boolean) => {
    state.flagSecure = value;
    state.flagHistory.push(value);
  };

  async function nativePrevent() {
    state.nativeCalls.push("prevent");
    if (state.failNext.prevent > 0) {
      state.failNext.prevent -= 1;
      throw new Error("MissingActivity");
    }
    setFlag(true);
  }

  async function nativeAllow() {
    state.nativeCalls.push("allow");
    if (state.failNext.allow > 0) {
      state.failNext.allow -= 1;
      throw new Error("MissingActivity");
    }
    setFlag(false);
  }

  const module = {
    __esModule: true,
    async preventScreenCaptureAsync(key = "default") {
      if (!state.tags.has(key)) {
        state.tags.add(key);
        await nativePrevent();
      }
    },
    async allowScreenCaptureAsync(key = "default") {
      state.tags.delete(key);
      if (state.tags.size === 0) {
        await nativeAllow();
      }
    },
  };

  return { state, module };
}
