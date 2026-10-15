const mockGetUser = jest.fn();
const mockFrom = jest.fn();
const mockRpc = jest.fn();
const mockGetSignedUrls = jest.fn();

jest.mock("../mobile/src/services/supabase", () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

jest.mock("../mobile/src/services/storage", () => ({
  getSignedUrls: (...args: unknown[]) => mockGetSignedUrls(...args),
  imageFileExtension: jest.fn(),
  sanitizeAndPrepareImageUpload: jest.fn(),
}));

import { fetchMyProfile } from "../mobile/src/services/profile";

describe("authenticated profile retrieval", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "auth@example.test" } },
      error: null,
    });
    mockFrom.mockImplementation((table: string) => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn().mockResolvedValue({
            data:
              table === "profiles"
                ? {
                    id: "user-1",
                    name: "Chahat",
                    gender: "woman",
                    seeking: "man",
                    onboarded: false,
                  }
                : { data: { ageMin: 21 } },
            error: null,
          }),
        })),
      })),
    }));
    mockRpc.mockImplementation((name: string) => {
      if (name === "get_my_dob") return Promise.resolve({ data: "1995-06-15", error: null });
      return Promise.resolve({
        data: [{ id: "photo-1", path: "user-1/photo-1.jpg", thumbPath: "user-1/photo-1.jpg" }],
        error: null,
      });
    });
    mockGetSignedUrls.mockResolvedValue({ "user-1/photo-1.jpg": "signed-photo-url" });
  });

  it("returns authenticated identity and signed owner photo data", async () => {
    const profile = await fetchMyProfile("user-1", "untrusted@example.test");

    expect(profile.id).toBe("user-1");
    expect(profile.email).toBe("auth@example.test");
    expect(profile.photos[0]).toMatchObject({
      path: "user-1/photo-1.jpg",
      thumbPath: "user-1/photo-1.jpg",
      uri: "signed-photo-url",
    });
    expect(mockFrom).toHaveBeenCalledWith("profiles");
    expect(mockFrom).toHaveBeenCalledWith("account_state");
  });

  it("rejects a request for another account before reading profile data", async () => {
    await expect(fetchMyProfile("user-2", "user-2@example.test")).rejects.toThrow(
      "Profile operations are limited to the signed-in account.",
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
