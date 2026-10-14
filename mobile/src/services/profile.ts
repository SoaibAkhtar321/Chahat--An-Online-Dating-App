import { supabase } from "./supabase";
import { getSignedUrls, sanitizeAndPrepareImageUpload } from "./storage";
import type { MeProfile, PhotoItem } from "../types";
export { calculateAge, validateDob } from "../utils/validation";

export async function fetchMyProfile(userId: string, email: string): Promise<MeProfile> {
  const [profileRes, stateRes] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "id, name, gender, seeking, city, bio, work, education, intents, interests, languages, lifestyle, prompt, onboarded",
      )
      .eq("id", userId)
      .maybeSingle(),
    supabase.from("account_state").select("data").eq("user_id", userId).maybeSingle(),
  ]);

  if (profileRes.error) throw new Error(`profile load failed: ${profileRes.error.message}`);
  const row = profileRes.data as any;
  // dob is not readable via table select (privacy); fetch own dob through a dedicated RPC.
  const { data: ownDob } = await supabase.rpc("get_my_dob");
  // photos is not readable via table select (privacy stopgap); fetch own photos through a dedicated RPC.
  const { data: ownPhotos } = await supabase.rpc("get_my_photos");
  const ownPhotoRows: any[] = Array.isArray(ownPhotos) ? (ownPhotos as any[]) : [];
  const photoPaths = ownPhotoRows.map((p) => p.path).filter(Boolean);
  const signed = await getSignedUrls("photos", photoPaths);
  const stateData = stateRes.data?.data ?? {};

  const photos: PhotoItem[] = Array.isArray(ownPhotos)
    ? ownPhotoRows.map((p, idx) => ({
        id: p.id || `photo_${idx}`,
        uri: p.path ? signed[p.path] || "" : p.src || "",
        path: p.path,
        thumbPath: p.thumbPath,
        isMain: idx === 0,
        status: p.status === "approved" || p.status === "rejected" ? p.status : "pending",
      }))
    : [];

  return {
    id: userId,
    email,
    name: row?.name ?? "",
    dob: (ownDob as string | null) ?? "",
    gender: (row?.gender as any) ?? "",
    seeking: (row?.seeking as any) ?? "",
    intents: row?.intents ?? [],
    city: row?.city ?? "",
    work: row?.work ?? "",
    education: row?.education ?? "",
    bio: row?.bio ?? "",
    prompt: row?.prompt ?? { q: "My ideal Sunday", a: "" },
    interests: row?.interests ?? [],
    lifestyle: row?.lifestyle ?? {},
    languages: row?.languages ?? [],
    photos,
    ageMin: stateData.ageMin ?? 18,
    ageMax: stateData.ageMax ?? 35,
    distance: stateData.distance ?? 50,
    onboarded: !!row?.onboarded,
    verificationStatus: stateData.verification?.status ?? "none",
  };
}

export async function saveProfile(
  profile: Partial<MeProfile>,
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const updateData: Record<string, any> = {};

    if (profile.name !== undefined) updateData.name = profile.name.slice(0, 40);

    // If dob is provided, check existing profile before sending it to avoid triggering the
    // database immutability guard: "Date of birth cannot be changed once saved"
    if (profile.dob !== undefined && profile.dob) {
      const { data: existingRow } = await supabase
        .from("profiles")
        .select("dob")
        .eq("id", userId)
        .maybeSingle();

      if (!existingRow?.dob) {
        // Not set yet in database, safe to set
        updateData.dob = profile.dob;
      } else if (existingRow.dob !== profile.dob) {
        // Already set and different: log and do not send to prevent blocking other updates
        console.warn(
          "saveProfile: DOB is immutable once set in database. Keeping existing DOB:",
          existingRow.dob
        );
      }
      // If existingRow.dob === profile.dob, omitting it from updateData prevents the trigger from firing
    }
    if (profile.gender !== undefined) updateData.gender = profile.gender;
    if (profile.seeking !== undefined) updateData.seeking = profile.seeking;
    if (profile.city !== undefined) updateData.city = profile.city.slice(0, 80);
    if (profile.work !== undefined) updateData.work = profile.work.slice(0, 80);
    if (profile.education !== undefined) updateData.education = profile.education.slice(0, 80);
    if (profile.bio !== undefined) updateData.bio = profile.bio.slice(0, 500);
    if (profile.prompt !== undefined) updateData.prompt = profile.prompt;
    if (profile.interests !== undefined) updateData.interests = profile.interests;
    if (profile.intents !== undefined) updateData.intents = profile.intents;
    if (profile.languages !== undefined) updateData.languages = profile.languages;
    if (profile.lifestyle !== undefined) updateData.lifestyle = profile.lifestyle;
    if (profile.onboarded !== undefined) updateData.onboarded = profile.onboarded;

    if (profile.photos !== undefined) {
      updateData.photos = profile.photos.map((p) => ({
        id: p.id,
        path: p.path || "",
        thumbPath: p.thumbPath || p.path || "",
      }));
    }

    const { data: updated, error } = await supabase
      .from("profiles")
      .update(updateData)
      .eq("id", userId)
      .select("id");
    if (error) {
      console.error("saveProfile: profiles update failed", error);
      return { success: false, error: error.message };
    }
    if (!updated || updated.length === 0) {
      console.error("saveProfile: no profile row was updated for user", userId);
      return {
        success: false,
        error:
          "Your profile record could not be found or updated. The database may not be fully set up for this project (profiles table or the new-user trigger).",
      };
    }

    // Update account_state for private preferences
    const privateState = {
      ageMin: profile.ageMin,
      ageMax: profile.ageMax,
      distance: profile.distance,
      verification: { status: profile.verificationStatus },
    };

    const { error: stateError } = await supabase
      .from("account_state")
      .upsert({ user_id: userId, data: privateState, updated_at: new Date().toISOString() });
    if (stateError) {
      // Non-fatal: the profile itself was saved
      console.warn("saveProfile: account_state upsert failed", stateError.message);
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to update profile" };
  }
}

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export async function uploadProfilePhoto(
  userId: string,
  photoId: string,
  uri: string,
): Promise<{ path: string; thumbPath: string }> {
  // Unique path per upload + upsert:false: a stored photo is never overwritten in place, so a
  // moderation approval can never silently apply to different content.
  const filePath = `${userId}/${photoId}-${uniqueSuffix()}.jpg`;

  const { blob, mimeType } = await sanitizeAndPrepareImageUpload(uri, "image/jpeg");

  const { error } = await supabase.storage.from("photos").upload(filePath, blob, {
    contentType: mimeType,
    upsert: false,
  });

  if (error) throw error;

  return {
    path: filePath,
    thumbPath: filePath,
  };
}

/** Verification selfies live under <uid>/verification/ and are never shown to other users. */
export async function uploadVerificationSelfie(userId: string, uri: string): Promise<string> {
  const filePath = `${userId}/verification/selfie-${uniqueSuffix()}.jpg`;
  const { blob, mimeType } = await sanitizeAndPrepareImageUpload(uri, "image/jpeg");
  const { error } = await supabase.storage.from("photos").upload(filePath, blob, {
    contentType: mimeType,
    upsert: false,
  });
  if (error) throw error;
  return filePath;
}

/**
 * Asks the server to check this user's pending photos (Google Cloud Vision SafeSearch).
 * Best effort: if it fails, the photos simply stay pending (hidden from other users).
 */
export async function requestPhotoModeration(): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke("moderate-photo", { body: {} });
    if (error) console.warn("requestPhotoModeration failed:", error.message);
  } catch (err) {
    console.warn("requestPhotoModeration error:", err);
  }
}
