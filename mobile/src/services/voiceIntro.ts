// Voice intro: a short recorded introduction on a member's profile.
// Stored in the private "voice-intros" bucket under "<user id>/voice_intro_<suffix>.m4a" and read back
// through short-lived signed URLs, exactly like photos. Recording itself reuses voiceMedia.ts.
import { supabase } from "./supabase";
import { getSignedUrls, prepareVoiceUpload } from "./storage";
import {
  VOICE_INTRO_LIMITS,
  validateVoiceIntroDuration,
  validateVoiceIntroPath,
  type VoiceIntroValue,
} from "./voiceIntroPolicy";

export { VOICE_INTRO_LIMITS, validateVoiceIntroDuration, validateVoiceIntroPath };

export interface VoiceIntroRef {
  path: string;
  durationSec: number;
}

export interface VoiceIntroPlayback {
  url: string;
  durationSec: number;
}

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Uploads a freshly recorded local file and returns the storage reference to save on the profile. */
export async function uploadVoiceIntro(
  userId: string,
  uri: string,
  durationSec: number,
): Promise<VoiceIntroRef> {
  const check = validateVoiceIntroDuration(durationSec);
  if (!check.valid) throw new Error(check.error);
  const { data, error: userError } = await supabase.auth.getUser();
  if (userError || !data.user || data.user.id !== userId) {
    throw new Error("Your session has expired. Please sign in again.");
  }
  const rounded = Math.max(1, Math.min(60, Math.round(durationSec)));
  const { blob, mimeType, extension } = await prepareVoiceUpload(uri, rounded);
  const path = `${userId}/voice_intro_${uniqueSuffix()}.${extension}`;
  const { error } = await supabase.storage.from("voice-intros").upload(path, blob, {
    contentType: mimeType,
    upsert: false,
  });
  if (error) throw error;
  return { path, durationSec: rounded };
}

/** Best effort removal of an unreferenced voice intro file. */
export async function removeVoiceIntroFiles(userId: string, paths: string[]): Promise<void> {
  const safe = [...new Set(paths)].filter((p) => !!p && validateVoiceIntroPath(userId, p));
  if (safe.length === 0) return;
  const { error } = await supabase.storage.from("voice-intros").remove(safe);
  if (error) console.warn("removeVoiceIntroFiles:", error.message);
}

/** Resolves the intros other members may hear. Members without an intro are simply absent from the map. */
export async function fetchVoiceIntros(
  profileIds: string[],
): Promise<Record<string, VoiceIntroPlayback>> {
  const ids = [...new Set(profileIds.filter(Boolean))].slice(0, 50);
  if (ids.length === 0) return {};
  try {
    const { data, error } = await supabase.rpc("get_voice_intros", { _ids: ids });
    if (error || !Array.isArray(data)) {
      // Most often: migration 20260101004750 (get_voice_intros) has not been applied to this Supabase project.
      if (error) console.warn("get_voice_intros failed:", error.message);
      return {};
    }
    const rows = data as Array<{
      id: string;
      voice_intro_path: string | null;
      voice_intro_duration_sec: number | null;
    }>;
    const signed = await getSignedUrls(
      "voice-intros",
      rows.map((r) => r.voice_intro_path || "").filter(Boolean),
    );
    const out: Record<string, VoiceIntroPlayback> = {};
    for (const row of rows) {
      const url = row.voice_intro_path ? signed[row.voice_intro_path] : undefined;
      if (url) out[row.id] = { url, durationSec: row.voice_intro_duration_sec ?? 0 };
      else if (row.voice_intro_path) {
        // Most often: migration 20260101005200 (voice_intro_visibility_fix) has not been applied, so Storage denies the signed URL.
        console.warn("Voice intro exists but could not be signed (check the voice-intros read policy):", row.voice_intro_path);
      }
    }
    return out;
  } catch (err) {
    console.warn("fetchVoiceIntros failed:", err);
    return {};
  }
}

export async function fetchVoiceIntro(profileId: string): Promise<VoiceIntroPlayback | null> {
  return (await fetchVoiceIntros([profileId]))[profileId] ?? null;
}

export interface VoiceIntroSavePlan {
  /** Fields to merge into the saveProfile() call. Empty when nothing changed. */
  fields: { voiceIntroPath?: string | null; voiceIntroDurationSec?: number | null };
  /** Files to delete once the profile save succeeded (replaced or removed intros). */
  staleAfterSave: string[];
}

/**
 * Uploads a newly recorded intro (once, even if the profile save is retried) and works out what the
 * profile save must change. Throws with a user-readable message if the upload fails.
 */
export async function prepareVoiceIntroSave(
  userId: string,
  value: VoiceIntroValue,
  currentPath: string | null | undefined,
  uploadCache?: { current: { uri: string; ref: VoiceIntroRef } | null },
): Promise<VoiceIntroSavePlan> {
  if (value.kind === "local") {
    let ref = uploadCache?.current?.uri === value.uri ? uploadCache.current.ref : null;
    if (!ref) {
      ref = await uploadVoiceIntro(userId, value.uri, value.durationSec);
      if (uploadCache) uploadCache.current = { uri: value.uri, ref };
    }
    return {
      fields: { voiceIntroPath: ref.path, voiceIntroDurationSec: ref.durationSec },
      staleAfterSave: currentPath && currentPath !== ref.path ? [currentPath] : [],
    };
  }
  if (value.kind === "none" && currentPath) {
    return {
      fields: { voiceIntroPath: null, voiceIntroDurationSec: null },
      staleAfterSave: [currentPath],
    };
  }
  return { fields: {}, staleAfterSave: [] };
}

export function initialVoiceIntroValue(
  path: string | null | undefined,
  durationSec: number | null | undefined,
): VoiceIntroValue {
  return path ? { kind: "saved", path, durationSec: durationSec ?? 0 } : { kind: "none" };
}