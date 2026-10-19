const rpc = jest.fn();
jest.mock("../mobile/src/services/supabase", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a) },
  isSupabaseConfigured: () => true,
}));
const getSignedUrls = jest.fn();
jest.mock("../mobile/src/services/storage", () => ({
  getSignedUrls: (...a: unknown[]) => getSignedUrls(...a),
}));

import { fetchLikesAccess, fetchReceivedLikes } from "../mobile/src/services/likes";

beforeEach(() => {
  rpc.mockReset();
  getSignedUrls.mockReset();
});

describe("likes service", () => {
  it("reads entitlement only from get_my_likes_access", async () => {
    rpc.mockResolvedValue({ data: { eligible: true, count: 4 }, error: null });
    expect(await fetchLikesAccess()).toEqual({ eligible: true, count: 4 });
    expect(rpc).toHaveBeenCalledWith("get_my_likes_access");
  });
  it("exposes no count for a free member", async () => {
    rpc.mockResolvedValue({ data: { eligible: false, count: 9 }, error: null });
    expect(await fetchLikesAccess()).toEqual({ eligible: false, count: null });
  });
  it("returns null (fail closed) on error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "x" } });
    expect(await fetchLikesAccess()).toBeNull();
  });
  it("maps the backend's upgrade_required to upgrade_required, with no profiles", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "upgrade_required" } });
    expect(await fetchReceivedLikes()).toEqual({ status: "upgrade_required" });
    expect(getSignedUrls).not.toHaveBeenCalled();
  });
  it("returns profiles with signed photos for eligible members", async () => {
    rpc.mockResolvedValue({
      data: [{ id: "u1", name: "Asha", age: 27, city: "Delhi", photos: [{ path: "p/1.jpg" }], kind: "like", liked_at: "t" }],
      error: null,
    });
    getSignedUrls.mockResolvedValue({ "p/1.jpg": "https://signed/1" });
    const res = await fetchReceivedLikes();
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(res.profiles[0]).toMatchObject({ id: "u1", name: "Asha", photos: ["https://signed/1"] });
    }
  });
  it("reports a generic error for other failures", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "500", message: "internal detail" } });
    const res = await fetchReceivedLikes();
    expect(res.status).toBe("error");
    expect(JSON.stringify(res)).not.toMatch(/internal detail/);
  });
});
