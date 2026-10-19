import { secureKey } from "../mobile/src/services/secureKey";

describe("secureKey", () => {
  it("only emits characters SecureStore accepts", () => {
    expect(secureKey("milo_expo_push_token:abc-123")).toBe("milo_expo_push_token_abc-123");
    expect(secureKey("a@b.com/x y")).toBe("a_b.com_x_y");
    expect(/^[A-Za-z0-9._-]+$/.test(secureKey("::"))).toBe(true);
  });
  it("never returns an empty key", () => {
    expect(secureKey("")).toBe("_");
  });
});
