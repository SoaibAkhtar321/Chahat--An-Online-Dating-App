const mockGetUser = jest.fn();
const mockUpdate = jest.fn();
const mockEq = jest.fn();
const mockSelect = jest.fn();
const mockFrom = jest.fn();

jest.mock("../mobile/src/services/supabase", () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

jest.mock("../mobile/src/services/storage", () => ({
  getSignedUrls: jest.fn().mockResolvedValue({}),
  sanitizeAndPrepareImageUpload: jest.fn(),
}));

import { saveProfile } from "../mobile/src/services/profile";

describe("authenticated profile service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mockFrom.mockReturnValue({ update: mockUpdate });
    mockUpdate.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ select: mockSelect });
    mockSelect.mockResolvedValue({ data: [{ id: "user-1" }], error: null });
  });

  it("updates only the signed-in user's allowed profile fields", async () => {
    const result = await saveProfile(
      {
        name: " Chahat ",
        id: "user-2",
        email: "other@example.test",
        onboarded: false,
      } as Partial<import("../mobile/src/types").MeProfile>,
      "user-1",
    );

    expect(result.success).toBe(true);
    expect(mockEq).toHaveBeenCalledWith("id", "user-1");
    expect(mockUpdate).toHaveBeenCalledWith({ name: "Chahat", onboarded: false });
  });

  it("rejects cross-account writes before querying profile data", async () => {
    await expect(saveProfile({ name: "Chahat" }, "user-2")).resolves.toMatchObject({
      success: false,
      error: "Profile operations are limited to the signed-in account.",
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("does not send incomplete onboarding state to the backend", async () => {
    await expect(saveProfile({ onboarded: true }, "user-1")).resolves.toMatchObject({
      success: false,
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
