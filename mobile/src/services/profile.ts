import { supabase } from "./supabase";
import { getSignedUrls, imageFileExtension, sanitizeAndPrepareImageUpload } from "./storage";
import type { MeProfile, PhotoItem } from "../types";
import { validateProfileDraft } from "./profilePolicy";
export { calculateAge, validateDob } from "../utils/validation";

async function requireAuthenticatedUser(
  expectedUserId: string,
): Promise<{ id: string; email?: string }> {
  if (!expectedUserId) throw new Error("A signed-in account is required.");
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Your session has expired. Please sign in again.");
  if (data.user.id !== expectedUserId) {
    throw new Error("Profile operations are limited to the signed-in account.");
  }
  return { id: data.user.id, email: data.user.email };
}

export async function fetchMyProfile(userId: string, _email: string): Promise<MeProfile> {
  const authenticatedUser = await requireAuthenticatedUser(userId);
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
  if (stateRes.error) throw new Error(`profile preferences load failed: ${stateRes.error.message}`);
  if (!profileRes.data) throw new Error("Your profile record is not available yet. Please retry.");
  const row = profileRes.data as any;
  // dob is not readable via table select (privacy); fetch own dob through a dedicated RPC.
  const { data: ownDob, error: dobError } = await supabase.rpc("get_my_dob");
  if (dobError) throw new Error(`birth date load failed: ${dobError.message}`);
  // photos is not readable via table select (privacy stopgap); fetch own photos through a dedicated RPC.
  const { data: ownPhotos, error: photosError } = await supabase.rpc("get_my_photos");
  if (photosError) throw new Error(`profile photos load failed: ${photosError.message}`);
  const ownPhotoRows: any[] = Array.isArray(ownPhotos) ? (ownPhotos as any[]) : [];
  const photoPaths = ownPhotoRows.map((p) => p.path).filter(Boolean);
  const signed = await getSignedUrls("photos", photoPaths);
  const stateData = stateRes.data?.data ?? {};

  const photos: PhotoItem[] = Array.isArray(ownPhotos)
    ? ownPhotoRows.map((p, idx) => ({
        id: p.id || `photo_${idx}`,
        uri: p.path ? signed[p.path] || "" : "",
        path: p.path,
        thumbPath: p.thumbPath,
        isMain: idx === 0,
        status: p.status === "approved" || p.status === "rejected" ? p.status : "pending",
      }))
    : [];

  return {
    id: authenticatedUser.id,
    email: authenticatedUser.email || "",
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
    const authenticatedUser = await requireAuthenticatedUser(userId);
    const authenticatedUserId = authenticatedUser.id;
    const validation = validateProfileDraft(profile, authenticatedUserId);
    if (!validation.valid) return { success: false, error: validation.error };

    const updateData: Record<string, any> = {};

    if (profile.name !== undefined) updateData.name = profile.name.trim();

    // If dob is provided, check existing profile before sending it to avoid triggering the
    // database immutability guard: "Date of birth cannot be changed once saved"
    if (profile.dob !== undefined && profile.dob) {
      const { data: existingRow, error } = await supabase
        .from("profiles")
        .select("dob")
        .eq("id", authenticatedUserId)
        .maybeSingle();
      if (error) throw new Error(`birth date check failed: ${error.message}`);

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
    if (profile.city !== undefined) updateData.city = profile.city.trim();
    if (profile.work !== undefined) updateData.work = profile.work.trim();
    if (profile.education !== undefined) updateData.education = profile.education.trim();
    if (profile.bio !== undefined) updateData.bio = profile.bio.trim();
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

    if (Object.keys(updateData).length > 0) {
      const { data: updated, error } = await supabase
        .from("profiles")
        .update(updateData)
        .eq("id", authenticatedUserId)
        .select("id");
      if (error) {
        console.error("saveProfile: profiles update failed", error);
        return { success: false, error: error.message };
      }
      if (!updated || updated.length === 0) {
        console.error("saveProfile: no profile row was updated for signed-in user");
        return {
          success: false,
          error: "Your profile record could not be found or updated. Please retry or contact support.",
        };
      }
    }

    // Update account_state for private preferences
    // Protection: Verification status cannot be self-approved by client.
    const safeVerificationStatus =
      profile.verificationStatus === "pending" || profile.verificationStatus === "none"
        ? profile.verificationStatus
        : undefined;

    const privateState: Record<string, any> = {
      ageMin: profile.ageMin,
      ageMax: profile.ageMax,
      distance: profile.distance,
    };
    if (safeVerificationStatus !== undefined) {
      privateState.verification = { status: safeVerificationStatus };
    }

    const hasPrivateState = Object.values(privateState).some((value) => value !== undefined);
    if (hasPrivateState) {
      const { data: existingState, error: loadStateError } = await supabase
        .from("account_state")
        .select("data")
        .eq("user_id", authenticatedUserId)
        .maybeSingle();
      if (loadStateError) {
        return {
          success: false,
          error: `Profile preferences load failed: ${loadStateError.message}`,
        };
      }
      const mergedState = { ...(existingState?.data ?? {}) };
      for (const [key, value] of Object.entries(privateState)) {
        if (value !== undefined) mergedState[key] = value;
      }
      const { error: stateError } = await supabase
        .from("account_state")
        .upsert({
          user_id: authenticatedUserId,
          data: mergedState,
          updated_at: new Date().toISOString(),
        });
      if (stateError) {
        return { success: false, error: `Profile preferences save failed: ${stateError.message}` };
      }
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
  const authenticatedUserId = (await requireAuthenticatedUser(userId)).id;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(photoId)) {
    throw new Error("Invalid photo identifier.");
  }
  if (!uri.trim()) throw new Error("Selected image is unavailable.");

  const { blob, mimeType } = await sanitizeAndPrepareImageUpload(uri);
  // Unique path per upload + upsert:false: a stored photo is never overwritten in place, so a
  // moderation approval can never silently apply to different content.
  const filePath = `${authenticatedUserId}/${photoId}-${uniqueSuffix()}.${imageFileExtension(mimeType)}`;

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
  const authenticatedUserId = (await requireAuthenticatedUser(userId)).id;
  if (!uri.trim()) throw new Error("Selected image is unavailable.");
  const { blob, mimeType } = await sanitizeAndPrepareImageUpload(uri);
  const filePath = `${authenticatedUserId}/verification/selfie-${uniqueSuffix()}.${imageFileExtension(mimeType)}`;
  const { error } = await supabase.storage.from("photos").upload(filePath, blob, {
    contentType: mimeType,
    upsert: false,
  });
  if (error) throw error;
  return filePath;
}

export async function removeUnreferencedProfilePhotos(
  userId: string,
  candidatePaths: string[],
): Promise<void> {
  const authenticatedUserId = (await requireAuthenticatedUser(userId)).id;
  const candidates = [...new Set(candidatePaths)].filter(
    (path) =>
      path.startsWith(`${authenticatedUserId}/`) &&
      !path.includes("/verification/") &&
      !path.split("/").some((part) => !part || part === "." || part === ".."),
  );
  if (candidates.length === 0) return;

  const { data, error } = await supabase.rpc("get_my_photos");
  if (error) throw new Error(`Unable to check photo references before cleanup: ${error.message}`);
  const referenced = new Set<string>();
  if (Array.isArray(data)) {
    for (const photo of data as Array<{ path?: string; thumbPath?: string }>) {
      if (photo.path) referenced.add(photo.path);
      if (photo.thumbPath) referenced.add(photo.thumbPath);
    }
  }
  const removable = candidates.filter((path) => !referenced.has(path));
  if (removable.length === 0) return;

  const { error: removeError } = await supabase.storage.from("photos").remove(removable);
  if (removeError) throw new Error(`Unused profile photo cleanup failed: ${removeError.message}`);
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
