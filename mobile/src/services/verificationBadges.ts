// Public "Verified" badges. The verification status itself is private (account_state); the server returns only
// which of the given, visible profiles have an approved selfie verification (get_verified_profile_ids,
// 20260101006100). Never throws: a failed lookup simply shows no badges.
import { supabase, isSupabaseConfigured } from "./supabase";

export async function fetchVerifiedIds(profileIds: string[]): Promise<Set<string>> {
  const ids = Array.from(new Set(profileIds.filter((id) => typeof id === "string" && id.length > 0))).slice(0, 100);
  if (ids.length === 0 || !isSupabaseConfigured()) return new Set();
  try {
    const { data, error } = await supabase.rpc("get_verified_profile_ids", { _ids: ids });
    if (error || !Array.isArray(data)) return new Set();
    return new Set(
      data
        .map((row: unknown) => (typeof row === "string" ? row : (row as Record<string, unknown>)?.get_verified_profile_ids))
        .filter((id): id is string => typeof id === "string" && ids.includes(id)),
    );
  } catch {
    return new Set();
  }
}
