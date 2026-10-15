const mockUpload = jest.fn().mockResolvedValue({ error: null });
const mockFrom = jest.fn().mockReturnValue({ upload: mockUpload });
const mockGetUser = jest.fn().mockResolvedValue({
  data: { user: { id: "user-1" } },
  error: null,
});

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../mobile/src/services/supabase", () => ({
  isSupabaseConfigured: jest.fn().mockReturnValue(false),
  supabase: {
    auth: { getUser: (...a: unknown[]) => mockGetUser(...a) },
    storage: { from: (...a: unknown[]) => mockFrom(...a) },
  },
}));

jest.mock("../mobile/src/services/storage", () => ({
  getSignedUrls: jest.fn().mockResolvedValue({}),
  imageFileExtension: jest.fn().mockReturnValue("jpg"),
  sanitizeAndPrepareImageUpload: jest
    .fn()
    .mockResolvedValue({ blob: new Uint8Array([1]), mimeType: "image/jpeg" }),
}));

import { uploadProfilePhoto, uploadVerificationSelfie } from "../mobile/src/services/profile";

describe("profile photo upload hardening", () => {
  beforeEach(() => {
    mockUpload.mockClear();
    mockGetUser.mockClear();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  });

  it("never upserts and never reuses a path for the same photo id", async () => {
    const a = await uploadProfilePhoto("user-1", "p1", "file://x");
    const b = await uploadProfilePhoto("user-1", "p1", "file://x");
    expect(a.path).not.toBe(b.path);
    expect(a.path.startsWith("user-1/p1-")).toBe(true);
    for (const call of mockUpload.mock.calls) {
      expect(call[2].upsert).toBe(false);
    }
  });

  it("stores verification selfies under the private verification/ folder", async () => {
    const path = await uploadVerificationSelfie("user-1", "file://selfie");
    expect(path.startsWith("user-1/verification/")).toBe(true);
    expect(mockUpload.mock.calls[0][2].upsert).toBe(false);
  });

  it("rejects upload requests for a different authenticated account", async () => {
    await expect(uploadProfilePhoto("user-2", "p1", "file://x")).rejects.toThrow(
      "Profile operations are limited to the signed-in account.",
    );
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("propagates upload failure and allows a retry without claiming success", async () => {
    mockUpload.mockRejectedValueOnce(new Error("offline"));
    await expect(uploadProfilePhoto("user-1", "p1", "file://x")).rejects.toThrow("offline");
    const retry = await uploadProfilePhoto("user-1", "p1", "file://x");
    expect(retry.path.startsWith("user-1/p1-")).toBe(true);
    expect(mockUpload).toHaveBeenCalledTimes(2);
  });
});
