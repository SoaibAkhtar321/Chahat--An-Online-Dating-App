// Discover distance labels come only from the server's bucketed distance_km + distance_basis. Missing, hidden,
// zero or malformed values must never render (no fabricated "0 km").
const mockRpc = jest.fn();
jest.mock("../mobile/src/services/supabase", () => ({
  supabase: { rpc: (...a: unknown[]) => mockRpc(...a) },
  isSupabaseConfigured: () => true,
}));
jest.mock("../mobile/src/services/storage", () => ({
  getSignedUrls: jest.fn(async () => ({})),
  getSignedUrl: jest.fn(async () => null),
}));
jest.mock("../mobile/src/services/voiceIntro", () => ({ fetchVoiceIntros: jest.fn(async () => ({})) }));
jest.mock("../mobile/src/services/notifications", () => ({ pushNotificationToInbox: jest.fn() }));

import * as fs from "fs";
import * as path from "path";
import { fetchDiscoveryPage } from "../mobile/src/services/discovery";
import { formatDistanceLabel } from "../mobile/src/services/locationPolicy";

const filters = { ageMin: 18, ageMax: 99, distance: 150, intents: [], interests: [], languages: [] } as any;
const row = (id: string, over: Record<string, unknown>) => ({
  id,
  name: id,
  age: 25,
  city: "Kushinagar",
  bio: "",
  work: "",
  education: "",
  interests: [],
  intents: [],
  languages: [],
  lifestyle: {},
  prompt: null,
  photos: [],
  cursor_distance_m: 1_000_000_000,
  ...over,
});

beforeEach(() => {
  mockRpc.mockReset();
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

it("maps the server distance and basis, and shows nothing for missing / hidden / malformed distances", async () => {
  mockRpc.mockResolvedValueOnce({
    data: [
      row("device", { distance_km: 7, distance_basis: "device", cursor_distance_m: 7000 }),
      row("city", { distance_km: 45, distance_basis: "city", cursor_distance_m: 45000 }),
      row("hidden", { distance_km: null, distance_basis: "city" }),
      row("unknown", { distance_km: null, distance_basis: null }),
      row("missing", {}),
      row("string", { distance_km: "12", distance_basis: "device" }),
      row("zero", { distance_km: 0, distance_basis: "city" }),
    ],
    error: null,
  });
  const { profiles } = await fetchDiscoveryPage(filters);
  const labels = Object.fromEntries(profiles.map((p) => [p.id, formatDistanceLabel(p.distanceKm, p.distanceBasis)]));
  expect(labels).toEqual({
    device: "~7 km away",
    city: "About 45 km away (city to city)",
    hidden: null,
    unknown: null,
    missing: null,
    string: null,
    zero: null,
  });
  for (const label of Object.values(labels)) expect(label ?? "").not.toMatch(/\b0 km/);
});

it("the Discover card builds its subtitle from formatDistanceLabel with the server basis", () => {
  const card = fs.readFileSync(path.join(__dirname, "../mobile/src/components/discovery/DiscoveryCard.tsx"), "utf8");
  expect(card).toMatch(/formatDistanceLabel\(profile\.distanceKm, profile\.distanceBasis\)/);
  expect(card).toMatch(/\.filter\(Boolean\)/);
  const profile = fs.readFileSync(path.join(__dirname, "../mobile/app/profile/[id].tsx"), "utf8");
  // get_distance_to is device-to-device only, so the profile screen labels it as such
  expect(profile).toMatch(/formatDistanceLabel\(targetProfile\.distanceKm, "device"\)/);
});
