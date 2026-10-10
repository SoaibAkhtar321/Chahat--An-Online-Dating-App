// DEMO review signals: simple, transparent rules. They are prompts for a human reviewer, never proof
// of misconduct, and never trigger automatic bans.
const CONTACT = /(\+?\d[\d\s-]{8,}\d)|(https?:\/\/|www\.)|(@[a-z0-9_]{3,})/i;
const MONEY =
  /\b(upi|paytm|gpay|gift ?card|bitcoin|crypto|send money|loan|invest(ment)?|western union)\b/i;

export function riskSignals(x: {
  bio: string;
  photos: number;
  openReports: number;
  createdAt?: number;
  texts?: string[];
}): string[] {
  const out: string[] = [];
  if (x.openReports > 0) out.push(`${x.openReports} open report${x.openReports > 1 ? "s" : ""}`);
  if (x.photos <= 1) out.push("Only one photo");
  if (x.bio.trim().length < 20) out.push("Very short or empty bio");
  const all = [x.bio, ...(x.texts ?? [])].join(" \n ");
  if (CONTACT.test(all)) out.push("Shares contact details or links");
  if (MONEY.test(all)) out.push("Mentions money or payments");
  if (x.createdAt && Date.now() - x.createdAt < 864e5) out.push("New account (under 24 h)");
  return out;
}
