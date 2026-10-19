process.env.NODE_ENV = "test";

// supabase-js (realtime) needs a WebSocket global; Node < 22 has none. Tests never open sockets.
if (typeof globalThis.WebSocket === "undefined") {
  globalThis.WebSocket = class WebSocket {};
}

// React Native's jest/setup.js defines rAF using jest.now() inside setTimeout, which throws a ReferenceError
// if any Animated.timing callback fires after test teardown.
globalThis.requestAnimationFrame = (callback) => {
  return globalThis.setTimeout(() => {
    try {
      callback(Date.now());
    } catch {
      // Ignore callbacks executed after test environment teardown
    }
  }, 0);
};
globalThis.cancelAnimationFrame = (id) => globalThis.clearTimeout(id);

