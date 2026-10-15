export interface Coordinates {
  latitude: number;
  longitude: number;
}

export function isValidCoordinates(value: Coordinates): boolean {
  return (
    Number.isFinite(value.latitude) &&
    Number.isFinite(value.longitude) &&
    value.latitude >= -90 &&
    value.latitude <= 90 &&
    value.longitude >= -180 &&
    value.longitude <= 180
  );
}

export function distanceKm(from: Coordinates, to: Coordinates): number {
  if (!isValidCoordinates(from) || !isValidCoordinates(to)) {
    throw new Error("Coordinates must be valid latitude and longitude values.");
  }
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(from.latitude)) *
      Math.cos(radians(to.latitude)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isFreshLocation(timestamp: number, now = Date.now()): boolean {
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= 72 * 60 * 60 * 1000;
}
