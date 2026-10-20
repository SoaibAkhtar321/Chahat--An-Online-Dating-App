import fs from "fs";
import path from "path";
import {
  validateProfileDraft,
  calculateProfileCompleteness,
} from "../mobile/src/services/profilePolicy";
import type { MeProfile } from "../mobile/src/types";

const root = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

describe("Streamlined Onboarding & Profile Completion Policy", () => {
  const minimalEssentialProfile: Partial<MeProfile> = {
    name: "Aarav",
    dob: "2000-01-15",
    gender: "man",
    seeking: "woman",
    city: "Mumbai",
    photos: [
      {
        id: "p1",
        uri: "signed-url-1",
        path: "user-123/photo-1.jpg",
        thumbPath: "user-123/photo-1.jpg",
        status: "pending",
      },
    ],
    onboarded: true,
  };

  test("accepts a streamlined onboarding profile with only essential fields", () => {
    const result = validateProfileDraft(minimalEssentialProfile, "user-123");
    expect(result).toEqual({ valid: true });
  });

  test("rejects onboarding completion if any essential field is missing", () => {
    // Missing name
    expect(
      validateProfileDraft({ ...minimalEssentialProfile, name: "" }, "user-123"),
    ).toMatchObject({ valid: false, error: expect.stringMatching(/name/i) });

    // Missing DOB
    expect(
      validateProfileDraft({ ...minimalEssentialProfile, dob: "" }, "user-123"),
    ).toMatchObject({ valid: false, error: expect.stringMatching(/birth date/i) });

    // Underage DOB (< 18)
    expect(
      validateProfileDraft({ ...minimalEssentialProfile, dob: "2015-01-01" }, "user-123"),
    ).toMatchObject({ valid: false, error: expect.stringMatching(/18/i) });

    // Missing gender
    expect(
      validateProfileDraft({ ...minimalEssentialProfile, gender: "" as any }, "user-123"),
    ).toMatchObject({ valid: false, error: expect.stringMatching(/gender/i) });

    // Missing city
    expect(
      validateProfileDraft({ ...minimalEssentialProfile, city: "" }, "user-123"),
    ).toMatchObject({ valid: false, error: expect.stringMatching(/city/i) });

    // Missing photo (0 photos)
    expect(
      validateProfileDraft({ ...minimalEssentialProfile, photos: [] }, "user-123"),
    ).toMatchObject({ valid: false, error: expect.stringMatching(/photo/i) });
  });

  test("accepts optional fields completed later in Complete Profile", () => {
    const fullyCompletedProfile: Partial<MeProfile> = {
      ...minimalEssentialProfile,
      bio: "Tech entrepreneur and coffee lover exploring Mumbai cafes.",
      prompt: { q: "My ideal Sunday", a: "Reading books at Marine Drive followed by street food." },
      intents: ["Long-term relationship"],
      interests: ["Coffee", "Books", "Travel", "Tech"],
      work: "Software Engineer",
      education: "IIT Bombay",
      languages: ["English", "Hindi", "Marathi"],
      lifestyle: { exercise: "Frequently", drink: "Socially", pets: "Dog" },
    };

    const result = validateProfileDraft(fullyCompletedProfile, "user-123");
    expect(result).toEqual({ valid: true });
  });

  test("strictly validates bounds on optional fields if provided", () => {
    // Bio exceeding 500 characters
    expect(
      validateProfileDraft(
        { ...minimalEssentialProfile, bio: "a".repeat(501) },
        "user-123",
      ),
    ).toMatchObject({ valid: false, error: expect.stringMatching(/bio/i) });

    // Interests exceeding 15 items
    const tooManyInterests = Array.from({ length: 16 }, (_, i) => `Interest ${i}`);
    expect(
      validateProfileDraft(
        { ...minimalEssentialProfile, interests: tooManyInterests },
        "user-123",
      ),
    ).toMatchObject({ valid: false, error: expect.stringMatching(/interests/i) });

    // Work exceeding 80 characters
    expect(
      validateProfileDraft(
        { ...minimalEssentialProfile, work: "a".repeat(81) },
        "user-123",
      ),
    ).toMatchObject({ valid: false, error: expect.stringMatching(/work/i) });

    // Education exceeding 80 characters
    expect(
      validateProfileDraft(
        { ...minimalEssentialProfile, education: "a".repeat(81) },
        "user-123",
      ),
    ).toMatchObject({ valid: false, error: expect.stringMatching(/education/i) });
  });
});

describe("calculateProfileCompleteness Helper", () => {
  test("computes partial percentage for minimal onboarding profile", () => {
    const minimal = {
      name: "Priya",
      dob: "1998-05-20",
      city: "Bengaluru",
      photos: [{ id: "p1", uri: "url", isMain: true } as any],
    };
    const comp = calculateProfileCompleteness(minimal);
    expect(comp.percentage).toBeGreaterThanOrEqual(25);
    expect(comp.percentage).toBeLessThan(50);
    expect(comp.missingItems.some((i) => i.key === "bio")).toBe(true);
    expect(comp.missingItems.some((i) => i.key === "interests")).toBe(true);
  });

  test("computes 100% for a fully populated profile", () => {
    const full = {
      name: "Priya",
      dob: "1998-05-20",
      city: "Bengaluru",
      bio: "Product designer, classical dancer, and foodie.",
      intents: ["Dating"],
      interests: ["Art", "Dance", "Food"],
      work: "Senior Designer at Flipkart",
      education: "NID Ahmedabad",
      lifestyle: { exercise: "Sometimes", drink: "Socially" },
      photos: [
        { id: "p1", uri: "url1" } as any,
        { id: "p2", uri: "url2" } as any,
        { id: "p3", uri: "url3" } as any,
      ],
    };
    const comp = calculateProfileCompleteness(full);
    expect(comp.percentage).toBe(100);
    expect(comp.missingItems).toHaveLength(0);
  });
});

describe("Onboarding and Complete Profile Architecture & Navigation", () => {
  test("initial onboarding index defines exactly 5 essential steps", () => {
    const onboardingSrc = read("mobile/app/onboarding/index.tsx");
    expect(onboardingSrc).toMatch(
      /const STEPS =\s*\[\s*"name",\s*"dob",\s*"gender",\s*"location",\s*"photos",?\s*\]/m,
    );
  });

  test("onboarding redirects already-onboarded users to /profile/complete", () => {
    const onboardingSrc = read("mobile/app/onboarding/index.tsx");
    expect(onboardingSrc).toMatch(/router\.replace\("\/profile\/complete"\)/);
  });

  test("me.tsx links to /profile/complete for editing and completing profiles", () => {
    const meSrc = read("mobile/app/(tabs)/me.tsx");
    expect(meSrc).toMatch(/router\.push\("\/profile\/complete"\)/);
    expect(meSrc).toMatch(/completeProfileCard/);
  });

  test("settings/index.tsx links Edit Profile & Photos to /profile/complete", () => {
    const settingsSrc = read("mobile/app/settings/index.tsx");
    expect(settingsSrc).toMatch(/router\.push\("\/profile\/complete"\)/);
  });

  test("migration 20260101002900 validates essential fields while permitting optional profile completion", () => {
    const mig = read(
      "supabase/migrations/20260101002900_streamlined_onboarding_and_profile_completion.sql",
    );
    expect(mig).toMatch(/char_length\(btrim\(NEW\.name\)\) < 2/);
    expect(mig).toMatch(/NEW\.dob IS NULL/);
    expect(mig).toMatch(/NEW\.gender NOT IN \('man', 'woman'\)/);
    expect(mig).toMatch(/NEW\.seeking NOT IN \('man', 'woman'\)/);
    expect(mig).toMatch(/char_length\(btrim\(NEW\.city\)\) < 1/);
    expect(mig).toMatch(/jsonb_array_length\(NEW\.photos\) < 1/);
    // Crucial: bio, intents, and interests must NOT be hard-gated with minimum counts for onboarding
    expect(mig).not.toMatch(/char_length\(btrim\(NEW\.bio\)\) < 15/);
    expect(mig).not.toMatch(/cardinality\(NEW\.intents\) < 1/);
    expect(mig).not.toMatch(/cardinality\(NEW\.interests\) < 3/);
  });

  test("complete.tsx includes essential fields in handleSave to ensure profile validation succeeds", () => {
    const completeSrc = read("mobile/app/profile/complete.tsx");
    expect(completeSrc).toMatch(/name:\s*name\.trim\(\)\s*\|\|\s*profile\?\.name/);
    // Phase 5: the city is no longer free text here; it is the server-authoritative selection (falling back to the profile).
    expect(completeSrc).toMatch(/city:\s*\(await loadLocationSelection\(\)\.catch\(\(\) => null\)\)\?\.city\s*\?\?\s*profile\?\.city/);
    expect(completeSrc).toMatch(/dob:\s*profile\?\.dob/);
    expect(completeSrc).toMatch(/gender:\s*profile\?\.gender/);
    expect(completeSrc).toMatch(/seeking:\s*profile\?\.seeking/);
  });

  test("saveProfile in profile.ts uses get_my_dob RPC to respect revoked table column permissions", () => {
    const profileSrc = read("mobile/src/services/profile.ts");
    expect(profileSrc).toMatch(/supabase\.rpc\("get_my_dob"\)/);
    expect(profileSrc).not.toMatch(/\.from\("profiles"\)\s*\.select\("dob"\)/);
  });

  test("migration 20260101002800 has matching grant signature for get_discovery_feed_page", () => {
    const mig = read(
      "supabase/migrations/20260101002800_entitlements_calling_view_once.sql",
    );
    expect(mig).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_discovery_feed_page\(integer, integer, integer, integer, text\[\], text\[\], text\[\], integer, text, integer\) TO authenticated;/,
    );
  });

  test("migration 20260101002800 drops obsolete 2-argument setting_int overload to prevent function ambiguity", () => {
    const mig = read(
      "supabase/migrations/20260101002800_entitlements_calling_view_once.sql",
    );
    expect(mig).toMatch(
      /DROP FUNCTION IF EXISTS public\.setting_int\(text, integer\);/,
    );
  });

  test("migration 20260101002900 safely coalesces array values before unnest", () => {
    const mig = read(
      "supabase/migrations/20260101002900_streamlined_onboarding_and_profile_completion.sql",
    );
    expect(mig).toMatch(
      /unnest\(coalesce\(NEW\.intents, '{}'\) \|\| coalesce\(NEW\.interests, '{}'\) \|\| coalesce\(NEW\.languages, '{}'\)\)/,
    );
  });

  test("migration 20260101002800 record_swipe inserts matches and returns is_match", () => {
    const mig = read(
      "supabase/migrations/20260101002800_entitlements_calling_view_once.sql",
    );
    expect(mig).toMatch(/INSERT INTO public\.matches \(user_a, user_b\)/);
    expect(mig).toMatch(/'is_match', _is_match/);
    expect(mig).toMatch(/'match', _is_match/);
  });
});

