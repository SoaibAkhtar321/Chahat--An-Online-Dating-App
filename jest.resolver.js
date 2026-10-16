// Tests under /__tests__ import app code from /mobile/src. Bare imports from that code would normally
// resolve to mobile/node_modules, while jest-expo's setup and the tests' jest.mock() calls target the
// root node_modules copy. Two copies of react-native/expo = broken mocks ("__fbBatchedBridgeConfig is not set").
// Resolve bare package imports from the root first so there is exactly one copy; fall back to default.
const path = require("path");

module.exports = (request, options) => {
  const isBare = !request.startsWith(".") && !path.isAbsolute(request);
  if (isBare) {
    try {
      return options.defaultResolver(request, { ...options, basedir: __dirname });
    } catch {
      // not installed at root: fall through to normal resolution
    }
  }
  return options.defaultResolver(request, options);
};
