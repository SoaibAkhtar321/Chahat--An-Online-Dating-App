import { readFileSync } from "fs";
import { join } from "path";
import { isSafeChatMediaPath, safeErrorSummary, sanitizeForLog } from "../supabase/functions/_shared/safeLog";

const UID = "11111111-1111-4111-8111-111111111111";
const MATCH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("sanitizeForLog", () => {
  it("redacts UUIDs, e-mail addresses, JWTs and long tokens", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop";
    const out = sanitizeForLog(`user ${UID} mail a.b+c@example.co.uk token ${jwt} key ${"k".repeat(40)}`);
    expect(out).toBe("user <uuid> mail <email> token <jwt> key <token>");
  });

  it("redacts Postgres 'Key (col)=(value)' constraint detail", () => {
    const out = sanitizeForLog('duplicate key value violates unique constraint. Key (device_token)=(ExponentPushToken[abc]) already exists.');
    expect(out).not.toContain("ExponentPushToken");
    expect(out).toContain("(<redacted>)");
  });

  it("collapses whitespace and truncates long text", () => {
    const out = sanitizeForLog(`a\n\n  b ${"x ".repeat(300)}`, 50);
    expect(out.length).toBeLessThanOrEqual(51);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/\n/);
  });

  it("never throws on odd input", () => {
    expect(sanitizeForLog(null)).toBe("");
    expect(sanitizeForLog(undefined)).toBe("");
    expect(sanitizeForLog(42)).toBe("42");
    const hostile = { toString() { throw new Error("nope"); } };
    expect(sanitizeForLog(hostile)).toBe("<unprintable>");
  });
});

describe("safeErrorSummary", () => {
  it("summarises an Error with name and redacted message", () => {
    const e = new TypeError(`bad ${UID}`);
    expect(safeErrorSummary(e)).toBe("TypeError: bad <uuid>");
  });

  it("includes a string or numeric code/status when present", () => {
    expect(safeErrorSummary({ name: "StorageError", code: "404", message: "gone" })).toBe("StorageError [404]: gone");
    expect(safeErrorSummary({ message: "x", status: 503 })).toBe("Error [503]: x");
  });

  it("does not stringify arbitrary objects, only name/code/message", () => {
    const out = safeErrorSummary({ body: { password: "hunter2" }, headers: { authorization: "Bearer abc" } });
    expect(out).toBe("Error: no message");
  });

  it("handles strings, primitives and nullish values", () => {
    expect(safeErrorSummary(`oops ${UID}`)).toBe("oops <uuid>");
    expect(safeErrorSummary(7)).toBe("non-error value (number)");
    expect(safeErrorSummary(null)).toBe("unknown error");
    expect(safeErrorSummary(undefined)).toBe("unknown error");
  });
});

describe("isSafeChatMediaPath (mirror of SQL is_valid_chat_media_path)", () => {
  it("accepts <match id>/<single safe file name>", () => {
    expect(isSafeChatMediaPath(`${MATCH}/abc-123_x.jpg`, MATCH)).toBe(true);
    expect(isSafeChatMediaPath(`${MATCH}/voice_abc.m4a`, MATCH)).toBe(true);
    expect(isSafeChatMediaPath(`${MATCH}/${"a".repeat(200)}`, MATCH)).toBe(true);
  });

  it.each([
    [`${MATCH}/${"a".repeat(201)}`],
    [`${MATCH}/`],
    [`${MATCH}/.x`],
    [`${MATCH}/-x`],
    [`${MATCH}/a b.jpg`],
    [`${MATCH}/a/b.jpg`],
    [`${MATCH}/../x.jpg`],
    [`${MATCH}/a..b`],
    [`/${MATCH}/x.jpg`],
    [`${MATCH}\\x.jpg`],
    [`bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/x.jpg`],
    [`${MATCH}x/y.jpg`],
    [`${MATCH.toUpperCase()}/x.jpg`],
    [null],
    [undefined],
    [123],
    [{}],
  ])("rejects %p", (path) => {
    expect(isSafeChatMediaPath(path, MATCH)).toBe(false);
  });

  it("rejects when the match id is missing or not a string", () => {
    expect(isSafeChatMediaPath(`${MATCH}/x.jpg`, "")).toBe(false);
    expect(isSafeChatMediaPath(`${MATCH}/x.jpg`, null)).toBe(false);
  });
});

describe("Edge Function logging call sites use the redacting helper", () => {
  const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");

  it.each([
    "supabase/functions/delete-account/deletion.ts",
    "supabase/functions/moderate-photo/index.ts",
    "supabase/functions/dispatch-push/index.ts",
  ])("%s logs through safeErrorSummary and never prints a raw error message", (file) => {
    const src = read(file);
    expect(src).toMatch(/safeErrorSummary/);
    expect(src).not.toMatch(/console\.(error|warn)\([^)]*\b(e|error|err)\??\.message/);
    expect(src).not.toMatch(/console\.(error|warn)\([^)]*,\s*(e|error|err)\s*\)/);
  });
});
