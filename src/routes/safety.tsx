import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck, Flag, Ban, Lock, Phone as PhoneIcon, FileText } from "lucide-react";
import { Phone, Header, cardCls } from "@/components/milo/Phone";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { profileById, useMilo } from "@/lib/milo-store";
import { meta } from "@/lib/meta";

export const Route = createFileRoute("/safety")({
  head: () => meta("Safety centre", "Safety tips, reporting and privacy controls on Milo."),
  component: SafetyPage,
});

const STATUS = {
  open: "In review",
  actioned: "Action taken",
  dismissed: "Reviewed, no action",
} as const;

function SafetyPage() {
  const email = useMilo((s) => s.account?.email);
  const all = useMilo((s) => s.reports);
  const blocked = useMilo((s) => s.blocked.length);
  const mine = all.filter((r) => email && r.by === email);
  return (
    <Phone auth>
      <Header title="Safety centre" back="/me" />
      <div className="space-y-6 p-5">
        <div className="flex gap-3 rounded-2xl bg-secondary p-4 text-sm">
          <ShieldCheck className="size-6 shrink-0 text-primary" />
          <p>
            Safety tools are always free. If you're in immediate danger, contact local emergency
            services (112 in India) first.
          </p>
        </div>
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Safety tips
          </h2>
          <Accordion type="single" collapsible className={`${cardCls} px-4`}>
            <AccordionItem value="a">
              <AccordionTrigger>Meeting someone for the first time</AccordionTrigger>
              <AccordionContent>
                Meet in a busy public place, tell a friend your plans, arrange your own transport
                and leave whenever you feel uncomfortable.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="b">
              <AccordionTrigger>Spotting scams</AccordionTrigger>
              <AccordionContent>
                Never send money, gift cards, bank details or OTPs. Be careful if someone pushes to
                move to another app quickly, avoids video calls or tells urgent stories about money.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="c">
              <AccordionTrigger>Protecting your privacy</AccordionTrigger>
              <AccordionContent>
                Milo never shows your exact location or address. Don't share your home address,
                workplace or financial details until you trust someone.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="d" className="border-0">
              <AccordionTrigger>How reporting works</AccordionTrigger>
              <AccordionContent>
                Use Report on a profile, in a chat's ⋮ menu or after a call. Reports are anonymous.
                You can also block at the same time. In this demo, reports are reviewed in the demo
                admin panel only.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </section>
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Your reports ({mine.length})
          </h2>
          <div className={cardCls}>
            {mine.length === 0 ? (
              <p className="px-4 py-3.5 text-sm text-muted-foreground">
                You haven't reported anyone.
              </p>
            ) : (
              mine.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-3 border-b px-4 py-3 text-sm last:border-0"
                >
                  <Flag className="size-4 text-muted-foreground" />
                  <span className="flex-1">
                    <b>{profileById(r.targetId)?.name ?? "A user"}</b> · {r.category}
                    <span className="block text-xs text-muted-foreground">
                      {new Date(r.at).toLocaleDateString()} · from {r.source ?? "profile"}
                    </span>
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${r.status === "open" ? "bg-accent text-accent-foreground" : "bg-muted"}`}
                  >
                    {STATUS[r.status]}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Controls
          </h2>
          <div className={cardCls}>
            <Link to="/settings" className="flex items-center gap-3 border-b px-4 py-3.5">
              <Lock className="size-5 text-primary" />
              <span className="flex-1 font-medium">Privacy settings</span>
            </Link>
            <Link to="/settings" className="flex items-center gap-3 border-b px-4 py-3.5">
              <Ban className="size-5 text-primary" />
              <span className="flex-1 font-medium">Blocked users ({blocked})</span>
            </Link>
            <Link to="/calls" className="flex items-center gap-3 border-b px-4 py-3.5">
              <PhoneIcon className="size-5 text-primary" />
              <span className="flex-1 font-medium">Call history & billing reports</span>
            </Link>
            <Link to="/terms" className="flex items-center gap-3 border-b px-4 py-3.5">
              <FileText className="size-5 text-primary" />
              <span className="flex-1 font-medium">Terms of Service (draft)</span>
            </Link>
            <Link to="/privacy" className="flex items-center gap-3 px-4 py-3.5">
              <FileText className="size-5 text-primary" />
              <span className="flex-1 font-medium">Privacy Policy (draft)</span>
            </Link>
          </div>
        </section>
      </div>
    </Phone>
  );
}
