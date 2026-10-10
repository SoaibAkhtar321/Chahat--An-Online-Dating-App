import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { MailCheck } from "lucide-react";
import { toast } from "sonner";
import { Phone, btnPrimary, btnGhost } from "@/components/milo/Phone";
import { useMilo } from "@/lib/milo-store";
import { resendConfirmation } from "@/lib/milo-cloud";
import { meta } from "@/lib/meta";

export const Route = createFileRoute("/verify")({
  head: () => meta("Check your email", "Confirm your email address to continue."),
  component: Verify,
});

function Verify() {
  const email = useMilo((s) => s.account?.email);
  const [cool, setCool] = useState(30);
  useEffect(() => {
    if (cool <= 0) return;
    const t = setTimeout(() => setCool(cool - 1), 1000);
    return () => clearTimeout(t);
  }, [cool]);

  return (
    <Phone className="flex flex-col px-6 py-10 text-center">
      <div className="mx-auto mt-10 grid size-20 place-items-center rounded-full bg-secondary text-primary">
        <MailCheck className="size-10" />
      </div>
      <h1 className="mt-6 text-3xl font-semibold">Check your inbox</h1>
      <p className="mt-2 text-muted-foreground">
        We sent a confirmation link to <b className="text-foreground">{email ?? "your email"}</b>.
        Open it on this or any device to continue.
      </p>
      <p className="mt-4 text-sm text-muted-foreground">Can't find it? Check your spam folder.</p>
      <div className="mt-auto space-y-3">
        <Link to="/login" className={btnPrimary}>
          I've confirmed, log in
        </Link>
        <button
          className={btnGhost}
          disabled={cool > 0 || !email}
          onClick={async () => {
            setCool(30);
            toast(
              (await resendConfirmation(email!))
                ? "New link sent"
                : "Couldn't resend right now. Try again shortly.",
            );
          }}
        >
          {cool > 0 ? `Resend in ${cool}s` : "Resend link"}
        </button>
        <Link to="/signup" className="block text-sm font-semibold text-muted-foreground">
          Wrong email? Change it
        </Link>
      </div>
    </Phone>
  );
}
