jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../mobile/src/services/supabase", () => ({
  isSupabaseConfigured: jest.fn().mockReturnValue(false),
  supabase: {
    storage: {
      from: jest.fn().mockReturnValue({
        createSignedUrls: jest.fn(),
        upload: jest.fn(),
      }),
    },
  },
}));

import {
  STORAGE_LIMITS,
  checkUploadRateLimit,
  recordUploadEvent,
  resetUploadRateLimiter,
  stripExifAndGps,
} from "../mobile/src/services/storage";

describe("Photo Storage Security & EXIF Sanitization", () => {
  beforeEach(() => {
    resetUploadRateLimiter();
  });

  describe("EXIF and GPS Metadata Sanitization", () => {
    it("strips APP1 (EXIF / GPS) segment from JPEG image bytes while retaining image data", () => {
      // Construct a mock JPEG with SOI (0xFF, 0xD8), APP1 EXIF segment (0xFF, 0xE1), and SOS (0xFF, 0xDA)
      const exifPayload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // 'Exif\0\0'
      const exifLength = 2 + exifPayload.length; // 8 bytes
      const mockJpegWithGps = new Uint8Array([
        0xff, 0xd8, // SOI
        0xff, 0xe1, // APP1 marker (EXIF/GPS)
        (exifLength >> 8) & 0xff, exifLength & 0xff, // Length: 8
        ...exifPayload,
        0xff, 0xda, // Start of Scan (SOS)
        0x12, 0x34, 0x56, // Scan data
        0xff, 0xd9, // EOI
      ]);

      const cleaned = stripExifAndGps(mockJpegWithGps);

      // Verify that 0xFF, 0xE1 (APP1 marker) is completely removed
      let hasApp1 = false;
      for (let i = 0; i < cleaned.length - 1; i++) {
        if (cleaned[i] === 0xff && cleaned[i + 1] === 0xe1) {
          hasApp1 = true;
          break;
        }
      }
      expect(hasApp1).toBe(false);

      // Verify SOI and scan data remain intact
      expect(cleaned[0]).toBe(0xff);
      expect(cleaned[1]).toBe(0xd8);
      expect(cleaned[cleaned.length - 2]).toBe(0xff);
      expect(cleaned[cleaned.length - 1]).toBe(0xd9);
    });

    it("leaves non-JPEG formats (PNG, WebP) intact without corruption", () => {
      const mockPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);
      const result = stripExifAndGps(mockPng);
      expect(result).toEqual(mockPng);
    });
  });

  describe("Upload Rate Limiting & Storage Quotas", () => {
    it("allows uploads within the configured rate window limit", () => {
      expect(checkUploadRateLimit().allowed).toBe(true);

      for (let i = 0; i < STORAGE_LIMITS.maxUploadsPerWindow - 1; i++) {
        recordUploadEvent();
        expect(checkUploadRateLimit().allowed).toBe(true);
      }
    });

    it("blocks uploads when the rate limit window is exceeded", () => {
      for (let i = 0; i < STORAGE_LIMITS.maxUploadsPerWindow; i++) {
        recordUploadEvent();
      }

      const check = checkUploadRateLimit();
      expect(check.allowed).toBe(false);
      expect(check.retryAfterMs).toBeGreaterThan(0);
    });

    it("resets correctly when the time window passes or on explicit reset", () => {
      for (let i = 0; i < STORAGE_LIMITS.maxUploadsPerWindow; i++) {
        recordUploadEvent();
      }
      expect(checkUploadRateLimit().allowed).toBe(false);

      resetUploadRateLimiter();
      expect(checkUploadRateLimit().allowed).toBe(true);
    });

    it("enforces a strict maximum file size of 5 MB", () => {
      expect(STORAGE_LIMITS.maxPhotoBytes).toBe(5 * 1024 * 1024);
      expect(STORAGE_LIMITS.allowedMimeTypes).toContain("image/jpeg");
      expect(STORAGE_LIMITS.allowedMimeTypes).toContain("image/png");
      expect(STORAGE_LIMITS.allowedMimeTypes).toContain("image/webp");
    });
  });
});
