import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Ctx = { supabase: { rpc: (fn: "has_role", args: { _user_id: string; _role: "admin" }) => PromiseLike<{ data: boolean | null }> }; userId: string };

/** Every admin action re-checks the caller's role on the server (user_roles table). */
async function assertAdmin(context: Ctx) {
  const { data } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (!data) throw new Error("Not authorized");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export const amIAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    return { admin: !!data };
  });

export const adminOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await assertAdmin(context as unknown as Ctx);
    const [profiles, reports, audit, users] = await Promise.all([
      db.from("profiles").select("id,name,dob,gender,city,status,onboarded,created_at,last_active,photos").eq("is_demo", false).order("created_at", { ascending: false }).limit(500),
      db.from("reports").select("*").order("created_at", { ascending: false }).limit(300),
      db.from("admin_audit").select("*").order("created_at", { ascending: false }).limit(100),
      db.auth.admin.listUsers({ perPage: 1000 }),
    ]);
    const emails = new Map((users.data?.users ?? []).map((u) => [u.id, { email: u.email ?? "", confirmed: !!u.email_confirmed_at }]));
    const thumbs = (profiles.data ?? []).map((p) => (Array.isArray(p.photos) ? (p.photos[0] as { thumbPath?: string } | undefined)?.thumbPath : undefined)).filter((x): x is string => !!x);
    const signed = thumbs.length ? (await db.storage.from("photos").createSignedUrls(thumbs, 3600)).data ?? [] : [];
    const urlOf = new Map(signed.map((s) => [s.path, s.signedUrl]));
    const names = new Map((profiles.data ?? []).map((p) => [p.id, p.name || "Unnamed"]));
    const reportCount = new Map<string, number>();
    for (const r of reports.data ?? []) if (r.status === "open") reportCount.set(r.target, (reportCount.get(r.target) ?? 0) + 1);
    return {
      users: (profiles.data ?? []).map((p) => {
        const t = Array.isArray(p.photos) ? (p.photos[0] as { thumbPath?: string } | undefined)?.thumbPath : undefined;
        return { id: p.id, name: p.name, dob: p.dob, gender: p.gender, city: p.city, status: p.status, onboarded: p.onboarded,
          createdAt: p.created_at, lastActive: p.last_active, email: emails.get(p.id)?.email ?? "", confirmed: emails.get(p.id)?.confirmed ?? false,
          photo: t ? urlOf.get(t) ?? null : null, openReports: reportCount.get(p.id) ?? 0 };
      }),
      reports: (reports.data ?? []).map((r) => ({ ...r, reporterName: names.get(r.reporter) ?? r.reporter, targetName: names.get(r.target) ?? `${r.target} (sample profile)` })),
      audit: (audit.data ?? []).map((a) => ({ ...a, targetName: a.target ? names.get(a.target) ?? a.target : "" })),
    };
  });

export const adminSetStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), status: z.enum(["active", "suspended"]), note: z.string().max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const db = await assertAdmin(context as unknown as Ctx);
    if (data.id === context.userId) throw new Error("You can't suspend your own account");
    const { error } = await db.from("profiles").update({ status: data.status }).eq("id", data.id).eq("is_demo", false);
    if (error) throw new Error("Couldn't update the account");
    await db.from("admin_audit").insert({ admin_id: context.userId, action: data.status === "suspended" ? "Suspended account" : "Restored account", target: data.id, note: data.note });
    return { ok: true };
  });

export const adminSetReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), status: z.enum(["open", "actioned", "dismissed"]), note: z.string().max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const db = await assertAdmin(context as unknown as Ctx);
    const { data: r, error } = await db.from("reports").update({ status: data.status }).eq("id", data.id).select("target").maybeSingle();
    if (error || !r) throw new Error("Couldn't update the report");
    await db.from("admin_audit").insert({ admin_id: context.userId, action: `Report marked ${data.status}`, target: r.target, note: data.note });
    return { ok: true };
  });

export const adminDeleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), note: z.string().min(1).max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const db = await assertAdmin(context as unknown as Ctx);
    if (data.id === context.userId) throw new Error("Delete your own account from Settings instead");
    const uid = data.id;
    const { data: files } = await db.storage.from("photos").list(uid, { limit: 100 });
    if (files?.length) await db.storage.from("photos").remove(files.map((f) => `${uid}/${f.name}`));
    await db.from("matches").delete().or(`user_a.eq.${uid},user_b.eq.${uid}`);
    await db.from("swipes").delete().or(`from_id.eq.${uid},to_id.eq.${uid}`);
    await db.from("blocks").delete().or(`blocker.eq.${uid},blocked.eq.${uid}`);
    await db.from("account_state").delete().eq("user_id", uid);
    const { error } = await db.auth.admin.deleteUser(uid);
    if (error) throw new Error("Couldn't delete the account");
    await db.from("admin_audit").insert({ admin_id: context.userId, action: "Deleted account", target: uid, note: data.note });
    return { ok: true };
  });
