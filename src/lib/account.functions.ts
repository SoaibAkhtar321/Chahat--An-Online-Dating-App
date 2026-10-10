import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Permanently deletes the signed-in member: photos, Likes, Matches (and their chats), blocks, private state, then the login. Reports they filed are kept for safety review. */
export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const uid = context.userId;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: files } = await supabaseAdmin.storage.from("photos").list(uid, { limit: 100 });
    if (files?.length)
      await supabaseAdmin.storage.from("photos").remove(files.map((f) => `${uid}/${f.name}`));
    await supabaseAdmin.from("matches").delete().or(`user_a.eq.${uid},user_b.eq.${uid}`);
    await supabaseAdmin.from("swipes").delete().or(`from_id.eq.${uid},to_id.eq.${uid}`);
    await supabaseAdmin.from("blocks").delete().or(`blocker.eq.${uid},blocked.eq.${uid}`);
    await supabaseAdmin.from("account_state").delete().eq("user_id", uid);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(uid);
    if (error) {
      console.error(error);
      throw new Error("Couldn't delete the account. Please try again.");
    }
    return { ok: true };
  });
