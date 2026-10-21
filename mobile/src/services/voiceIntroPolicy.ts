// Pure voice intro rules (no native or network imports) so policy code and tests can use them freely.

export const VOICE_INTRO_LIMITS = {
  maxDurationSec: 30,
  minDurationSec: 3,
};

/** What the recorder holds. "saved" = already on the profile (nothing to upload). */
export type VoiceIntroValue =
  | { kind: "none" }
  | { kind: "saved"; path: string; durationSec: number }
  | { kind: "local"; uri: string; durationSec: number };

export function validateVoiceIntroPath(userId: string, path: string | null | undefined): boolean {
  if (!path) return true;
  if (!path.startsWith(`${userId}/voice_intro_`)) return false;
  return !path.split("/").some((part) => !part || part === "." || part === "..");
}

export function validateVoiceIntroDuration(durationSec: number): { valid: boolean; error?: string } {
  if (!Number.isFinite(durationSec) || durationSec < VOICE_INTRO_LIMITS.minDurationSec) {
    return {
      valid: false,
      error: `Your voice intro should be at least ${VOICE_INTRO_LIMITS.minDurationSec} seconds.`,
    };
  }
  if (durationSec > VOICE_INTRO_LIMITS.maxDurationSec + 1) {
    return {
      valid: false,
      error: `Your voice intro can be at most ${VOICE_INTRO_LIMITS.maxDurationSec} seconds.`,
    };
  }
  return { valid: true };
}

