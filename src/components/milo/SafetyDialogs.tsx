import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { block, report } from "@/lib/milo-store";
import { btnDanger, btnGhost, btnPrimary, inputCls } from "./Phone";

export const REPORT_CATEGORIES = ["Harassment", "Scam or fraud", "Fake profile / impersonation", "Spam", "Inappropriate content", "Threats or violence", "May be under 18", "Something else"];

export function ReportDialog({ open, onOpenChange, targetId, name, onDone, source = "profile" }: { open: boolean; onOpenChange: (o: boolean) => void; targetId: string; name: string; onDone?: () => void; source?: "profile" | "chat" | "call" }) {
  const [sent, setSent] = useState(false);
  const [cat, setCat] = useState("");
  const [note, setNote] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(true);
  const submit = () => {
    report(targetId, cat, note, source);
    if (alsoBlock) block(targetId);
    setSent(true);
  };
  const close = () => { onOpenChange(false); setCat(""); setNote(""); if (sent) { setSent(false); onDone?.(); } };
  if (sent) return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-sm rounded-3xl">
        <DialogHeader><DialogTitle className="font-display text-2xl">Report sent</DialogTitle><DialogDescription>Thanks for keeping Milo safe. {alsoBlock ? `${name} is blocked. ` : ""}You can follow its status in the Safety centre. (Demo: reviewed in the demo admin panel, not by a real team.)</DialogDescription></DialogHeader>
        <button className={btnPrimary} onClick={close}>Done</button>
      </DialogContent>
    </Dialog>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-3xl">
        <DialogHeader><DialogTitle className="font-display text-2xl">Report {name}</DialogTitle><DialogDescription>{name} won't know you reported them.</DialogDescription></DialogHeader>
        <div className="space-y-2">
          {REPORT_CATEGORIES.map((c) => (
            <button key={c} onClick={() => setCat(c)} className={`w-full rounded-xl border px-4 py-2.5 text-left text-sm font-medium ${cat === c ? "border-primary bg-secondary" : "bg-card"}`}>{c}</button>
          ))}
        </div>
        {cat && <textarea className={`${inputCls} h-20 py-2`} placeholder="Add details (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={alsoBlock} onChange={(e) => setAlsoBlock(e.target.checked)} className="size-4 accent-primary" /> Also block {name}</label>
        <button className={btnPrimary} disabled={!cat} onClick={submit}>Submit report</button>
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmDialog({ open, onOpenChange, title, body, confirm, danger, onConfirm }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; body: string; confirm: string; danger?: boolean; onConfirm: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-3xl">
        <DialogHeader><DialogTitle className="font-display text-2xl">{title}</DialogTitle><DialogDescription>{body}</DialogDescription></DialogHeader>
        <div className="space-y-2">
          <button className={danger ? btnDanger : btnPrimary} onClick={() => { onConfirm(); onOpenChange(false); }}>{confirm}</button>
          <button className={btnGhost} onClick={() => onOpenChange(false)}>Cancel</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
