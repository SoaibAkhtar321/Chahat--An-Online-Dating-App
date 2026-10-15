import {
  getPhotoDisplayState,
  hasSelectedPhotoUri,
  validateProfileDraft,
} from "../mobile/src/services/profilePolicy";
import type { MeProfile } from "../mobile/src/types";

const completedProfile: Partial<MeProfile> = {
  name: "Chahat",
  dob: "1995-06-15",
  gender: "woman",
  seeking: "man",
  intents: ["Friendship"],
  city: "Mumbai",
  bio: "I enjoy good conversations and weekend walks.",
  interests: ["Books", "Coffee", "Music"],
  photos: [
    {
      id: "photo-1",
      uri: "signed-url",
      path: "user-1/photo-1.jpg",
      thumbPath: "user-1/photo-1.jpg",
      status: "pending",
    },
  ],
  onboarded: true,
};

describe("profile data validation", () => {
  it("accepts a complete profile with an owned uploaded photo", () => {
    expect(validateProfileDraft(completedProfile, "user-1")).toEqual({ valid: true });
  });

  it("rejects attempts to complete onboarding with missing required data", () => {
    expect(validateProfileDraft({ onboarded: true }, "user-1")).toMatchObject({
      valid: false,
      error: "Enter a name between 2 and 40 characters.",
    });
  });

  it("rejects photo paths owned by a different user and traversal paths", () => {
    expect(
      validateProfileDraft(
        {
          photos: [
            {
              id: "photo-1",
              uri: "signed-url",
              path: "user-2/photo.jpg",
              status: "pending",
            },
          ],
        },
        "user-1",
      ).valid,
    ).toBe(false);
    expect(
      validateProfileDraft(
        {
          photos: [
            {
              id: "photo-1",
              uri: "signed-url",
              path: "user-1/../other/photo.jpg",
              status: "pending",
            },
          ],
        },
        "user-1",
      ).valid,
    ).toBe(false);
  });

  it("rejects unsupported fields, oversized values, and inconsistent age ranges", () => {
    expect(validateProfileDraft({ gender: "other" as MeProfile["gender"] }, "user-1").valid).toBe(
      false,
    );
    expect(validateProfileDraft({ bio: "x".repeat(501) }, "user-1").valid).toBe(false);
    expect(validateProfileDraft({ ageMin: 40, ageMax: 30 }, "user-1").valid).toBe(false);
  });

  it("distinguishes missing, loading, loaded, and failed profile images", () => {
    expect(getPhotoDisplayState(undefined, null, null)).toBe("missing");
    expect(getPhotoDisplayState("signed-url", null, null)).toBe("loading");
    expect(getPhotoDisplayState("signed-url", "signed-url", null)).toBe("loaded");
    expect(getPhotoDisplayState("signed-url", null, "signed-url")).toBe("error");
  });

  it("detects duplicate selections after the source was compressed", () => {
    expect(
      hasSelectedPhotoUri(
        [{ id: "photo-1", uri: "compressed-file", sourceUri: "picker-file", status: "pending" }],
        "picker-file",
      ),
    ).toBe(true);
    expect(
      hasSelectedPhotoUri(
        [{ id: "photo-1", uri: "compressed-file", sourceUri: "picker-file", status: "pending" }],
        "another-file",
      ),
    ).toBe(false);
  });
});
