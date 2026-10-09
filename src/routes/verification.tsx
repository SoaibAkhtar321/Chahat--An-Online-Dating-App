import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { BadgeCheck, Camera, Clock, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Phone, Header, btnPrimary, btnGhost, cardCls } from "@/components/milo/Phone";
import { setState, useMilo } from "@/lib/milo-store";
import { processPhoto, validateFile } from "@/lib/photo";
import { meta } from "@/lib/meta";

export const Route = createFileRoute("/verification")({
  head: () => meta("Profile verification", "Request optional photo verification on Milo (demo)."),
  component: VerificationPage,
});

const POSE = "Hold up two fingers next to your face";

function VerificationPage() {
  const v = useMilo((s) => s.verification);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const pick = async (f: File | undefined) => {
    if (!f) return; setErr("");
    const bad = validateFile(f); if (bad) { setErr(bad); return; }
    setBusy(true);
    try {
      const p = await processPhoto(f);
      setState(() => ({ verification: { status: "pending", selfie: p.thumb, at: Date.now() } }));
      toast.success("Verification requested. A reviewer will check it (demo: approve it in Admin → Verification).");
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't process that photo."); }
    finally { setBusy(false); }
  };
  return (
    <Phone auth>
      <Header title="Verification" back="/me" />
      <div className="space-y-5 p-5">
        <p className="rounded-xl bg-secondary p-3 text-xs">Demo flow. The selfie stays in this browser and is reviewed in the demo admin panel. There's no face matching yet; the real app would use a verification provider. A badge is only shown after a review approves it.</p>
        <div className={`${cardCls} p-5 text-center`}>
          {v.status === "approved" ? <><BadgeCheck className="mx-auto size-12 text-highlight" /><h2 className="mt-2 text-2xl font-semibold">You're verified</h2><p className="text-sm text-muted-foreground">Approved by a demo reviewer.</p></>
            : v.status === "pending" ? <><Clock className="mx-auto size-12 text-accent-foreground" /><h2 className="mt-2 text-2xl font-semibold">In review</h2><p className="text-sm text-muted-foreground">Submitted {v.at ? new Date(v.at).toLocaleString() : ""}. You'll get a notification when it's reviewed.</p></>
            : v.status === "rejected" ? <><XCircle className="mx-auto size-12 text-destructive" /><h2 className="mt-2 text-2xl font-semibold">Not approved</h2><p className="text-sm text-muted-foreground">{v.note || "The selfie didn't clearly match the pose or your photos."} You can try again.</p></>
              : <><Camera className="mx-auto size-12 text-primary" /><h2 className="mt-2 text-2xl font-semibold">Verify your profile</h2><p className="text-sm text-muted-foreground">Optional. Shows others you're the person in your photos.</p></>}
          {v.selfie && <img src={v.selfie} alt="Your verification selfie" className="mx-auto mt-4 size-28 rounded-2xl object-cover" />}
        </div>
        {(v.status === "none" || v.status === "rejected") && (
          <div className="space-y-3">
            <p className="text-sm"><b>Pose:</b> {POSE}. Take a clear selfie in good light, face fully visible.</p>
            <label className={`${btnPrimary} cursor-pointer`}>{busy ? "Processing…" : "Take or choose a selfie"}
              <input type="file" accept="image/*" capture="user" className="sr-only" disabled={busy} onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} aria-label="Verification selfie" /></label>
          </div>
        )}
        {v.status === "pending" && <button className={btnGhost} onClick={() => { setState(() => ({ verification: { status: "none" } })); toast("Verification request withdrawn"); }}>Withdraw request</button>}
        {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
      </div>
    </Phone>
  );
}
