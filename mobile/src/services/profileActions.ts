// What the signed-in member may do on a profile they are viewing. The server decides (get_profile_actions);
// the profile screen only shows the matching buttons. record_swipe still enforces the rules on every like.
import { isSupabaseConfigured, supabase } from "./supabase";

export type ProfileActionReason = "matched" | "already_liked" | "preferences_dont_match" | null;

export interface ProfileActions {
  available: boolean;
  self: boolean;
  matchId: string | null;
  canLike: boolean;
  reason: ProfileActionReason;
  yourPreference: "man" | "woman" | null;
}

const UNKNOWN: ProfileActions = {
  available: false,
  self: false,
  matchId: null,
  canLike: false,
  reason: null,
  yourPreference: null,
};

export function parseProfileActions(data: any): ProfileActions {
  if (!data || typeof data !== "object") return UNKNOWN;
  const reason = ["matched", "already_liked", "preferences_dont_match"].includes(data.reason) ? data.reason : null;
  return {
    available: data.available === true,
    self: data.self === true,
    matchId: typeof data.match_id === "string" ? data.match_id : null,
    canLike: data.can_like === true,
    reason,
    yourPreference: data.your_preference === "man" || data.your_preference === "woman" ? data.your_preference : null,
  };
}

export async function getProfileActions(profileId: string): Promise<ProfileActions> {
  if (!isSupabaseConfigured()) return UNKNOWN;
  try {
    const { data, error } = await supabase.rpc("get_profile_actions", { _id: profileId });
    if (error) return UNKNOWN;
    return parseProfileActions(data);
  } catch {
    return UNKNOWN;
  }
}

/** Short explanation shown instead of the Like button. */
export function profileActionNote(actions: ProfileActions, name: string): string | null {
  if (actions.reason === "already_liked") return `You liked ${name}. If they like you back, it's a match.`;
  if (actions.reason === "preferences_dont_match") {
    const pref = actions.yourPreference === "woman" ? "women" : actions.yourPreference === "man" ? "men" : null;
    return pref
      ? `You can't like this profile: your match preferences (looking for ${pref}) and theirs don't fit. You can still view and share it.`
      : "You can't like this profile because your match preferences and theirs don't fit. You can still view and share it.";
  }
  return null;
}
