import {
  distanceKm,
  isFreshLocation,
  isValidCoordinates,
} from "../mobile/src/services/locationPolicy";

describe("location privacy and discovery policy", () => {
  it("accepts valid coordinates and rejects out-of-range or non-finite values", () => {
    expect(isValidCoordinates({ latitude: 19.076, longitude: 72.8777 })).toBe(true);
    expect(isValidCoordinates({ latitude: 90.1, longitude: 0 })).toBe(false);
    expect(isValidCoordinates({ latitude: 0, longitude: -181 })).toBe(false);
    expect(isValidCoordinates({ latitude: Number.NaN, longitude: 0 })).toBe(false);
  });

  it("computes distance and rejects invalid coordinate input", () => {
    const distance = distanceKm(
      { latitude: 0, longitude: 0 },
      { latitude: 0.1, longitude: 0 },
    );
    expect(distance).toBeGreaterThan(11);
    expect(distance).toBeLessThan(12);
    expect(() => distanceKm({ latitude: 91, longitude: 0 }, { latitude: 0, longitude: 0 })).toThrow(
      "Coordinates must be valid",
    );
  });

  it("accepts only non-future locations fresher than the configured window", () => {
    const now = 1_800_000_000_000;
    expect(isFreshLocation(now - 1000, now)).toBe(true);
    expect(isFreshLocation(now + 1000, now)).toBe(false);
    expect(isFreshLocation(now - 73 * 60 * 60 * 1000, now)).toBe(false);
  });
});
