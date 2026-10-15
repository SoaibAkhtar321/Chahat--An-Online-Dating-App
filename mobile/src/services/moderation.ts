import { supabase } from "./supabase";

export async function blockUser(targetId: string): Promise<boolean> {
  try {
    const uid = (await supabase.auth.getUser()).data.user?.id;
    if (!uid) return false;

    // 1. Insert block (triggers automatic server-side on_block_cleanup of matches/swipes)
    const { error: blockErr } = await supabase.from("blocks").insert({
      blocker: uid,
      blocked: targetId,
    });
    if (blockErr) {
      console.warn("blockUser: block insertion failed", blockErr.message);
      return false;
    }

    // 2. Client-side match cleanup (defense-in-depth)
    await supabase
      .from("matches")
      .delete()
      .or(
        `and(user_a.eq.${uid},user_b.eq.${targetId}),and(user_a.eq.${targetId},user_b.eq.${uid})`,
      );

    return true;
  } catch {
    return false;
  }
}

export async function unblockUser(targetId: string): Promise<boolean> {
  try {
    const uid = (await supabase.auth.getUser()).data.user?.id;
    if (!uid) return false;

    const { error } = await supabase
      .from("blocks")
      .delete()
      .eq("blocker", uid)
      .eq("blocked", targetId);

    return !error;
  } catch {
    return false;
  }
}

export async function reportUser(
  targetId: string,
  category: string,
  note: string,
  source: "profile" | "chat" | "call" = "profile",
): Promise<{ success: boolean; error?: string }> {
  try {
    const uid = (await supabase.auth.getUser()).data.user?.id;
    if (!uid) return { success: false, error: "Authentication required" };

    const { error } = await supabase.from("reports").insert({
      reporter: uid,
      target: targetId,
      category: category.slice(0, 60),
      note: note.slice(0, 500),
      source,
      status: "open",
    });

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || "Failed to submit report" };
  }
}

export async function unmatchUser(matchId: string): Promise<boolean> {
  try {
    const { error } = await supabase.from("matches").delete().eq("id", matchId);
    return !error;
  } catch {
    return false;
  }
}
