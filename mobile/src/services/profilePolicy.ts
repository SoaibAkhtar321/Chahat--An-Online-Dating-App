import type { MeProfile, PhotoItem } from "../types";
import { PROMPTS } from "../types";
import { validateDob } from "../utils/validation";

export type ProfileValidation = { valid: true } | { valid: false; error: string };
export type PhotoDisplayState = "missing" | "loading" | "loaded" | "error";

export function getPhotoDisplayState(
  uri: string | null | undefined,
  loadedUri: string | null,
  failedUri: string | null,
): PhotoDisplayState {
  if (!uri) return "missing";
  if (failedUri === uri) return "error";
  if (loadedUri === uri) return "loaded";
  return "loading";
}

export function hasSelectedPhotoUri(photos: PhotoItem[], sourceUri: string): boolean {
  return photos.some((photo) => photo.sourceUri === sourceUri || photo.uri === sourceUri);
}

const inRange = (value: unknown, min: number, max: number): value is string =>
  typeof value === "string" && value.trim().length >= min && value.trim().length <= max;

function validatePhotoOwnership(userId: string, photos: PhotoItem[]): boolean {
  const paths = new Set<string>();
  return photos.every((photo) => {
    if (typeof photo.id !== "string" || !photo.id.trim()) return false;
    if (!photo.path || !photo.path.startsWith(`${userId}/`)) return false;
    if (photo.path.split("/").some((part) => !part || part === "." || part === "..")) return false;
    if (photo.path.includes("/verification/")) return false;
    if (photo.thumbPath && !photo.thumbPath.startsWith(`${userId}/`)) return false;
    if (paths.has(photo.path)) return false;
    paths.add(photo.path);
    return true;
  });
}

export function validateProfileDraft(
  profile: Partial<MeProfile>,
  userId: string,
): ProfileValidation {
  if (profile.name !== undefined && profile.name.trim() && !inRange(profile.name, 2, 40)) {
    return { valid: false, error: "Name must be between 2 and 40 characters." };
  }
  if (profile.city !== undefined && profile.city.trim() && !inRange(profile.city, 1, 80)) {
    return { valid: false, error: "City must be 80 characters or fewer." };
  }
  for (const [field, value] of [
    ["Work", profile.work],
    ["Education", profile.education],
  ] as const) {
    if (value !== undefined && value.trim().length > 80) {
      return { valid: false, error: `${field} must be 80 characters or fewer.` };
    }
  }
  if (profile.bio !== undefined && profile.bio.length > 500) {
    return { valid: false, error: "Bio must be 500 characters or fewer." };
  }
  if (profile.gender !== undefined && !["", "man", "woman"].includes(profile.gender)) {
    return { valid: false, error: "Select a supported gender." };
  }
  if (profile.seeking !== undefined && !["", "man", "woman"].includes(profile.seeking)) {
    return { valid: false, error: "Select a supported profile preference." };
  }
  for (const [field, values, max] of [
    ["Intentions", profile.intents, 6],
    ["Interests", profile.interests, 15],
    ["Languages", profile.languages, 16],
  ] as const) {
    if (
      values !== undefined &&
      (values.length > max ||
        values.some((value) => typeof value !== "string" || !value.trim() || value.length > 80))
    ) {
      return { valid: false, error: `${field} contains an unsupported value or too many entries.` };
    }
  }
  if (
    profile.prompt !== undefined &&
    (!PROMPTS.includes(profile.prompt.q) || profile.prompt.a.length > 500)
  ) {
    return {
      valid: false,
      error: "Choose a supported profile prompt and keep its answer under 500 characters.",
    };
  }
  if (
    profile.lifestyle !== undefined &&
    Object.entries(profile.lifestyle).some(
      ([key, value]) => key.length > 40 || typeof value !== "string" || value.length > 80,
    )
  ) {
    return { valid: false, error: "Lifestyle details contain an unsupported value." };
  }
  if (profile.photos !== undefined) {
    if (profile.photos.length > 6 || !validatePhotoOwnership(userId, profile.photos)) {
      return {
        valid: false,
        error: "Photos must be unique stored images belonging to this account.",
      };
    }
  }
  if (profile.ageMin !== undefined && (profile.ageMin < 18 || profile.ageMin > 100)) {
    return { valid: false, error: "Minimum age must be between 18 and 100." };
  }
  if (profile.ageMax !== undefined && (profile.ageMax < 18 || profile.ageMax > 100)) {
    return { valid: false, error: "Maximum age must be between 18 and 100." };
  }
  if (
    profile.ageMin !== undefined &&
    profile.ageMax !== undefined &&
    profile.ageMin > profile.ageMax
  ) {
    return { valid: false, error: "Minimum age cannot exceed maximum age." };
  }
  if (profile.distance !== undefined && (profile.distance < 1 || profile.distance > 500)) {
    return { valid: false, error: "Distance must be between 1 and 500 km." };
  }

  if (profile.onboarded === true) {
    if (!inRange(profile.name, 2, 40)) {
      return { valid: false, error: "Enter a name between 2 and 40 characters." };
    }
    if (!profile.dob || !validateDob(profile.dob).valid) {
      return { valid: false, error: "Enter a valid birth date to complete your profile." };
    }
    if (!profile.gender || !profile.seeking) {
      return { valid: false, error: "Choose your gender and profile preference." };
    }
    if (!inRange(profile.city, 1, 80)) {
      return { valid: false, error: "Choose a city to complete your profile." };
    }
    if (!profile.bio || profile.bio.trim().length < 15) {
      return { valid: false, error: "Write at least 15 characters about yourself." };
    }
    if (!profile.intents?.length || !profile.interests || profile.interests.length < 3) {
      return { valid: false, error: "Choose an intention and at least 3 interests." };
    }
    if (!profile.photos?.length) {
      return { valid: false, error: "Add at least one uploaded photo to complete your profile." };
    }
  }

  return { valid: true };
}
