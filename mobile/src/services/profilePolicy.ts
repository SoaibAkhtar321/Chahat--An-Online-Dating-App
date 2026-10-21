import type { MeProfile, PhotoItem } from "../types";
import { PROMPTS } from "../types";
import { validateDob } from "../utils/validation";
import { validateVoiceIntroDuration, validateVoiceIntroPath } from "./voiceIntroPolicy";

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
  if (profile.voiceIntroPath !== undefined && profile.voiceIntroPath !== null) {
    if (
      !validateVoiceIntroPath(userId, profile.voiceIntroPath) ||
      !validateVoiceIntroDuration(profile.voiceIntroDurationSec ?? 0).valid
    ) {
      return { valid: false, error: "Your voice intro could not be verified. Please record it again." };
    }
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
    profile.prompt.a &&
    profile.prompt.a.trim().length > 0 &&
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

  // Required fields for onboarding: Name, DOB (18+), Gender, Seeking, City, and 1+ Photo.
  // Optional profile details (bio, prompts, intents, interests, work, education, languages, lifestyle)
  // are moved to the "Complete Profile" section and can be completed or updated at any time.
  if (profile.onboarded === true) {
    if (!inRange(profile.name, 2, 40)) {
      return { valid: false, error: "Enter a name between 2 and 40 characters." };
    }
    const dobCheck = profile.dob
      ? validateDob(profile.dob)
      : { valid: false, error: "Enter a valid birth date to complete your profile." };
    if (!dobCheck.valid) {
      return {
        valid: false,
        error: dobCheck.error || "Enter a valid birth date to complete your profile.",
      };
    }
    if (!profile.gender || !profile.seeking) {
      return { valid: false, error: "Choose your gender and profile preference." };
    }
    if (!inRange(profile.city, 1, 80)) {
      return { valid: false, error: "Choose a city to complete your profile." };
    }
    if (!profile.photos?.length) {
      return { valid: false, error: "Add at least one uploaded photo to complete your profile." };
    }
  }

  return { valid: true };
}

export interface ProfileCompleteness {
  percentage: number;
  completedChecks: number;
  totalChecks: number;
  missingItems: Array<{ key: string; label: string }>;
}

export function calculateProfileCompleteness(
  profile: Partial<MeProfile> | null | undefined,
): ProfileCompleteness {
  if (!profile) {
    return { percentage: 0, completedChecks: 0, totalChecks: 8, missingItems: [] };
  }
  const items = [
    { key: "basic", label: "Basic details (Name, Age, City)", done: !!profile.name && !!profile.dob && !!profile.city },
    { key: "photo", label: "Primary photo", done: (profile.photos?.length || 0) >= 1 },
    { key: "bio", label: "About me bio", done: !!profile.bio && profile.bio.trim().length >= 10 },
    { key: "intents", label: "Relationship intent", done: (profile.intents?.length || 0) >= 1 },
    { key: "interests", label: "At least 3 interests", done: (profile.interests?.length || 0) >= 3 },
    { key: "morePhotos", label: "3+ photos", done: (profile.photos?.length || 0) >= 3 },
    { key: "workEdu", label: "Work or education", done: !!profile.work || !!profile.education },
    { key: "lifestyle", label: "Lifestyle habits", done: Object.keys(profile.lifestyle || {}).length >= 2 },
  ];

  const completed = items.filter((i) => i.done).length;
  const percentage = Math.round((completed / items.length) * 100);
  const missingItems = items.filter((i) => !i.done).map((i) => ({ key: i.key, label: i.label }));

  return {
    percentage,
    completedChecks: completed,
    totalChecks: items.length,
    missingItems,
  };
}
