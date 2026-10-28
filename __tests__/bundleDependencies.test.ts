// expo-router 4.0 imports `query-string` (build/fork/getPathFromState.js) without declaring it, so the app must
// keep it as a direct dependency. Removing it broke the Metro bundle (found in the 2026-10-28 audit).
import path from "path";

const mobile = path.join(__dirname, "..", "mobile");

describe("bundle dependencies", () => {
  it("query-string stays a direct mobile dependency", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require(path.join(mobile, "package.json"));
    expect(pkg.dependencies["query-string"]).toBeDefined();
  });
  it("expo-router can resolve query-string", () => {
    const routerDir = path.dirname(require.resolve("expo-router/package.json", { paths: [mobile] }));
    expect(() => require.resolve("query-string", { paths: [routerDir] })).not.toThrow();
  });
});
