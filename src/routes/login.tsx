import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Phone, Field, inputCls, btnPrimary, btnGhost } from "@/components/milo/Phone";
import { getState, useMilo } from "@/lib/milo-store";
import { logIn, sendPasswordReset, signInWithGoogle } from "@/lib/milo-cloud";
import { meta } from "@/lib/meta";

export const Route = createFileRoute("/login")({
  head: () => meta("Log in", "Log in to Milo to see your matches and chats."),
  component: Login,
});

function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [forgot, setForgot] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = useMilo((s) => s._hydrated && s.sessionReady);
  const loggedIn = useMilo((s) => s.loggedIn);
  const onboarded = useMilo((s) => s.onboarded);
  // Returning from the confirmation email or Google: continue once the account has loaded.
  useEffect(() => { if (ready && loggedIn) nav({ to: onboarded ? "/discover" : "/onboarding" }); }, [ready, loggedIn, onboarded, nav]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) return setErr("Enter a valid email address");
    if (forgot) { setBusy(true); await sendPasswordReset(email); setBusy(false); toast.success("If an account exists, a reset link is on its way."); setForgot(false); return; }
    if (!pw) return setErr("Enter your password");
    setBusy(true);
    const r = await logIn(email, pw);
    setBusy(false);
    if (r === "invalid") return setErr("Email or password is incorrect");
    if (r === "unverified") return nav({ to: "/verify" });
    if (r !== "ok") return setErr("Couldn't log in right now. Please try again.");
    nav({ to: getState().onboarded ? "/discover" : "/onboarding" });
  };

  return (
    <Phone className="px-6 py-8">
      <Link to="/" aria-label="Back" className="inline-grid size-10 place-items-center rounded-full border bg-card"><ArrowLeft className="size-5" /></Link>
      <h1 className="mt-6 text-3xl font-semibold">{forgot ? "Reset password" : "Welcome back"}</h1>
      <p className="mt-1 text-muted-foreground">{forgot ? "We'll email you a secure reset link." : "Log in to pick up where you left off, on any device."}</p>
      <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
        <Field label="Email" error={err}><input className={inputCls} type="email" value={email} onChange={(e) => { setEmail(e.target.value); setErr(""); }} autoComplete="email" /></Field>
        {!forgot && <Field label="Password"><input className={inputCls} type="password" value={pw} onChange={(e) => { setPw(e.target.value); setErr(""); }} autoComplete="current-password" /></Field>}
        <button className={btnPrimary} disabled={busy}>{busy ? "Please wait…" : forgot ? "Send reset link" : "Log in"}</button>
      </form>
      {!forgot && <>
        <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>
        <button type="button" className={btnGhost} onClick={() => void signInWithGoogle()}>Continue with Google</button>
      </>}
      <button onClick={() => setForgot(!forgot)} className="mt-6 w-full text-center text-sm font-semibold text-primary">
        {forgot ? "Back to log in" : "Forgot password?"}
      </button>
      <p className="mt-4 text-center text-sm text-muted-foreground">New to Milo? <Link to="/signup" className="font-semibold text-primary">Create an account</Link></p>
    </Phone>
  );
}
