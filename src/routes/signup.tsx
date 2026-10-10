import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Phone, Field, inputCls, btnPrimary, btnGhost } from "@/components/milo/Phone";
import { signInWithGoogle, signUp } from "@/lib/milo-cloud";
import { meta } from "@/lib/meta";

export const Route = createFileRoute("/signup")({
  head: () =>
    meta("Create account", "Sign up for Milo with your email or Google. Free, no SMS needed."),
  component: Signup,
});

function Signup() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ email?: string; pw?: string }>({});

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n: typeof err = {};
    if (!/^\S+@\S+\.\S+$/.test(email)) n.email = "Enter a valid email address";
    if (pw.length < 8) n.pw = "Use at least 8 characters";
    else if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw))
      n.pw = "Include at least one letter and one number";
    else if (pw.length > 64) n.pw = "Use 64 characters or fewer";
    setErr(n);
    if (Object.keys(n).length) return;
    setBusy(true);
    const r = await signUp(email, pw);
    setBusy(false);
    if (r === "exists")
      return setErr({ email: "An account with this email already exists. Log in instead." });
    if (r !== "ok")
      return setErr({
        pw: /weak|pwned|leak/i.test(r)
          ? "This password is too easy to guess. Try another."
          : "Couldn't create the account right now. Please try again.",
      });
    nav({ to: "/verify" });
  };

  return (
    <Phone className="px-6 py-8">
      <Link
        to="/"
        aria-label="Back"
        className="inline-grid size-10 place-items-center rounded-full border bg-card"
      >
        <ArrowLeft className="size-5" />
      </Link>
      <h1 className="mt-6 text-3xl font-semibold">Create your account</h1>
      <p className="mt-1 text-muted-foreground">
        Free with email. We'll send you a link to confirm it.
      </p>
      <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
        <Field label="Email" error={err.email}>
          <input
            className={inputCls}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
          />
        </Field>
        <Field label="Password" error={err.pw}>
          <input
            className={inputCls}
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="8+ characters, a letter and a number"
            autoComplete="new-password"
          />
        </Field>
        <button className={btnPrimary} disabled={busy}>
          {busy ? "Creating…" : "Sign up"}
        </button>
      </form>
      <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>
      <button type="button" className={btnGhost} onClick={() => void signInWithGoogle()}>
        Continue with Google
      </button>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Have an account?{" "}
        <Link to="/login" className="font-semibold text-primary">
          Log in
        </Link>
      </p>
    </Phone>
  );
}
