// Phase 2: server-authoritative access to received likes. Reuses the existing Supabase client and
// signed-URL helper; liker identities are only ever returned by get_received_likes (premium-gated).
import { supabase } from "./supabase";
import { getSignedUrls } from "./storage";
import {
  isUpgradeRequiredError,
  parseLikesAccess,
  parseReceivedLikes,
  parseSentLikes,
  type LikesAccess,
  type ReceivedLike,
} from "./likesPolicy";
import type { Profile } from "../types";

export type ReceivedLikesResult =
  | { status: "ok"; profiles: Profile[] }
  | { status: "upgrade_required" }
  | { status: "error"; message: string };

export type SentLikesResult =
  | { status: "ok"; profiles: Profile[]; matchedIds: string[] }
  | { status: "upgrade_required" }
  | { status: "error"; message: string };

export function checkLikesAccessRaw() {
  return supabase.rpc("get_my_likes_access");
}

export async function fetchLikesAccess(): Promise<LikesAccess | null> {
  const { data, error } = await checkLikesAccessRaw();
  if (error) return null;
  return parseLikesAccess(data);
}

export async function fetchReceivedLikes(): Promise<ReceivedLikesResult> {
  try {
    const { data, error } = await supabase.rpc("get_received_likes", { _limit: 50 });
    if (error) {
      if (isUpgradeRequiredError(error)) return { status: "upgrade_required" };
      return { status: "error", message: "Could not load your likes. Please try again." };
    }
    const likes = parseReceivedLikes(data);
    const profiles = await toProfiles(likes, true);
    return { status: "ok", profiles };
  } catch {
    return { status: "error", message: "Could not load your likes. Please try again." };
  }
}

export async function fetchSentLikes(): Promise<SentLikesResult> {
  try {
    const { data, error } = await supabase.rpc("get_my_sent_likes", { _limit: 50 });
    if (error) {
      if (isUpgradeRequiredError(error)) return { status: "upgrade_required" };
      return { status: "error", message: "Could not load the profiles you liked. Please try again." };
    }
    const likes = parseSentLikes(data);
    const profiles = await toProfiles(likes, false);
    return { status: "ok", profiles, matchedIds: likes.filter((l) => l.isMatch).map((l) => l.id) };
  } catch {
    return { status: "error", message: "Could not load the profiles you liked. Please try again." };
  }
}

async function toProfiles(likes: ReceivedLike[], likesYou: boolean): Promise<Profile[]> {
  const signed = await getSignedUrls(
    "photos",
    likes.flatMap((l) => l.photoPaths),
  );
  return likes.map((l) => ({
    id: l.id,
    name: l.name,
    age: l.age ?? 0,
    city: l.city,
    distanceKm: null,
    bio: "",
    photos: l.photoPaths.map((p) => signed[p] || "").filter(Boolean),
    interests: [],
    intent: "",
    intents: [],
    languages: [],
    lastActiveMin: 0,
    likesYou,
    isDemo: false,
  })) as Profile[];
}
