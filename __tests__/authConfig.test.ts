import * as fs from "fs";
import * as path from "path";
import { validatePassword } from "../mobile/src/utils/validation";

// supabase/config.toml documents the auth settings the app relies on. These checks keep it in step with
// the app's own password rules and confirmation handling. They read the file only; they never touch the
// hosted project.
const toml = fs.readFileSync(path.join(__dirname, "..", "supabase", "config.toml"), "utf8");

function value(key: string): string | undefined {
  const m = toml.match(new RegExp(`^${key}\\s*=\\s*(.+?)\\s*$`, "m"));
  return m?.[1];
}

describe("supabase/config.toml auth block", () => {
  it("declares an [auth] section", () => {
    expect(toml).toMatch(/^\[auth\]\s*$/m);
  });

  it("minimum_password_length matches the app's validatePassword boundary", () => {
    const min = Number(value("minimum_password_length"));
    expect(Number.isInteger(min)).toBe(true);
    expect(validatePassword("a".repeat(min - 2) + "1").valid).toBe(false); // one character short
    expect(validatePassword("a".repeat(min - 1) + "1").valid).toBe(true); // exactly the minimum
  });

  it("requires letters and digits, like validatePassword", () => {
    expect(value("password_requirements")).toBe('"letters_digits"');
    expect(validatePassword("abcdefgh").valid).toBe(false);
    expect(validatePassword("12345678").valid).toBe(false);
  });

  it("keeps e-mail confirmation on and anonymous sign-ins off", () => {
    expect(value("enable_confirmations")).toBe("true");
    expect(value("enable_anonymous_sign_ins")).toBe("false");
  });

  it("allows the Expo deep-link scheme as a redirect", () => {
    const app = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "mobile", "app.json"), "utf8"),
    );
    const scheme = app.expo?.scheme ?? app.scheme;
    expect(scheme).toBeTruthy();
    expect(toml).toContain(`"${scheme}://"`);
    expect(toml).toContain(`"${scheme}://callback"`);
  });
});
