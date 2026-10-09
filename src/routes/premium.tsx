import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Check, Minus, Crown } from "lucide-react";
import { toast } from "sonner";
import { Phone, Header, btnPrimary, btnGhost, cardCls } from "@/components/milo/Phone";
import { ConfirmDialog } from "@/components/milo/SafetyDialogs";
import { ENTS, TIER_NAMES, notify, setState, tierOf, useMilo, uid, type Ent, type Purchase, type Tier } from "@/lib/milo-store";
import { meta } from "@/lib/meta";

export const Route = createFileRoute("/premium")({
  head: () => meta("Milo Premium", "Unlimited likes, see who likes you, advanced filters and more."),
  component: Premium,
});

const ALWAYS_FREE = ["Profile, photos & discovery", "Like/Pass (daily limit) and mutual Matches", "Text chat with Matches", "Block, report, unmatch & delete", "First 60s of video calls"];
const log = (item: string, outcome: Purchase["outcome"]) => setState((s) => ({ purchases: [{ id: uid(), at: Date.now(), item, outcome }, ...s.purchases] }));
const priceLabel = (p: { price: number | null; currency: string; period: string; approved: boolean }) =>
  p.price == null ? "Price pending client approval" : `${p.currency} ${p.price} / ${p.period}${p.approved ? "" : " (temporary, pending approval)"}`;

function Premium() {
  const prem = useMilo((s) => s.premium);
  const plans = useMilo((s) => s.plans);
  const packs = useMilo((s) => s.packs);
  const tier = useMilo(tierOf);
  const purchases = useMilo((s) => s.purchases);
  const paid = (["plus", "pro"] as const).filter((t) => plans[t].visible);
  const [pick, setPick] = useState<Exclude<Tier, "free">>(paid[0] ?? "plus");
  const [cancelOpen, setCancelOpen] = useState(false);
  const cols: Tier[] = ["free", ...paid];
  const feats = (Object.keys(ENTS) as Ent[]).filter((e) => cols.some((t) => plans[t].features.includes(e)));

  const buy = (fail = false) => {
    const name = plans[pick].name;
    setState(() => ({ premium: { active: false, status: "pending", tier: pick } }));
    setTimeout(() => {
      if (fail) { setState(() => ({ premium: { active: false, status: "none" } })); log(name, "failed"); toast.error("Purchase didn't go through. You weren't charged."); return; }
      setState(() => ({ premium: { active: true, status: "active", tier: pick, plan: plans[pick].period } }));
      log(name, "demo-activated");
      notify("subscription", `${name} turned on for testing (demo, no payment)`);
      toast.success(`${name} turned on for testing. No payment was made.`);
    }, 1200);
  };

  return (
    <Phone auth>
      <Header title="Milo Premium" back="/me" />
      <div className="space-y-5 p-5">
        <div className="rounded-3xl bg-brand p-6 text-primary-foreground shadow-glow">
          <Crown className="size-8" />
          <h2 className="mt-2 text-3xl font-semibold">{prem.active ? `You're on ${TIER_NAMES[tier]}` : "Get more from Milo"}</h2>
          <p className="mt-1 opacity-90">{prem.active && tier !== "free" ? `Test activation, no payment taken. Listed price: ${priceLabel(plans[tier])}.` : "Extra convenience and visibility. Matching and chat stay free."}</p>
        </div>

        <div className={`${cardCls} p-4`}>
          <p className="text-xs font-bold uppercase text-muted-foreground">Always free</p>
          <ul className="mt-1 space-y-0.5 text-sm">{ALWAYS_FREE.map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" />{f}</li>)}</ul>
        </div>

        <div className={cardCls}>
          <div className="grid border-b px-4 py-2 text-xs font-bold uppercase text-muted-foreground" style={{ gridTemplateColumns: `1fr repeat(${cols.length}, 56px)` }}><span>Feature</span>{cols.map((t) => <span key={t} className="text-center">{t === "free" ? "Free" : t === "plus" ? "Plus" : "Pro"}</span>)}</div>
          {feats.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">No Premium features are configured right now.</p>}
          {feats.map((e) => (
            <div key={e} className="grid items-center border-b px-4 py-2.5 text-sm last:border-0" style={{ gridTemplateColumns: `1fr repeat(${cols.length}, 56px)` }}>
              <span>{ENTS[e]}</span>{cols.map((t) => <Cell key={t} v={plans[t].features.includes(e)} />)}
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Plan contents and prices are configured in Admin and still need client approval. Upgrading never unlocks matching or chat; those are always free. Longer calls follow the call rules shown before any paid minute.</p>

        {prem.status === "cancelled" && <p className="rounded-xl bg-secondary p-3 text-sm">Your subscription is cancelled. Premium has ended in this demo. In the real app it stays until the end of your paid period.</p>}

        {!prem.active ? (
          <>
            <div className="space-y-2">
              {paid.map((t) => (
                <button key={t} onClick={() => setPick(t)} className={`w-full rounded-2xl border-2 bg-card px-4 py-3 text-left ${pick === t ? "border-primary" : "border-transparent"}`}>
                  <b>{plans[t].name}</b><span className="block text-sm text-muted-foreground">{priceLabel(plans[t])}</span>
                </button>
              ))}
              {paid.length === 0 && <p className="text-sm text-muted-foreground">No plans are on sale right now.</p>}
            </div>
            <p className="text-xs text-muted-foreground">In the Android app, the final price, billing period and renewal terms come from Google Play at checkout. Subscriptions renew automatically until cancelled in Google Play.</p>
            <button className={btnPrimary} disabled={prem.status === "pending" || !paid.length} onClick={() => buy()}>{prem.status === "pending" ? "Waiting for confirmation…" : "Turn on Premium for testing (no payment)"}</button>
            <div className="flex justify-between text-sm font-semibold">
              <button className="text-muted-foreground underline" onClick={() => buy(true)}>Demo: failed purchase</button>
              <button className="text-primary" onClick={() => { log("Restore", "restored-none"); toast("No previous purchases found for this account (demo)"); }}>Restore purchases</button>
            </div>
          </>
        ) : (
          <div className="space-y-2">
            {paid.filter((t) => t !== tier).map((t) => <button key={t} className={btnGhost} onClick={() => { setState((s) => ({ premium: { ...s.premium, tier: t } })); log(`Switched to ${plans[t].name}`, "demo-activated"); toast.success(`Switched to ${plans[t].name} (test, no payment)`); }}>Switch to {plans[t].name} (test)</button>)}
            <button className={btnGhost} onClick={() => toast("In the app, this opens Google Play subscriptions.")}>Manage in Google Play</button>
            <button className={btnGhost} onClick={() => setCancelOpen(true)}>Cancel subscription (demo)</button>
          </div>
        )}
        {packs.some((p) => p.visible) && (
          <div className={`${cardCls} p-4`}>
            <h3 className="font-semibold">One-time extras</h3>
            {packs.filter((p) => p.visible).map((p) => <div key={p.id} className="flex justify-between border-b py-2 text-sm last:border-0"><span>{p.name}</span><span className="text-muted-foreground">{p.price == null ? "Price pending approval" : `${p.currency} ${p.price}`} · not on sale in demo</span></div>)}
          </div>
        )}
        <div className={`${cardCls} p-4`}>
          <h3 className="font-semibold">Purchase history (demo)</h3>
          {purchases.length ? purchases.map((p) => (
            <div key={p.id} className="flex justify-between border-b py-2 text-sm last:border-0"><span>{p.item}</span><span className="text-muted-foreground">{OUT[p.outcome]} · {new Date(p.at).toLocaleDateString()}</span></div>
          )) : <p className="mt-1 text-sm text-muted-foreground">No purchases yet.</p>}
        </div>
      </div>
      <ConfirmDialog open={cancelOpen} onOpenChange={setCancelOpen} danger title="Cancel Premium?" body="You'll lose your Premium features. Matching and chat stay free." confirm="Cancel subscription"
        onConfirm={() => { setState(() => ({ premium: { active: false, status: "cancelled" } })); log(TIER_NAMES[tier], "cancelled"); notify("subscription", "Your Premium subscription was cancelled"); }} />
    </Phone>
  );
}

const OUT: Record<Purchase["outcome"], string> = { "demo-activated": "Test activation, no charge", failed: "Failed, not charged", cancelled: "Cancelled", "restored-none": "Nothing to restore" };

function Cell({ v }: { v: boolean }) {
  return <span className="grid place-items-center">{v ? <Check className="size-4 text-success" /> : <Minus className="size-4 text-muted-foreground" />}</span>;
}
