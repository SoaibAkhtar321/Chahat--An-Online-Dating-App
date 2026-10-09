import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Phone, Field, inputCls, btnPrimary } from "@/components/milo/Phone";
import { supabase } from "@/integrations/supabase/client";
import { meta } from "@/lib/meta";

export const Route = createFileRoute("/reset-password")({
  head: () => meta("Choose a new password", "Set a new password for your Milo account."),
  component: ResetPassword,
});

function ResetPassword() {
  const nav = useNavigate();
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return setErr("Use 8+ characters with a letter and a number");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setErr("This reset link has expired. Request a new one from Log in.");
    toast.success("Password updated");
    nav({ to: "/login" });
  };
  return (
    <Phone className="px-6 py-10">
      <h1 className="text-3xl font-semibold">Choose a new password</h1>
      <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
        <Field label="New password" error={err}><input className={inputCls} type="password" value={pw} onChange={(e) => { setPw(e.target.value); setErr(""); }} autoComplete="new-password" /></Field>
        <button className={btnPrimary} disabled={busy}>{busy ? "Saving…" : "Save password"}</button>
      </form>
    </Phone>
  );
}
