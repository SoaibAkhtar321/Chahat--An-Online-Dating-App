import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Logo } from "@/components/milo/Phone";
import { ConfirmDialog } from "@/components/milo/SafetyDialogs";
import { AdminGate, LiveAudit, LiveReports, LiveUsers } from "@/components/milo/LiveAdmin";
import {
  PROFILES,
  ENTS,
  TIER_NAMES,
  accountData,
  adminDeleteAccount,
  audit,
  hydrateStore,
  notify,
  setPhotoStatus,
  setState,
  updateAccount,
  useMilo,
  uid,
  type PriceRow,
  type FreeRule,
  type PaidRule,
  type Ent,
  type Tier,
  type PlanCfg,
  type Report,
} from "@/lib/milo-store";
import { riskSignals } from "@/lib/risk";
import { meta } from "@/lib/meta";

export const Route = createFileRoute("/admin")({
  head: () => meta("Admin", "Milo moderation, users, plans and call pricing (demo)."),
  component: Admin,
});

const box = "rounded-2xl bg-card p-5 shadow-sm";
const inp =
  "h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:border-primary";
const btn =
  "rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-40";
const btn2 = "rounded-lg border bg-card px-3 py-1.5 text-sm font-semibold disabled:opacity-40";
const pend = "rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-accent-foreground";
const Pending = () => <span className={pend}>Pending client approval</span>;
const TABS: [string, string][] = [
  ["live-users", "Live members"],
  ["live-reports", "Live reports"],
  ["live-audit", "Admin log"],
  ["overview", "Overview (demo)"],
  ["users", "Users (demo)"],
  ["reports", "Reports (demo)"],
  ["verification", "Verification"],
  ["photos", "Photos"],
  ["plans", "Plans"],
  ["pricing", "Call pricing"],
  ["rules", "Rules"],
  ["purchases", "Purchases"],
  ["announcements", "Announcements"],
  ["notify", "Notifications"],
  ["audit", "Audit log (demo)"],
];

function Admin() {
  useEffect(() => hydrateStore(), []);
  return (
    <div className="min-h-screen bg-background">
      <header className="flex flex-wrap items-center gap-4 border-b bg-card px-6 py-4">
        <Link to="/me" aria-label="Back to app">
          <ArrowLeft className="size-5" />
        </Link>
        <Logo className="text-2xl" />
        <span className="font-semibold text-muted-foreground">Admin</span>
        <span className="ml-auto flex items-center gap-2 rounded-full bg-accent px-3 py-1 text-xs font-bold text-accent-foreground">
          <ShieldAlert className="size-4" /> Admins only. "Live" tabs act on real accounts; other
          tabs are browser-only demos.
        </span>
      </header>
      <main className="mx-auto max-w-6xl p-6">
        <AdminGate>
          {(isAdmin) =>
            !isAdmin ? (
              <div className="mx-auto mt-10 max-w-md rounded-2xl bg-card p-6 text-center shadow-sm">
                <h2 className="text-xl font-semibold">Not authorized</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  This account doesn't have admin access. Ask the app owner to grant it.
                </p>
              </div>
            ) : (
              <Tabs defaultValue="live-users">
                <TabsList className="mb-6 h-auto flex-wrap">
                  {TABS.map(([v, l]) => (
                    <TabsTrigger key={v} value={v}>
                      {l}
                    </TabsTrigger>
                  ))}
                </TabsList>
                <TabsContent value="live-users">
                  <LiveUsers />
                </TabsContent>
                <TabsContent value="live-reports">
                  <LiveReports />
                </TabsContent>
                <TabsContent value="live-audit">
                  <LiveAudit />
                </TabsContent>
                <TabsContent value="overview">
                  <Overview />
                </TabsContent>
                <TabsContent value="users">
                  <Users />
                </TabsContent>
                <TabsContent value="reports">
                  <Reports />
                </TabsContent>
                <TabsContent value="verification">
                  <Verification />
                </TabsContent>
                <TabsContent value="photos">
                  <Photos />
                </TabsContent>
                <TabsContent value="plans">
                  <Plans />
                </TabsContent>
                <TabsContent value="pricing">
                  <Pricing />
                </TabsContent>
                <TabsContent value="rules">
                  <Rules />
                </TabsContent>
                <TabsContent value="purchases">
                  <Purchases />
                </TabsContent>
                <TabsContent value="announcements">
                  <Announcements />
                </TabsContent>
                <TabsContent value="notify">
                  <Notify />
                </TabsContent>
                <TabsContent value="audit">
                  <Audit />
                </TabsContent>
              </Tabs>
            )
          }
        </AdminGate>
      </main>
    </div>
  );
}

/** All demo accounts in this browser with their (live, if signed in) data. */
function useAccounts() {
  const s = useMilo((x) => x);
  return Object.entries(s.accounts).map(([email, a]) => ({
    email,
    acc: a,
    d: accountData(email) ?? {},
  }));
}

function Overview() {
  const s = useMilo((x) => x);
  const accts = useAccounts();
  const week = Date.now() - 7 * 864e5;
  const sum = (f: (d: ReturnType<typeof useAccounts>[number]["d"]) => number) =>
    accts.reduce((n, a) => n + f(a.d), 0);
  const swipes = accts.flatMap((a) => Object.values(a.d.swiped ?? {}));
  const stats: [string, number | string][] = [
    ["Demo accounts", accts.length],
    ["New in last 7 days", accts.filter((a) => (a.acc.createdAt ?? 0) > week).length],
    ["Completed profiles", accts.filter((a) => a.d.onboarded).length],
    ["Sample profiles", PROFILES.length],
    ["Matches (all accounts)", sum((d) => d.matches?.length ?? 0)],
    [
      "Messages sent",
      sum(
        (d) =>
          Object.values(d.messages ?? {})
            .flat()
            .filter((m) => m.from === "me").length,
      ),
    ],
    [
      "Likes / passes",
      `${swipes.filter((x) => x === "like").length} / ${swipes.filter((x) => x === "pass").length}`,
    ],
    ["Open reports", s.reports.filter((r) => r.status === "open").length],
    ["Active test subscriptions", accts.filter((a) => a.d.premium?.active).length],
    ["Calls logged", sum((d) => d.calls?.length ?? 0)],
    ["Verification requests", accts.filter((a) => a.d.verification?.status === "pending").length],
    ["Suspended / deleted", `${s.suspended.length - s.deleted.length} / ${s.deleted.length}`],
  ];
  return (
    <div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map(([k, v]) => (
          <div key={k} className={box}>
            <p className="text-sm text-muted-foreground">{k}</p>
            <p className="font-display text-3xl font-semibold">{v}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-sm text-muted-foreground">
        Computed from this browser's demo data only. Not real product metrics.
      </p>
    </div>
  );
}

function Users() {
  const s = useMilo((x) => x);
  const accts = useAccounts();
  const [q, setQ] = useState("");
  const [inspect, setInspect] = useState("");
  const [del, setDel] = useState<{ kind: "sample" | "account"; id: string; name: string } | null>(
    null,
  );
  const openReports = (id: string) =>
    s.reports.filter((r) => r.targetId === id && r.status === "open").length;
  const match = (t: string) => t.toLowerCase().includes(q.toLowerCase());
  const toggle = (id: string, name: string) => {
    const on = s.suspended.includes(id);
    setState((x) => ({
      suspended: on ? x.suspended.filter((y) => y !== id) : [...x.suspended, id],
      deleted: on ? x.deleted.filter((y) => y !== id) : x.deleted,
    }));
    audit(`${on ? "Restored" : "Suspended"} user ${name}`);
    toast(`${name} ${on ? "restored" : "suspended"} (demo)`);
  };
  const doDelete = () => {
    if (!del) return;
    if (del.kind === "sample") {
      setState((x) => ({
        deleted: [...new Set([...x.deleted, del.id])],
        suspended: [...new Set([...x.suspended, del.id])],
      }));
    } else adminDeleteAccount(del.id);
    audit(`Deleted ${del.kind === "sample" ? "sample profile" : "account"} ${del.name}`);
    toast(`${del.name} deleted (demo)`);
  };
  const ins = accts.find((a) => a.email === inspect);
  return (
    <div className="space-y-4">
      <input
        className={`${inp} max-w-sm`}
        placeholder="Search by name, city or email"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search users"
      />
      <div className={box}>
        <h2 className="mb-2 font-semibold">Demo accounts (signed up in this browser)</h2>
        {accts.filter((a) => match(`${a.email} ${a.d.me?.name ?? ""}`)).length === 0 ? (
          <p className="text-sm text-muted-foreground">No accounts found.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-2">Account</th>
                <th>Profile</th>
                <th>Plan</th>
                <th>Review signals</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {accts
                .filter((a) => match(`${a.email} ${a.d.me?.name ?? ""}`))
                .map((a) => {
                  const sig = riskSignals({
                    bio: a.d.me?.bio ?? "",
                    photos: a.d.me?.photos?.length ?? 0,
                    openReports: 0,
                    ...(a.acc.createdAt ? { createdAt: a.acc.createdAt } : {}),
                    texts: Object.values(a.d.messages ?? {})
                      .flat()
                      .filter((m) => m.from === "me")
                      .map((m) => m.text),
                  });
                  return (
                    <tr key={a.email} className="border-t align-top">
                      <td className="py-2">
                        {a.email}
                        {s.account?.email === a.email && s.loggedIn && (
                          <span className="ml-1 text-xs text-success">(signed in)</span>
                        )}
                      </td>
                      <td>
                        {a.d.me?.name || "—"}
                        {a.d.onboarded ? "" : " · setup incomplete"}
                      </td>
                      <td>
                        {a.d.premium?.active ? TIER_NAMES[a.d.premium.tier ?? "plus"] : "Free"}
                      </td>
                      <td className="text-xs">{sig.length ? sig.join(" · ") : "None"}</td>
                      <td className="space-x-2 whitespace-nowrap text-right">
                        <button
                          className={btn2}
                          onClick={() => setInspect(inspect === a.email ? "" : a.email)}
                        >
                          {inspect === a.email ? "Close" : "Inspect"}
                        </button>
                        <button
                          className={btn2}
                          onClick={() => setDel({ kind: "account", id: a.email, name: a.email })}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        )}
        {ins && (
          <div className="mt-4 rounded-xl border p-4 text-sm">
            <p className="font-semibold">
              {ins.d.me?.name || "No name"} · {ins.email}
            </p>
            <p className="text-muted-foreground">
              Intentions: {ins.d.me?.intents?.join(", ") || "—"} · City: {ins.d.me?.city || "—"} ·
              Languages: {ins.d.me?.languages?.join(", ") || "—"}
            </p>
            <p className="text-muted-foreground">
              Interests: {ins.d.me?.interests?.join(", ") || "—"}
            </p>
            <p className="mt-1">{ins.d.me?.bio || "No bio"}</p>
            <p className="mt-1 text-muted-foreground">
              Photos: {ins.d.me?.photos?.length ?? 0} · Voice intro:{" "}
              {ins.d.me?.voice ? "yes" : "no"} · Verification:{" "}
              {ins.d.verification?.status ?? "none"} · Matches: {ins.d.matches?.length ?? 0} ·
              Blocked: {ins.d.blocked?.length ?? 0}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Passwords are never shown (stored only as a demo hash).
            </p>
          </div>
        )}
      </div>
      <div className={box}>
        <h2 className="mb-2 font-semibold">Sample profiles</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-2">User</th>
              <th>City</th>
              <th>Intent</th>
              <th>Review signals</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {PROFILES.filter((p) => match(`${p.name} ${p.city}`)).map((p) => {
              const sig = riskSignals({
                bio: p.bio,
                photos: p.photos.length,
                openReports: openReports(p.id),
              });
              const deleted = s.deleted.includes(p.id),
                susp = s.suspended.includes(p.id);
              return (
                <tr key={p.id} className="border-t">
                  <td className="flex items-center gap-2 py-2">
                    <img src={p.photos[0]} alt="" className="size-8 rounded-full object-cover" />
                    {p.name}, {p.age}
                  </td>
                  <td>{p.city}</td>
                  <td>{p.intent}</td>
                  <td className="text-xs">{sig.length ? sig.join(" · ") : "None"}</td>
                  <td>
                    {deleted ? (
                      <span className="font-semibold text-destructive">Deleted</span>
                    ) : susp ? (
                      <span className="font-semibold text-destructive">Suspended</span>
                    ) : (
                      <span className="text-success">Active</span>
                    )}
                  </td>
                  <td className="space-x-2 whitespace-nowrap text-right">
                    <button className={susp ? btn2 : btn} onClick={() => toggle(p.id, p.name)}>
                      {susp ? "Restore" : "Suspend"}
                    </button>
                    {!deleted && (
                      <button
                        className={btn2}
                        onClick={() => setDel({ kind: "sample", id: p.id, name: p.name })}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted-foreground">
          Review signals are simple rules to help prioritise review. They are not proof and never
          trigger automatic action.
        </p>
      </div>
      <ConfirmDialog
        open={!!del}
        onOpenChange={(o) => !o && setDel(null)}
        danger
        title={`Delete ${del?.name}?`}
        body={
          del?.kind === "account"
            ? "Removes this demo account and its data from this browser. This can't be undone."
            : "Hides this sample profile from discovery, matches and chat. You can restore it later."
        }
        confirm="Delete"
        onConfirm={doDelete}
      />
    </div>
  );
}

function Reports() {
  const reports = useMilo((s) => s.reports);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const act = (r: Report, status: Report["status"], suspend: boolean) => {
    const at = Date.now();
    const label =
      status === "dismissed"
        ? "Dismissed"
        : suspend
          ? "Actioned: user suspended"
          : "Actioned: warning recorded";
    setState((s) => ({
      reports: s.reports.map((x) =>
        x.id === r.id
          ? { ...x, status, history: [...(x.history ?? []), { at, action: label }] }
          : x,
      ),
      suspended:
        suspend && PROFILES.some((p) => p.id === r.targetId)
          ? [...new Set([...s.suspended, r.targetId])]
          : s.suspended,
    }));
    if (r.by)
      updateAccount(r.by, (d) => ({
        notices: [
          {
            id: uid(),
            kind: "safety" as const,
            text: `Update on your report: ${status === "dismissed" ? "reviewed, no action taken" : "action was taken"}. Thank you.`,
            at,
            read: false,
            link: "/safety",
          },
          ...d.notices,
        ],
      }));
    audit(`Report ${r.id}: ${label}`);
  };
  const reopen = (r: Report) => {
    setState((s) => ({
      reports: s.reports.map((x) =>
        x.id === r.id
          ? {
              ...x,
              status: "open",
              history: [...(x.history ?? []), { at: Date.now(), action: "Reopened" }],
            }
          : x,
      ),
    }));
    audit(`Report ${r.id} reopened`);
  };
  const list = reports.filter((r) => filter === "all" || r.status === "open");
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button className={filter === "open" ? btn : btn2} onClick={() => setFilter("open")}>
          Open ({reports.filter((r) => r.status === "open").length})
        </button>
        <button className={filter === "all" ? btn : btn2} onClick={() => setFilter("all")}>
          All ({reports.length})
        </button>
      </div>
      {list.length === 0 && (
        <p className={box}>{filter === "open" ? "No open reports." : "No reports yet."}</p>
      )}
      {list.map((r) => (
        <div key={r.id} className={`${box} flex flex-wrap items-start gap-4`}>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              {r.category}{" "}
              <span className="font-normal text-muted-foreground">
                · about {PROFILES.find((p) => p.id === r.targetId)?.name ?? r.targetId} · from{" "}
                {r.source ?? "profile"}
                {r.by ? ` · by ${r.by}` : ""}
              </span>
            </p>
            <p className="text-sm text-muted-foreground">
              {r.note || "No details given"} · {new Date(r.at).toLocaleString()}
            </p>
            {r.history?.length ? (
              <ul className="mt-1 text-xs text-muted-foreground">
                {r.history.map((h) => (
                  <li key={h.at + h.action}>
                    {new Date(h.at).toLocaleString()} · {h.action}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          {r.status === "open" ? (
            <div className="flex flex-wrap gap-2">
              <button className={btn} onClick={() => act(r, "actioned", true)}>
                Suspend user
              </button>
              <button className={btn2} onClick={() => act(r, "actioned", false)}>
                Warn only
              </button>
              <button className={btn2} onClick={() => act(r, "dismissed", false)}>
                Dismiss
              </button>
            </div>
          ) : (
            <div className="text-right">
              <span className="block text-sm font-semibold capitalize text-muted-foreground">
                {r.status}
              </span>
              <button className="text-xs font-semibold text-primary" onClick={() => reopen(r)}>
                Reopen
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Verification() {
  const accts = useAccounts();
  const [note, setNote] = useState("");
  const decide = (email: string, ok: boolean) => {
    updateAccount(email, (d) => ({
      verification: {
        ...d.verification,
        status: ok ? "approved" : "rejected",
        ...(ok
          ? {}
          : { note: note.trim() || "The selfie didn't clearly match the pose or profile photos." }),
      },
      notices: [
        {
          id: uid(),
          kind: "safety" as const,
          text: ok
            ? "Your profile verification was approved (demo)"
            : "Your verification wasn't approved. You can try again.",
          at: Date.now(),
          read: false,
          link: "/me",
        },
        ...d.notices,
      ],
    }));
    audit(`Verification ${ok ? "approved" : "rejected"} for ${email}`);
    setNote("");
    toast(`Verification ${ok ? "approved" : "rejected"}`);
  };
  const rows = accts.filter((a) => a.d.verification && a.d.verification.status !== "none");
  return (
    <div className={`${box} space-y-3`}>
      <p className="text-sm text-muted-foreground">
        Compare the selfie with the account's photos and the requested pose ("two fingers next to
        the face"). Demo: no automated face matching. A badge appears only after approval here.
      </p>
      {rows.length === 0 && <p className="text-muted-foreground">No verification requests.</p>}
      {rows.map((a) => (
        <div key={a.email} className="flex flex-wrap items-center gap-4 border-t pt-3">
          {a.d.verification?.selfie && (
            <img
              src={a.d.verification.selfie}
              alt="Selfie"
              className="size-20 rounded-xl object-cover"
            />
          )}
          <div className="flex gap-1">
            {(a.d.me?.photos ?? []).slice(0, 3).map((p) => (
              <img key={p.id} src={p.thumb} alt="" className="size-14 rounded-lg object-cover" />
            ))}
          </div>
          <div className="flex-1 text-sm">
            <b>{a.d.me?.name || a.email}</b>
            <p className="capitalize text-muted-foreground">{a.d.verification?.status}</p>
          </div>
          {a.d.verification?.status === "pending" && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                className={`${inp} w-56`}
                placeholder="Rejection reason (optional)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <button className={btn} onClick={() => decide(a.email, true)}>
                Approve
              </button>
              <button className={btn2} onClick={() => decide(a.email, false)}>
                Reject
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Photos() {
  const photos = useMilo((s) => s.me.photos);
  const signedIn = useMilo((s) => s.loggedIn);
  const decide = (id: string, v: "approved" | "rejected") => {
    setPhotoStatus(id, v);
    audit(`Photo ${v}`);
  };
  return (
    <div className={box}>
      <p className="mb-4 text-sm text-muted-foreground">
        Photos of the signed-in demo account. Decisions show on that user's photo grid. No real
        moderation happens.
      </p>
      {!signedIn && (
        <p className="text-muted-foreground">Sign in to a demo account to review its photos.</p>
      )}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {signedIn &&
          photos.map((p) => (
            <div key={p.id} className="overflow-hidden rounded-xl border">
              <img src={p.thumb} alt="" className="aspect-[3/4] w-full object-cover" />
              <div className="flex flex-wrap items-center justify-between gap-1 p-2">
                <span className="text-xs font-semibold capitalize">
                  {p.status} · {p.w}×{p.h}
                  {p.kb ? ` · ${p.kb} KB` : ""}
                </span>
                {p.status === "pending" && (
                  <>
                    <button className={btn} onClick={() => decide(p.id, "approved")}>
                      Approve
                    </button>
                    <button className={btn2} onClick={() => decide(p.id, "rejected")}>
                      Reject
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

function Plans() {
  const plans = useMilo((s) => s.plans);
  const packs = useMilo((s) => s.packs);
  const upd = (t: Tier, p: Partial<PlanCfg>, what: string) => {
    setState((s) => ({ plans: { ...s.plans, [t]: { ...s.plans[t], ...p } } }));
    audit(`${TIER_NAMES[t]}: ${what}`);
  };
  const flip = (t: Tier, e: Ent) => {
    const has = plans[t].features.includes(e);
    upd(
      t,
      { features: has ? plans[t].features.filter((x) => x !== e) : [...plans[t].features, e] },
      `${has ? "removed" : "added"} ${ENTS[e]}`,
    );
  };
  const num = (v: string) => (v === "" ? null : Math.max(0, Number(v)));
  return (
    <div className="space-y-4">
      <div className={box}>
        <h2 className="font-semibold">Plan features switchboard</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          This is the single source of truth: every feature gate in the app reads this table.
          Matching, chat and safety tools are always free and aren't listed. Ad-free only matters if
          ads are ever enabled (they aren't).
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-2">Feature</th>
                {(["free", "plus", "pro"] as Tier[]).map((t) => (
                  <th key={t} className="text-center">
                    {TIER_NAMES[t]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(Object.keys(ENTS) as Ent[]).map((e) => (
                <tr key={e} className="border-t">
                  <td className="py-2">{ENTS[e]}</td>
                  {(["free", "plus", "pro"] as Tier[]).map((t) => (
                    <td key={t} className="text-center">
                      <input
                        type="checkbox"
                        aria-label={`${ENTS[e]} in ${TIER_NAMES[t]}`}
                        className="size-4 accent-primary"
                        checked={plans[t].features.includes(e)}
                        onChange={() => flip(t, e)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {(["plus", "pro"] as const).map((t) => (
          <div key={t} className={`${box} space-y-3`}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{TIER_NAMES[t]}</h2>
              {!plans[t].approved && <Pending />}
            </div>
            <label className="block text-sm font-semibold">
              Price
              <input
                className={inp}
                type="number"
                min={0}
                step="1"
                placeholder="Not set"
                value={plans[t].price ?? ""}
                onChange={(e) =>
                  upd(t, { price: num(e.target.value) }, `price → ${e.target.value || "unset"}`)
                }
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm font-semibold">
                Currency
                <input
                  className={inp}
                  value={plans[t].currency}
                  onChange={(e) =>
                    upd(t, { currency: e.target.value.toUpperCase().slice(0, 3) }, "currency")
                  }
                />
              </label>
              <label className="text-sm font-semibold">
                Billing period
                <select
                  className={inp}
                  value={plans[t].period}
                  onChange={(e) => upd(t, { period: e.target.value }, `period → ${e.target.value}`)}
                >
                  {["1 week", "1 month", "3 months", "6 months", "12 months"].map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={plans[t].visible}
                onChange={(e) =>
                  upd(t, { visible: e.target.checked }, e.target.checked ? "shown" : "hidden")
                }
              />{" "}
              Show on Premium screen
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={plans[t].approved}
                onChange={(e) =>
                  upd(
                    t,
                    { approved: e.target.checked },
                    e.target.checked ? "marked approved" : "marked pending",
                  )
                }
              />{" "}
              Client has approved contents & price
            </label>
          </div>
        ))}
      </div>
      <div className={box}>
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">One-time packs</h2>
          <Pending />
        </div>
        {packs.map((p, i) => (
          <div
            key={p.id}
            className="mt-2 grid grid-cols-[1fr_100px_120px_auto] items-center gap-2 text-sm"
          >
            <span>{p.name}</span>
            <input
              className={inp}
              type="number"
              min={1}
              value={p.qty}
              aria-label={`${p.name} quantity`}
              onChange={(e) =>
                setState((s) => ({
                  packs: s.packs.map((x, k) =>
                    k === i ? { ...x, qty: Math.max(1, +e.target.value || 1) } : x,
                  ),
                }))
              }
            />
            <input
              className={inp}
              type="number"
              min={0}
              placeholder="Price not set"
              aria-label={`${p.name} price`}
              value={p.price ?? ""}
              onChange={(e) =>
                setState((s) => ({
                  packs: s.packs.map((x, k) =>
                    k === i ? { ...x, price: num(e.target.value) } : x,
                  ),
                }))
              }
            />
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                className="accent-primary"
                checked={p.visible}
                onChange={(e) =>
                  setState((s) => ({
                    packs: s.packs.map((x, k) =>
                      k === i ? { ...x, visible: e.target.checked } : x,
                    ),
                  }))
                }
              />{" "}
              Show
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}

function Pricing() {
  const rows = useMilo((s) => s.pricing);
  const [draft, setDraft] = useState<PriceRow[]>(rows);
  useEffect(() => setDraft(rows), [rows]);
  const upd = (i: number, p: Partial<PriceRow>) =>
    setDraft((d) => d.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const num = (v: string) => (v === "" ? null : Math.max(0, Number(v)));
  const save = () => {
    if (draft.some((r) => r.currency.length !== 3)) {
      toast.error("Currency must be a 3-letter code");
      return;
    }
    setState(() => ({ pricing: draft }));
    audit("Updated regional call pricing");
    toast.success("Pricing saved");
  };
  return (
    <div className={box}>
      <p className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        Test rates only. <Pending /> Paid calling stays off for any region without a rate. Leave
        blank if undecided.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-2">Region</th>
              <th>Currency</th>
              <th>Rate / min</th>
              <th>Tax %</th>
              <th>Billing step (sec)</th>
              <th>Max paid min</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {draft.map((r, i) => (
              <tr key={r.id} className="border-t">
                <td className="py-2 pr-2">
                  {r.region} <span className="text-muted-foreground">({r.id})</span>
                </td>
                <td className="pr-2">
                  <input
                    className={inp}
                    value={r.currency}
                    onChange={(e) => upd(i, { currency: e.target.value.toUpperCase().slice(0, 3) })}
                  />
                </td>
                <td className="pr-2">
                  <input
                    className={inp}
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="Not set"
                    value={r.ratePerMin ?? ""}
                    onChange={(e) => upd(i, { ratePerMin: num(e.target.value) })}
                    aria-label={`${r.region} rate`}
                  />
                </td>
                <td className="pr-2">
                  <input
                    className={inp}
                    type="number"
                    min={0}
                    placeholder="Not set"
                    value={r.taxPct ?? ""}
                    onChange={(e) => upd(i, { taxPct: num(e.target.value) })}
                  />
                </td>
                <td className="pr-2">
                  <input
                    className={inp}
                    type="number"
                    min={1}
                    value={r.incrementSec}
                    onChange={(e) =>
                      upd(i, { incrementSec: Math.max(1, Number(e.target.value) || 60) })
                    }
                  />
                </td>
                <td className="pr-2">
                  <input
                    className={inp}
                    type="number"
                    min={1}
                    placeholder="No limit"
                    value={r.maxMinutes ?? ""}
                    onChange={(e) => upd(i, { maxMinutes: num(e.target.value) })}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={r.active}
                    onChange={(e) => upd(i, { active: e.target.checked })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className={`${btn} mt-4`} onClick={save}>
        Save pricing
      </button>
    </div>
  );
}

function Rules() {
  const cfg = useMilo((s) => s.callConfig);
  const regions = useMilo((s) => s.pricing);
  const intents = useMilo((s) => s.intentOptions);
  const [newIntent, setNewIntent] = useState("");
  const set = (p: Partial<typeof cfg>, what?: string) => {
    setState((s) => ({ callConfig: { ...s.callConfig, ...p } }));
    if (what) audit(what);
  };
  const addIntent = () => {
    const v = newIntent.trim().replace(/\s+/g, " ");
    if (v.length < 3 || v.length > 30) {
      toast.error("Use 3–30 characters");
      return;
    }
    if (intents.some((i) => i.toLowerCase() === v.toLowerCase())) {
      toast.error("That option already exists");
      return;
    }
    setState((s) => ({ intentOptions: [...s.intentOptions, v] }));
    audit(`Added intention option "${v}"`);
    setNewIntent("");
  };
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className={`${box} grid gap-4`}>
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">Calls</h2>
          <Pending />
        </div>
        <label className="text-sm font-semibold">
          Free call length (seconds)
          <input
            className={inp}
            type="number"
            min={0}
            value={cfg.freeSeconds}
            onChange={(e) => set({ freeSeconds: Math.max(0, +e.target.value) })}
          />
        </label>
        <label className="text-sm font-semibold">
          Warning shown at (seconds)
          <input
            className={inp}
            type="number"
            min={0}
            value={cfg.warnAt}
            onChange={(e) => set({ warnAt: Math.max(0, +e.target.value) })}
          />
        </label>
        <label className="text-sm font-semibold">
          Free time applies
          <select
            className={inp}
            value={cfg.rule}
            onChange={(e) =>
              set({ rule: e.target.value as FreeRule }, `Free-call rule → ${e.target.value}`)
            }
          >
            <option value="per_call">Every call</option>
            <option value="per_pair">Once per matched pair</option>
            <option value="per_user">Once per user</option>
          </select>
        </label>
        <label className="text-sm font-semibold">
          When only one person has Premium
          <select
            className={inp}
            value={cfg.paidRule}
            onChange={(e) =>
              set({ paidRule: e.target.value as PaidRule }, `Paid-call rule → ${e.target.value}`)
            }
          >
            <option value="consent_all">Everyone sees the price and must consent</option>
            <option value="premium_continue">The Premium caller's plan covers the call</option>
          </select>
        </label>
        <label className="text-sm font-semibold">
          Demo billing region (production: from a trusted source)
          <select
            className={inp}
            value={cfg.billingRegion}
            onChange={(e) =>
              set({ billingRegion: e.target.value }, `Billing region → ${e.target.value}`)
            }
          >
            {regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.region}
              </option>
            ))}
          </select>
        </label>
        <button
          className={btn2}
          onClick={() => {
            setState(() => ({ freeUsed: [] }));
            audit("Reset free-call usage");
            toast("Free-call usage reset for the signed-in account");
          }}
        >
          Reset free-call usage
        </button>
      </div>
      <div className={`${box} grid content-start gap-4`}>
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">Limits</h2>
          <Pending />
        </div>
        <label className="text-sm font-semibold">
          Free daily Likes (temporary value)
          <input
            className={inp}
            type="number"
            min={1}
            value={cfg.freeDailyLikes}
            onChange={(e) => set({ freeDailyLikes: Math.max(1, +e.target.value || 1) })}
          />
        </label>
        <label className="text-sm font-semibold">
          Boost duration (minutes, temporary)
          <input
            className={inp}
            type="number"
            min={5}
            value={cfg.boostMinutes}
            onChange={(e) => set({ boostMinutes: Math.max(5, +e.target.value || 5) })}
          />
        </label>
        <label className="text-sm font-semibold">
          Priority Likes per day (temporary)
          <input
            className={inp}
            type="number"
            min={0}
            value={cfg.superLikesPerDay}
            onChange={(e) => set({ superLikesPerDay: Math.max(0, +e.target.value || 0) })}
          />
        </label>
        <h2 className="pt-2 font-semibold">Relationship intention options</h2>
        <div className="flex flex-wrap gap-2">
          {intents.map((i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm"
            >
              {i}
              <button
                aria-label={`Remove ${i}`}
                disabled={intents.length <= 2}
                className="text-muted-foreground disabled:opacity-30"
                onClick={() => {
                  setState((s) => ({ intentOptions: s.intentOptions.filter((x) => x !== i) }));
                  audit(`Removed intention option "${i}"`);
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            className={inp}
            maxLength={30}
            value={newIntent}
            onChange={(e) => setNewIntent(e.target.value)}
            placeholder="Add an option"
          />
          <button className={btn} onClick={addIntent}>
            Add
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Changes save automatically and are logged. Removing an option doesn't erase it from
          existing profiles.
        </p>
      </div>
    </div>
  );
}

function Audit() {
  const log = useMilo((s) => s.audit);
  return (
    <div className={box}>
      {log.length === 0 ? (
        <p className="text-muted-foreground">No admin actions yet.</p>
      ) : (
        log.map((a) => (
          <p key={a.id} className="border-b py-2 text-sm last:border-0">
            <span className="text-muted-foreground">{new Date(a.at).toLocaleString()}</span> ·{" "}
            {a.action}
          </p>
        ))
      )}
    </div>
  );
}

function Purchases() {
  const accts = useAccounts();
  const rows = accts
    .flatMap((a) => (a.d.purchases ?? []).map((p) => ({ ...p, email: a.email })))
    .sort((a, b) => b.at - a.at);
  return (
    <div className={box}>
      <p className="mb-3 text-sm text-muted-foreground">
        Simulated test activations from this browser only. No real payments exist and no money was
        taken.
      </p>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">No purchase records yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th>Account</th>
              <th>Item</th>
              <th>Result (simulated)</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id + r.email} className="border-t">
                <td className="py-2">{r.email}</td>
                <td>{r.item}</td>
                <td>{r.outcome}</td>
                <td>{new Date(r.at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Announcements() {
  const list = useMilo((s) => s.announcements);
  const [text, setText] = useState("");
  const add = () => {
    const t = text.trim();
    if (t.length < 5) {
      toast.error("Write at least 5 characters");
      return;
    }
    setState((s) => ({
      announcements: [
        { id: uid(), at: Date.now(), text: t.slice(0, 140), active: true },
        ...s.announcements,
      ],
    }));
    audit(`Announcement posted: ${t.slice(0, 40)}`);
    setText("");
    toast.success("Announcement posted (in-app banner only)");
  };
  return (
    <div className={`${box} max-w-xl space-y-3`}>
      <p className="text-sm text-muted-foreground">
        Active announcements show as a banner on Discover for every account in this browser. No push
        is sent.
      </p>
      <div className="flex gap-2">
        <input
          className={inp}
          maxLength={140}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. New safety tips are available"
          aria-label="Announcement text"
        />
        <button className={btn} onClick={add}>
          Post
        </button>
      </div>
      {list.length === 0 && <p className="text-sm text-muted-foreground">No announcements yet.</p>}
      {list.map((a) => (
        <div key={a.id} className="flex items-center justify-between gap-2 border-t pt-2 text-sm">
          <span className={a.active ? "" : "text-muted-foreground line-through"}>{a.text}</span>
          <div className="flex gap-2">
            <button
              className={btn2}
              onClick={() => {
                setState((s) => ({
                  announcements: s.announcements.map((x) =>
                    x.id === a.id ? { ...x, active: !x.active } : x,
                  ),
                }));
                audit(`Announcement ${a.active ? "hidden" : "shown"}`);
              }}
            >
              {a.active ? "Disable" : "Enable"}
            </button>
            <button
              className={btn2}
              onClick={() =>
                setState((s) => ({ announcements: s.announcements.filter((x) => x.id !== a.id) }))
              }
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Notify() {
  const accts = useAccounts();
  const sent = useMilo((s) => s.sentNotices);
  const me = useMilo((s) => (s.loggedIn ? (s.account?.email ?? "") : ""));
  const [text, setText] = useState("");
  const [to, setTo] = useState("all");
  const [confirm, setConfirm] = useState(false);
  const send = () => {
    const t = text.trim().slice(0, 140);
    const targets = to === "all" ? accts.map((a) => a.email) : [to];
    for (const email of targets) {
      if (email === me) notify("announcement", t);
      else
        updateAccount(email, (d) => ({
          notices: [
            { id: uid(), kind: "announcement" as const, text: t, at: Date.now(), read: false },
            ...d.notices,
          ],
        }));
    }
    setState((s) => ({
      sentNotices: [
        {
          id: uid(),
          at: Date.now(),
          text: t,
          to: to === "all" ? `All accounts (${targets.length})` : to,
        },
        ...s.sentNotices,
      ],
    }));
    audit(`Notification sent to ${to === "all" ? "all accounts" : to}`);
    setText("");
    toast.success("Notification added to in-app notification centres (demo, no push)");
  };
  return (
    <div className={`${box} max-w-xl space-y-3`}>
      <p className="text-sm text-muted-foreground">
        Sends an in-app notice only. No push or email is delivered. Never use this to fake Likes,
        Matches or messages.
      </p>
      <select
        className={inp}
        value={to}
        onChange={(e) => setTo(e.target.value)}
        aria-label="Recipients"
      >
        <option value="all">All demo accounts ({accts.length})</option>
        {accts.map((a) => (
          <option key={a.email} value={a.email}>
            {a.email}
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        <input
          className={inp}
          maxLength={140}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message"
          aria-label="Notification text"
        />
        <button
          className={btn}
          disabled={text.trim().length < 5 || accts.length === 0}
          onClick={() => setConfirm(true)}
        >
          Send
        </button>
      </div>
      {accts.length === 0 && (
        <p className="text-xs text-muted-foreground">No demo accounts to notify yet.</p>
      )}
      <h3 className="pt-2 font-semibold">History</h3>
      {sent.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing sent yet.</p>
      ) : (
        sent.map((n) => (
          <p key={n.id} className="border-t py-2 text-sm">
            <span className="text-muted-foreground">
              {new Date(n.at).toLocaleString()} · {n.to}
            </span>
            <br />
            {n.text}
          </p>
        ))
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Send this notification?"
        body={`"${text.trim()}" will appear in the notification centre of ${to === "all" ? "every demo account" : to}.`}
        confirm="Send"
        onConfirm={send}
      />
    </div>
  );
}
