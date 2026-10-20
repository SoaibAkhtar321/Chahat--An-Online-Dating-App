const mockRpc = jest.fn();
jest.mock("../mobile/src/services/supabase", () => ({
  supabase: { rpc: (...a: unknown[]) => mockRpc(...a) },
  isSupabaseConfigured: () => true,
}));
jest.mock("../mobile/src/services/storage", () => ({
  getSignedUrls: jest.fn(async () => ({})),
  getSignedUrl: jest.fn(async () => null),
}));

jest.mock("../mobile/src/services/notifications", () => ({ pushNotificationToInbox: jest.fn() }));

import { fetchDiscoveryPage } from "../mobile/src/services/discovery";

const filters = { ageMin: 18, ageMax: 99, distance: 500, intents: [], interests: [], languages: [] } as any;
const invalid = { data: null, error: { message: "Invalid discovery filters or cursor" } };

describe("fetchDiscoveryPage radius ceiling", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("steps down when the server ceiling was lowered below the requested radius", async () => {
    mockRpc.mockResolvedValueOnce(invalid).mockResolvedValueOnce(invalid).mockResolvedValueOnce({ data: [], error: null });
    const page = await fetchDiscoveryPage(filters);
    expect(mockRpc.mock.calls.map((c) => c[1]._radius_km)).toEqual([500, 250, 100]);
    expect(page).toEqual({ profiles: [], nextCursor: null });
  });

  it("does not retry on unrelated errors", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await fetchDiscoveryPage(filters);
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it("calls once when the first request succeeds", async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    await fetchDiscoveryPage({ ...filters, distance: 150 });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc.mock.calls[0][1]._radius_km).toBe(150);
  });
});
