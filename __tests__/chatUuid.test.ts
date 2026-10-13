import { isValidUUID, generateUUID } from "../mobile/src/utils/validation";

describe("Chat UUID and Identifier Integrity", () => {
  test("generates valid RFC4122 v4 UUIDs for messages", () => {
    const uuid = generateUUID();
    expect(typeof uuid).toBe("string");
    expect(uuid).toHaveLength(36);
    expect(isValidUUID(uuid)).toBe(true);
  });

  test("generates unique UUIDs across multiple invocations", () => {
    const set = new Set<string>();
    for (let i = 0; i < 50; i++) {
      set.add(generateUUID());
    }
    expect(set.size).toBe(50);
  });

  test("validates genuine UUID strings correctly", () => {
    expect(isValidUUID("909d491e-d4a7-449a-a168-ebd63131e94f")).toBe(true);
    expect(isValidUUID("a2813bb3-61fc-449c-a241-e7e1fe0bc894")).toBe(true);
  });

  test("rejects invalid, malformed or non-UUID strings to prevent PostgreSQL type errors", () => {
    expect(isValidUUID("")).toBe(false);
    expect(isValidUUID("not-a-uuid")).toBe(false);
    expect(isValidUUID("msg_123456789_abcdef")).toBe(false);
    expect(isValidUUID("demo_match_ananya")).toBe(false);
    expect(isValidUUID("undefined")).toBe(false);
  });
});
