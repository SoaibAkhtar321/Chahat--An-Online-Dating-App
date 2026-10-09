import { createFileRoute, Link } from "@tanstack/react-router";
import { PhoneIncoming, PhoneOutgoing, PhoneMissed, Video } from "lucide-react";
import { toast } from "sonner";
import { Phone, Header, btnGhost, cardCls } from "@/components/milo/Phone";
import { profileById, useMilo } from "@/lib/milo-store";
import { meta } from "@/lib/meta";

export const Route = createFileRoute("/calls")({
  head: () => meta("Calls & billing", "Your Milo call history and billing help."),
  component: Calls,
});

function Calls() {
  const calls = useMilo((s) => s.calls);
  return (
    <Phone auth>
      <Header title="Calls & billing" back="/chats" />
      <div className="space-y-4 p-5">
        {calls.length === 0 ? <p className="py-16 text-center text-muted-foreground">No calls yet. Start one from a chat.</p> : (
          <div className={cardCls}>
            {calls.map((c) => { const p = profileById(c.with); const Icon = c.outcome === "missed" || c.outcome === "declined" ? PhoneMissed : c.direction === "in" ? PhoneIncoming : PhoneOutgoing; return (
              <Link key={c.id} to="/chat/$id" params={{ id: c.with }} className="flex items-center gap-3 border-b px-4 py-3 last:border-0">
                <img src={p?.photos[0]} alt="" className="size-11 rounded-full object-cover" />
                <div className="flex-1">
                  <b>{p?.name}</b>
                  <p className={`flex items-center gap-1 text-xs ${c.outcome === "missed" ? "text-destructive" : "text-muted-foreground"}`}>
                    <Icon className="size-3" /> {c.mode === "video" && <Video className="size-3" />} {c.outcome} · {Math.floor((c.freeSec + c.paidSec) / 60)}m {(c.freeSec + c.paidSec) % 60}s
                  </p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  {c.estCost != null ? <b className="block text-foreground">~{c.currency} {c.estCost.toFixed(2)}</b> : <span className="block">Free</span>}
                  {new Date(c.at).toLocaleDateString([], { day: "numeric", month: "short" })}
                </div>
              </Link>); })}
          </div>
        )}
        <div className="rounded-2xl bg-secondary p-4 text-sm">
          <b>About billing</b>
          <p className="mt-1 text-muted-foreground">Amounts here are estimates from the demo. In the real app, the final charge comes from secure server records, and you can ask for a refund if something looks wrong.</p>
        </div>
        <button className={btnGhost} onClick={() => toast.success("Support request sent. We'll reply by email (demo).")}>Report a billing problem</button>
      </div>
    </Phone>
  );
}
