import { readFileSync } from "fs";
import path from "path";

const source = readFileSync(
  path.join(__dirname, "..", "supabase", "functions", "dispatch-push", "index.ts"),
  "utf8",
);

describe("dispatch-push when not configured", () => {
  it("answers 503 with a stable code instead of a generic 500", () => {
    expect(source).toMatch(/json\(503,[^)]*push_not_configured/);
  });

  it("checks configuration before the secret and still rejects a wrong secret with 401", () => {
    const configIdx = source.indexOf("push_not_configured");
    const authIdx = source.indexOf("constantTimeEqual(suppliedSecret");
    expect(configIdx).toBeGreaterThan(-1);
    expect(authIdx).toBeGreaterThan(configIdx);
    expect(source).toMatch(/json\(401,\s*\{ error: "Unauthorized" \}\)/);
  });

  it("never deactivates a device for a provider credential error", () => {
    expect(source).toMatch(/code === "DeviceNotRegistered"\) await deactivateDevice/);
    expect(source).not.toMatch(/InvalidCredentials[^\n]*deactivateDevice/);
  });
});
