// supabase-js (realtime) needs a WebSocket global; Node < 22 has none. Tests never open sockets.
if (typeof globalThis.WebSocket === "undefined") {
  globalThis.WebSocket = class WebSocket {};
}
