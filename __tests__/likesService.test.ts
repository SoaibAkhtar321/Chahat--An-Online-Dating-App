const mockRpc = jest.fn();
jest.mock("../mobile/src/services/supabase", () => ({
  supabase: { rpc: (...a: unknown[]) => mockRpc(...a) },
  isSupabaseConfigured: () => true,
}));
const mockGetSignedUrls = jest.fn();
jest.mock("../mobile/src/services/storage", () => ({
  getSignedUrls: (...a: unknown[]) => mockGetSignedUrls(...a),
}));

import { fetchLikesAccess, fetchReceivedLikes, fetchSentLikes } from "../mobile/src/services/likes";

beforeEach(() => {
  mockRpc.mockReset();
  mockGetSignedUrls.mockReset();
});

describe("likes service", () => {
  it("reads entitlement only from get_my_likes_access", async () => {
    mockRpc.mockResolvedValue({ data: { eligible: true, count: 4 }, error: null });
    expect(await fetchLikesAccess()).toEqual({ eligible: true, count: 4 });
    expect(mockRpc).toHaveBeenCalledWith("get_my_likes_access");
  });
  it("exposes no count for a free member", async () => {
    mockRpc.mockResolvedValue({ data: { eligible: false, count: 9 }, error: null });
    expect(await fetchLikesAccess()).toEqual({ eligible: false, count: null });
  });
  it("returns null (fail closed) on error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "x" } });
    expect(await fetchLikesAccess()).toBeNull();
  });
  it("maps the backend's upgrade_required to upgrade_required, with no profiles", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "42501", message: "upgrade_required" } });
    expect(await fetchReceivedLikes()).toEqual({ status: "upgrade_required" });
    expect(mockGetSignedUrls).not.toHaveBeenCalled();
  });
  it("returns profiles with signed photos for eligible members", async () => {
    mockRpc.mockResolvedValue({
      data: [{ id: "u1", name: "Asha", age: 27, city: "Delhi", photos: [{ path: "p/1.jpg" }], kind: "like", liked_at: "t" }],
      error: null,
    });
    mockGetSignedUrls.mockResolvedValue({ "p/1.jpg": "https://signed/1" });
    const res = await fetchReceivedLikes();
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(res.profiles[0]).toMatchObject({ id: "u1", name: "Asha", photos: ["https://signed/1"] });
    }
  });
  it("reports a generic error for other failures", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "500", message: "internal detail" } });
    const res = await fetchReceivedLikes();
    expect(res.status).toBe("error");
    expect(JSON.stringify(res)).not.toMatch(/internal detail/);
  });
});

describe("sent likes (profiles I liked)", () => {
  it("calls only get_my_sent_likes, with no user id parameter", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    await fetchSentLikes();
    expect(mockRpc).toHaveBeenCalledWith("get_my_sent_likes", { _limit: 50 });
  });
  it("maps upgrade_required to upgrade_required with no profiles and no photo requests", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "42501", message: "upgrade_required" } });
    expect(await fetchSentLikes()).toEqual({ status: "upgrade_required" });
    expect(mockGetSignedUrls).not.toHaveBeenCalled();
  });
  it("returns profiles with signed photos and which of them are matches", async () => {
    mockRpc.mockResolvedValue({
      data: [
        { id: "u1", name: "Asha", age: 27, city: "Delhi", photos: [{ path: "p/1.jpg" }], kind: "like", liked_at: "t", is_match: true },
        { id: "u2", name: "Ravi", age: 30, city: "Pune", photos: [], kind: "priority", liked_at: "t", is_match: false },
        { name: "no id, dropped" },
      ],
      error: null,
    });
    mockGetSignedUrls.mockResolvedValue({ "p/1.jpg": "https://signed/1" });
    const res = await fetchSentLikes();
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(res.profiles.map((p) => p.id)).toEqual(["u1", "u2"]);
      expect(res.profiles[0].photos).toEqual(["https://signed/1"]);
      expect(res.matchedIds).toEqual(["u1"]);
    }
  });
  it("reports a generic error for other failures", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "500", message: "internal detail" } });
    const res = await fetchSentLikes();
    expect(res.status).toBe("error");
    expect(JSON.stringify(res)).not.toMatch(/internal detail/);
  });
});
