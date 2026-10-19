import {
  isUpgradeRequiredError,
  parseLikesAccess,
  parseReceivedLikes,
  resolveLikeTapRoute,
} from "../mobile/src/services/likesPolicy";

describe("parseLikesAccess (fail closed)", () => {
  it("accepts only a well-formed server response", () => {
    expect(parseLikesAccess({ eligible: true, count: 3 })).toEqual({ eligible: true, count: 3 });
  });
  it("never surfaces a count for a non-eligible member, even if one is sent", () => {
    expect(parseLikesAccess({ eligible: false })).toEqual({ eligible: false, count: null });
    expect(parseLikesAccess({ eligible: false, count: 7 })).toEqual({ eligible: false, count: null });
  });
  it("requires a valid count for eligible members", () => {
    expect(parseLikesAccess({ eligible: true })).toBeNull();
  });
  it.each([
    null,
    undefined,
    "premium",
    {},
    { eligible: "true", count: 1 },
    { eligible: true },
    { eligible: true, count: -1 },
    { eligible: true, count: NaN },
  ])("rejects malformed input %p", (input) => {
    expect(parseLikesAccess(input)).toBeNull();
  });
});

describe("isUpgradeRequiredError", () => {
  it("recognises the backend's not-entitled signal", () => {
    expect(isUpgradeRequiredError({ code: "42501", message: "x" })).toBe(true);
    expect(isUpgradeRequiredError({ message: "upgrade_required" })).toBe(true);
    expect(isUpgradeRequiredError({ code: "500", message: "boom" })).toBe(false);
    expect(isUpgradeRequiredError(null)).toBe(false);
  });
});

describe("resolveLikeTapRoute (paywall vs likes list)", () => {
  it("sends eligible members to the likes list", async () => {
    const route = await resolveLikeTapRoute(async () => ({
      data: { eligible: true, count: 2 },
      error: null,
    }));
    expect(route).toEqual({ kind: "likes" });
  });
  it("sends non-eligible members to the existing Premium paywall", async () => {
    const route = await resolveLikeTapRoute(async () => ({
      data: { eligible: false },
      error: null,
    }));
    expect(route).toEqual({ kind: "premium" });
  });
  it("never opens the list when the check errors, is malformed or throws", async () => {
    expect((await resolveLikeTapRoute(async () => ({ data: null, error: { message: "net" } }))).kind).toBe("error");
    expect((await resolveLikeTapRoute(async () => ({ data: { eligible: "yes" }, error: null }))).kind).toBe("error");
    expect(
      (
        await resolveLikeTapRoute(async () => {
          throw new Error("offline");
        })
      ).kind,
    ).toBe("error");
  });
  it("asks the server on every tap (no cached entitlement)", async () => {
    const fetchAccess = jest
      .fn()
      .mockResolvedValueOnce({ data: { eligible: true, count: 1 }, error: null })
      .mockResolvedValueOnce({ data: { eligible: false, count: 1 }, error: null });
    expect((await resolveLikeTapRoute(fetchAccess)).kind).toBe("likes");
    expect((await resolveLikeTapRoute(fetchAccess)).kind).toBe("premium");
    expect(fetchAccess).toHaveBeenCalledTimes(2);
  });
});

describe("parseReceivedLikes", () => {
  it("maps rows and drops malformed ones", () => {
    const out = parseReceivedLikes([
      { id: "u1", name: "Asha", age: 27, city: "Delhi", photos: [{ path: "a/1.jpg" }], kind: "priority", liked_at: "2026-01-01T00:00:00Z" },
      { id: "", name: "bad" },
      null,
      { id: "u2", photos: "nope" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: "u1", photoPaths: ["a/1.jpg"], isPriority: true });
    expect(out[1]).toMatchObject({ id: "u2", name: "Chahat Member", photoPaths: [] });
  });
  it("returns an empty list for non-arrays", () => {
    expect(parseReceivedLikes(null)).toEqual([]);
  });
});
