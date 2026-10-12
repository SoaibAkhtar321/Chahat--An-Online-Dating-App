const mockUpload = jest.fn().mockResolvedValue({ error: null });
const mockFrom = jest.fn().mockReturnValue({ upload: mockUpload });

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../mobile/src/services/supabase", () => ({
  isSupabaseConfigured: jest.fn().mockReturnValue(false),
  supabase: { storage: { from: (...a: unknown[]) => mockFrom(...a) } },
}));

jest.mock("../mobile/src/services/storage", () => ({
  getSignedUrls: jest.fn().mockResolvedValue({}),
  sanitizeAndPrepareImageUpload: jest
    .fn()
    .mockResolvedValue({ blob: new Uint8Array([1]), mimeType: "image/jpeg" }),
}));

import { uploadProfilePhoto, uploadVerificationSelfie } from "../mobile/src/services/profile";

describe("photo mockUpload hardening", () => {
  beforeEach(() => mockUpload.mockClear());

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
});
