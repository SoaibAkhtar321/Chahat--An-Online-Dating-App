// Public Verified badge: only the server's approved list (get_verified_profile_ids, 20260101006100) sets it.
const mockRpc = jest.fn();
jest.mock("../mobile/src/services/supabase", () => ({
  isSupabaseConfigured: () => true,
  supabase: { rpc: (...a: unknown[]) => mockRpc(...a) },
}));
import { fetchVerifiedIds } from "../mobile/src/services/verificationBadges";

beforeEach(() => mockRpc.mockReset());

describe("fetchVerifiedIds", () => {
  it("asks the server once with de-duplicated ids and returns only ids it asked about", async () => {
    mockRpc.mockResolvedValue({ data: ["a", "zzz"], error: null });
    const out = await fetchVerifiedIds(["a", "b", "a", ""]);
    expect(mockRpc).toHaveBeenCalledWith("get_verified_profile_ids", { _ids: ["a", "b"] });
    expect([...out]).toEqual(["a"]);
  });
  it("accepts the SETOF row shape", async () => {
    mockRpc.mockResolvedValue({ data: [{ get_verified_profile_ids: "b" }], error: null });
    expect([...(await fetchVerifiedIds(["b"]))]).toEqual(["b"]);
  });
  it("shows no badges on error and never calls with an empty list", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "x" } });
    expect((await fetchVerifiedIds(["a"])).size).toBe(0);
    mockRpc.mockClear();
    expect((await fetchVerifiedIds([])).size).toBe(0);
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it("caps a lookup at 100 ids (server limit)", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    await fetchVerifiedIds(Array.from({ length: 150 }, (_, i) => `id${i}`));
    expect((mockRpc.mock.calls[0][1] as { _ids: string[] })._ids).toHaveLength(100);
  });
});
