import { supabase } from "./supabase";

export async function blockUser(targetId: string): Promise<boolean> {
  try {
    const uid = (await supabase.auth.getUser()).data.user?.id;
    if (!uid) return false;

    // 1. Insert block
    await supabase.from("blocks").insert({
      blocker: uid,
      blocked: targetId,
    });

    // 2. Delete match if exists
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
): Promise<boolean> {
  try {
    const uid = (await supabase.auth.getUser()).data.user?.id;
    if (!uid) return false;

    const { error } = await supabase.from("reports").insert({
      reporter: uid,
      target: targetId,
      category: category.slice(0, 60),
      note: note.slice(0, 500),
      source,
      status: "open",
    });

    return !error;
  } catch {
    return false;
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
