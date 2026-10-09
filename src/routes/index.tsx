import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Phone, Logo, btnPrimary, btnGhost } from "@/components/milo/Phone";
import { meta } from "@/lib/meta";
import { useMilo } from "@/lib/milo-store";
import p1 from "@/assets/p1.jpg";

export const Route = createFileRoute("/")({
  head: () => meta("Meet. Match. Connect.", "Milo is a warm, safe dating app for India. Try the interactive prototype."),
  component: Welcome,
});

const slides = [
  { t: "Meet people who get you", d: "Real profiles with the details that matter: intentions, interests, lifestyle." },
  { t: "Match only when it's mutual", d: "A match happens only when you both like each other. No surprises." },
  { t: "Safety, built in", d: "Block, report and unmatch anytime. Calls never become paid without your consent." },
];

function Welcome() {
  const [splash, setSplash] = useState(true);
  const [i, setI] = useState(0);
  const loggedIn = useMilo((s) => s.loggedIn);
  const onboarded = useMilo((s) => s.onboarded);
  useEffect(() => { const t = setTimeout(() => setSplash(false), 1400); return () => clearTimeout(t); }, []);
  useEffect(() => { const t = setInterval(() => setI((x) => (x + 1) % 3), 3500); return () => clearInterval(t); }, []);

  return (
    <Phone className="flex flex-col">
      <AnimatePresence>
        {splash && (
          <motion.div exit={{ opacity: 0 }} className="absolute inset-0 z-40 grid place-items-center bg-brand text-primary-foreground">
            <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-center">
              <Logo className="text-6xl" />
              <p className="mt-2 text-sm font-semibold tracking-widest uppercase opacity-90">Meet. Match. Connect.</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="relative h-[55%] shrink-0">
        <img src={p1} alt="" width={768} height={1024} className="size-full object-cover" />
        <div className="absolute inset-0 bg-photo-fade" />
        <Logo className="absolute left-6 top-6 text-4xl text-ink-foreground" />
      </div>
      <div className="flex flex-1 flex-col px-6 pb-8 pt-6">
        <AnimatePresence mode="wait">
          <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <h1 className="text-3xl font-semibold leading-tight">{slides[i]!.t}</h1>
            <p className="mt-2 text-muted-foreground">{slides[i]!.d}</p>
          </motion.div>
        </AnimatePresence>
        <div className="mt-4 flex gap-1.5">
          {slides.map((_, k) => <span key={k} className={`h-1.5 rounded-full transition-all ${k === i ? "w-6 bg-primary" : "w-1.5 bg-border"}`} />)}
        </div>
        <div className="mt-auto space-y-3">
          {loggedIn ? <Link to={onboarded ? "/discover" : "/onboarding"} className={btnPrimary}>Continue to Milo</Link> : <Link to="/signup" className={btnPrimary}>Create account</Link>}
          <Link to="/login" className={btnGhost}>I already have an account</Link>
          <p className="text-center text-xs text-muted-foreground">18+ only. By continuing you agree to our Terms and Privacy Policy.</p>
        </div>
      </div>
    </Phone>
  );
}
