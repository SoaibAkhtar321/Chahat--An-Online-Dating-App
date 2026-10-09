import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Phone, Header, Toggle, cardCls, btnDanger, btnGhost, inputCls } from "@/components/milo/Phone";
import { ConfirmDialog } from "@/components/milo/SafetyDialogs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { can, isPremium, profileById, setState, unblock, useMilo } from "@/lib/milo-store";
import { deleteAccount, logOut } from "@/lib/milo-cloud";
import { stepOf } from "./onboarding";
import { meta } from "@/lib/meta";

export const Route = createFileRoute("/settings")({
  head: () => meta("Settings & privacy", "Notifications, privacy, safety and account settings on Milo."),
  component: SettingsPage,
});

const HINTS: Record<string, string> = {
  "Show me in Discover": "Off hides you from new people. Existing matches and chats keep working.",
  "Show my distance": "Others only ever see an approximate distance, never your location",
  "Show online status": "If off, others won't see when you're active, and you won't see theirs",
  "Read receipts": "If off, people won't see when you've read their messages",
  "Incognito (Premium)": "Only people you like can see you",
};
const LEGAL: Record<string, string> = {
  "Terms of Service": "Draft placeholder. The final Terms of Service will be written with legal counsel before launch. Users must be 18+, use real information and follow the Community Guidelines.",
  "Privacy Policy": "Draft placeholder. Milo will collect only what's needed to run the service, never show exact locations, and let you download or delete your data.",
  "Community Guidelines": "Be respectful. No harassment, hate, scams, nudity or impersonation. No one under 18. Report anything that feels wrong. (Demo: reports stay in this browser and appear in the demo admin queue; no real moderation team reviews them.)",
};

function SettingsPage() {
  const nav = useNavigate();
  const s = useMilo((x) => x.settings);
  const blocked = useMilo((x) => x.blocked);
  const premium = useMilo(isPremium);
  const incog = useMilo((s) => can(s, "incognito"));
  const email = useMilo((x) => x.account?.email);
  const langs = useMilo((x) => x.me.languages);
  const intents = useMilo((x) => x.me.intents);
  const [legal, setLegal] = useState("");
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [delStep, setDelStep] = useState(0);
  const [delText, setDelText] = useState("");
  const setPref = (group: "notif" | "privacy", k: string, v: boolean) => {
    if (k.includes("Premium") && v && !incog) { toast("Incognito is a Premium feature"); return; }
    setState((st) => ({ settings: { ...st.settings, [group]: { ...st.settings[group], [k]: v } } }));
  };

  return (
    <Phone auth>
      <Header title="Settings" back="/me" />
      <div className="space-y-6 p-5">
        <Section title="Account">
          <div className={cardCls}>
            <Row label="Email" value={email ?? "—"} />
            <button className="w-full" onClick={() => { setState(() => ({ onboardingStep: stepOf("prefs") })); nav({ to: "/onboarding" }); }}><Row label="Discovery preferences" chevron /></button>
            <button className="w-full" onClick={() => { setState(() => ({ onboardingStep: stepOf("languages") })); nav({ to: "/onboarding" }); }}><Row label="Languages I speak" value={langs.length ? langs.join(", ") : "Not set"} chevron /></button>
            <button className="w-full" onClick={() => { setState(() => ({ onboardingStep: stepOf("location") })); nav({ to: "/onboarding" }); }}><Row label="Location" chevron /></button>
            <button className="w-full" onClick={() => { setState(() => ({ onboardingStep: stepOf("intents") })); nav({ to: "/onboarding" }); }}><Row label="Relationship intentions" value={intents.join(", ") || "Not set"} chevron /></button>
            <button className="w-full" onClick={() => nav({ to: "/premium" })}><Row label="Subscription" value={premium ? "Premium" : "Free"} chevron /></button>
          </div>
        </Section>
        <Section title="Notifications">
          <div className={cardCls}>{Object.entries(s.notif).map(([k, v]) => <Toggle key={k} label={k} checked={k.includes("Premium") ? v && incog : v} onChange={(x) => setPref("notif", k, x)} />)}</div>
          <p className="mt-2 text-xs text-muted-foreground">These control the in-app notification centre in this demo.</p>
          <div className={`${cardCls} mt-3`}>
            <div className="flex items-center justify-between px-4 py-3 text-sm"><span>Push notifications</span><span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">Not connected yet</span></div>
            <div className="flex items-center justify-between border-t px-4 py-3 text-sm"><span>Email notifications</span><span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">Not connected yet</span></div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Push and email delivery need a provider and will be added with the backend. Nothing is sent outside the app today.</p>
        </Section>
        <Section title="Privacy">
          <div className={cardCls}>{Object.entries(s.privacy).map(([k, v]) => <Toggle key={k} label={k} checked={k.includes("Premium") ? v && incog : v} onChange={(x) => setPref("privacy", k, x)}
            hint={HINTS[k]} />)}</div>
          <p className="mt-2 text-xs text-muted-foreground">Milo never shows exact coordinates or your address to anyone.</p>
        </Section>
        <Section title={`Blocked users (${blocked.length})`}>
          <div className={cardCls}>
            {blocked.length === 0 ? <p className="px-4 py-3.5 text-sm text-muted-foreground">You haven't blocked anyone.</p> : blocked.map((id) => (
              <div key={id} className="flex items-center gap-3 border-b px-4 py-3 last:border-0">
                <img src={profileById(id)?.photos[0]} alt="" className="size-9 rounded-full object-cover" />
                <span className="flex-1 font-medium">{profileById(id)?.name ?? id}</span>
                <button className="text-sm font-semibold text-primary" onClick={() => { unblock(id); toast("Unblocked. They may appear in Discover again."); }}>Unblock</button>
              </div>
            ))}
          </div>
        </Section>
        <section id="safety">
          <Section title="Safety">
            <div className={cardCls}>
              <button className="w-full" onClick={() => nav({ to: "/safety" })}><Row label="Safety centre & your reports" chevron /></button>
              <button className="w-full" onClick={() => nav({ to: "/verification" })}><Row label="Profile verification" chevron /></button>
            </div>
          </Section>
        </section>
        <Section title="Help & legal">
          <div className={cardCls}>
            <button className="w-full" onClick={() => toast.success("Support request sent (demo)")}><Row label="Contact support" chevron /></button>
            <button className="w-full" onClick={() => nav({ to: "/terms" })}><Row label="Terms of Service (draft)" chevron /></button>
            <button className="w-full" onClick={() => nav({ to: "/privacy" })}><Row label="Privacy Policy (draft)" chevron /></button>
            <button className="w-full" onClick={() => setLegal("Community Guidelines")}><Row label="Community Guidelines" chevron /></button>
          </div>
        </Section>
        <div className="space-y-2">
          <button className={btnGhost} onClick={() => setLogoutOpen(true)}>Log out</button>
          <button className="w-full py-3 text-sm font-semibold text-destructive" onClick={() => setDelStep(1)}>Delete account</button>
        </div>
      </div>

      <Dialog open={!!legal} onOpenChange={(o) => !o && setLegal("")}>
        <DialogContent className="max-w-sm rounded-3xl"><DialogHeader><DialogTitle className="font-display text-2xl">{legal}</DialogTitle><DialogDescription>{LEGAL[legal]}</DialogDescription></DialogHeader></DialogContent>
      </Dialog>
      <ConfirmDialog open={logoutOpen} onOpenChange={setLogoutOpen} title="Log out?" body="Your profile and chats stay saved to your account. Log in on any device to continue." confirm="Log out" onConfirm={async () => { await logOut(); nav({ to: "/" }); }} />
      <ConfirmDialog open={delStep === 1} onOpenChange={(o) => !o && setDelStep(0)} danger title="Delete your account?" body="Your profile, matches and messages will be permanently deleted. Active subscriptions must be cancelled separately in Google Play." confirm="Continue" onConfirm={() => setTimeout(() => setDelStep(2), 50)} />
      <Dialog open={delStep === 2} onOpenChange={(o) => { if (!o) { setDelStep(0); setDelText(""); } }}>
        <DialogContent className="max-w-sm rounded-3xl">
          <DialogHeader><DialogTitle className="font-display text-2xl">Type DELETE to confirm</DialogTitle><DialogDescription>This can't be undone.</DialogDescription></DialogHeader>
          <input className={inputCls} value={delText} onChange={(e) => setDelText(e.target.value)} placeholder="DELETE" />
          <button className={btnDanger} disabled={delText !== "DELETE"} onClick={async () => { try { await deleteAccount(); toast("Your account has been deleted"); nav({ to: "/" }); } catch { toast.error("Couldn't delete the account. Please try again."); } }}>Delete permanently</button>
        </DialogContent>
      </Dialog>
    </Phone>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><h2 className="mb-2 font-sans text-sm font-bold uppercase tracking-wider text-muted-foreground">{title}</h2>{children}</section>;
}
function Row({ label, value, chevron }: { label: string; value?: string; chevron?: boolean }) {
  return <div className="flex items-center gap-3 border-b px-4 py-3.5 text-left last:border-0"><span className="flex-1 font-medium">{label}</span>{value && <span className="truncate text-sm text-muted-foreground">{value}</span>}{chevron && <ChevronRight className="size-4 text-muted-foreground" />}</div>;
}
