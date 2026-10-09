import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/milo/SafetyDialogs";
import { ageFrom, hydrateStore, useMilo } from "@/lib/milo-store";
import { initCloud } from "@/lib/milo-cloud";
import { adminDeleteUser, adminOverview, adminSetReport, adminSetStatus, amIAdmin } from "@/lib/admin.functions";

const box = "rounded-2xl bg-card p-5 shadow-sm";
const btn = "rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-40";
const btn2 = "rounded-lg border bg-card px-3 py-1.5 text-sm font-semibold disabled:opacity-40";
const inp = "h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:border-primary";
const when = (t: string) => new Date(t).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

/** Signed-in admin check (server-verified). Renders children only for admins. */
export function AdminGate({ children }: { children: (admin: boolean) => React.ReactNode }) {
  useEffect(() => { hydrateStore(); initCloud(); }, []);
  const ready = useMilo((s) => s._hydrated && s.sessionReady);
  const loggedIn = useMilo((s) => s.loggedIn);
  const check = useServerFn(amIAdmin);
  const q = useQuery({ queryKey: ["am-i-admin", loggedIn], queryFn: () => check(), enabled: ready && loggedIn });
  if (!ready || (loggedIn && q.isLoading)) return <p className="p-10 text-center text-muted-foreground">Checking access…</p>;
  if (!loggedIn) return <div className={`${box} mx-auto mt-10 max-w-md text-center`}><h2 className="text-xl font-semibold">Admins only</h2><p className="mt-2 text-sm text-muted-foreground">Log in with an admin account to manage real members.</p><Link to="/login" className={`${btn} mt-4 inline-block`}>Log in</Link></div>;
  return <>{children(!!q.data?.admin)}</>;
}

function useOverview() {
  const fn = useServerFn(adminOverview);
  return useQuery({ queryKey: ["admin-overview"], queryFn: () => fn() });
}

export function LiveUsers() {
  const q = useOverview(); const qc = useQueryClient();
  const setStatus = useServerFn(adminSetStatus); const del = useServerFn(adminDeleteUser);
  const [find, setFind] = useState(""); const [note, setNote] = useState("");
  const [dlg, setDlg] = useState<null | { kind: "suspend" | "restore" | "delete"; id: string; name: string }>(null);
  if (q.isLoading) return <p className="text-muted-foreground">Loading members…</p>;
  if (q.error) return <p className="text-destructive">Couldn't load members.</p>;
  const users = (q.data?.users ?? []).filter((u) => `${u.name} ${u.email} ${u.city}`.toLowerCase().includes(find.toLowerCase()));
  const run = async () => {
    if (!dlg) return;
    try {
      if (dlg.kind === "delete") await del({ data: { id: dlg.id, note: note || "Removed by admin" } });
      else await setStatus({ data: { id: dlg.id, status: dlg.kind === "suspend" ? "suspended" : "active", note } });
      toast.success("Done. Saved to the audit log.");
      setNote(""); setDlg(null); void qc.invalidateQueries({ queryKey: ["admin-overview"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Action failed"); }
  };
  return (
    <div className="space-y-4">
      <input className={inp} placeholder="Search name, email or city" value={find} onChange={(e) => setFind(e.target.value)} />
      <p className="text-sm text-muted-foreground">{users.length} real member{users.length === 1 ? "" : "s"}. Sample profiles aren't listed.</p>
      {users.map((u) => (
        <div key={u.id} className={`${box} flex flex-wrap items-center gap-4`}>
          {u.photo ? <img src={u.photo} alt="" className="size-14 rounded-xl object-cover" /> : <div className="size-14 rounded-xl bg-muted" />}
          <div className="min-w-0 flex-1">
            <b>{u.name || "No name yet"}</b>{u.dob ? `, ${ageFrom(u.dob)}` : ""} <span className="text-sm text-muted-foreground">· {u.gender || "—"} · {u.city || "—"}</span>
            <p className="truncate text-sm text-muted-foreground">{u.email} {u.confirmed ? "" : "(email not confirmed)"}</p>
            <p className="text-xs text-muted-foreground">Joined {when(u.createdAt)} · Last active {when(u.lastActive)} · {u.onboarded ? "Profile complete" : "Setting up"}</p>
          </div>
          {u.openReports > 0 && <span className="rounded-full bg-destructive px-2 py-0.5 text-xs font-bold text-destructive-foreground">{u.openReports} open report{u.openReports > 1 ? "s" : ""}</span>}
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${u.status === "active" ? "bg-secondary text-secondary-foreground" : "bg-destructive text-destructive-foreground"}`}>{u.status}</span>
          {u.status === "active"
            ? <button className={btn2} onClick={() => setDlg({ kind: "suspend", id: u.id, name: u.name })}>Suspend</button>
            : <button className={btn2} onClick={() => setDlg({ kind: "restore", id: u.id, name: u.name })}>Restore</button>}
          <button className={`${btn2} text-destructive`} onClick={() => setDlg({ kind: "delete", id: u.id, name: u.name })}>Delete</button>
        </div>
      ))}
      <ConfirmDialog open={!!dlg} onOpenChange={(o) => !o && setDlg(null)}
        title={dlg?.kind === "delete" ? `Permanently delete ${dlg.name || "this account"}?` : dlg?.kind === "suspend" ? `Suspend ${dlg?.name || "this account"}?` : `Restore ${dlg?.name || "this account"}?`}
        body={dlg?.kind === "delete" ? "Removes their login, profile, photos, matches and chats. This can't be undone." : dlg?.kind === "suspend" ? "They disappear from Discover and can't send messages until restored." : "They'll be visible and able to message again."}
        confirm={dlg?.kind === "delete" ? "Delete permanently" : dlg?.kind === "suspend" ? "Suspend" : "Restore"} onConfirm={run} />
      {dlg && <div className="fixed inset-x-0 bottom-4 z-[60] mx-auto max-w-md"><input className={inp} placeholder="Reason (saved to audit log)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></div>}
    </div>
  );
}

export function LiveReports() {
  const q = useOverview(); const qc = useQueryClient(); const set = useServerFn(adminSetReport);
  const [filter, setFilter] = useState<"open" | "all">("open");
  if (q.isLoading) return <p className="text-muted-foreground">Loading reports…</p>;
  if (q.error) return <p className="text-destructive">Couldn't load reports.</p>;
  const list = (q.data?.reports ?? []).filter((r) => filter === "all" || r.status === "open");
  const act = async (id: string, status: "actioned" | "dismissed" | "open") => {
    try { await set({ data: { id, status, note: "" } }); toast.success(`Report ${status}`); void qc.invalidateQueries({ queryKey: ["admin-overview"] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Action failed"); }
  };
  return (
    <div className="space-y-4">
      <div className="flex gap-2"><button className={filter === "open" ? btn : btn2} onClick={() => setFilter("open")}>Open</button><button className={filter === "all" ? btn : btn2} onClick={() => setFilter("all")}>All</button></div>
      {list.length === 0 && <p className="text-muted-foreground">No reports here.</p>}
      {list.map((r) => (
        <div key={r.id} className={box}>
          <div className="flex flex-wrap items-center gap-2"><b>{r.category}</b><span className="text-sm text-muted-foreground">about {r.targetName} · from {r.reporterName} · via {r.source} · {when(r.created_at)}</span><span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs font-bold">{r.status}</span></div>
          {r.note && <p className="mt-2 text-sm">"{r.note}"</p>}
          <div className="mt-3 flex gap-2">
            {r.status !== "actioned" && <button className={btn} onClick={() => act(r.id, "actioned")}>Mark actioned</button>}
            {r.status !== "dismissed" && <button className={btn2} onClick={() => act(r.id, "dismissed")}>Dismiss</button>}
            {r.status !== "open" && <button className={btn2} onClick={() => act(r.id, "open")}>Reopen</button>}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">To suspend or delete the member, use Live members. Reports are review signals, never automatic bans.</p>
        </div>
      ))}
    </div>
  );
}

export function LiveAudit() {
  const q = useOverview();
  if (q.isLoading) return <p className="text-muted-foreground">Loading…</p>;
  return <div className={`${box} space-y-2`}>{(q.data?.audit ?? []).length === 0 ? <p className="text-muted-foreground">No admin actions yet.</p> : q.data!.audit.map((a) => <p key={a.id} className="text-sm"><span className="text-muted-foreground">{when(a.created_at)}</span> · <b>{a.action}</b> {a.targetName && `· ${a.targetName}`} {a.note && <span className="text-muted-foreground">· "{a.note}"</span>}</p>)}</div>;
}
