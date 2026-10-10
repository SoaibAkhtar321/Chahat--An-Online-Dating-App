import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/milo/LegalPage";
import { meta } from "@/lib/meta";

export const Route = createFileRoute("/terms")({
  head: () =>
    meta("Terms of Service (draft)", "Draft Milo Terms of Service, pending legal review."),
  component: () => (
    <LegalPage
      title="Terms of Service"
      sections={[
        [
          "Eligibility (18+)",
          "You must be at least 18 years old to create an account or use Milo. Accounts found to belong to anyone under 18 will be removed.",
        ],
        [
          "Your account",
          "Give accurate information, keep your login private and don't create accounts for others or impersonate anyone.",
        ],
        [
          "Safety and conduct",
          "No harassment, hate, threats, scams, requests for money, sexual content involving minors, or illegal activity. Follow the Community Guidelines. We may restrict or remove accounts that break these rules.",
        ],
        [
          "User content",
          "You keep ownership of the photos, voice intros and text you post, and give Milo permission to host and display them to run the service. Don't post content you don't have rights to.",
        ],
        [
          "Matching and messaging",
          "Matching and text chat between matched users are free. We don't guarantee any number of Likes, Matches or replies.",
        ],
        [
          "Subscriptions and paid features",
          "Premium plans and optional purchases are billed through the app store. Prices, billing periods and renewal terms are shown before you buy. Subscriptions renew automatically until cancelled in the store. Paid calls after free time only continue after you explicitly agree to the price shown.",
        ],
        [
          "Termination",
          "You can delete your account at any time in Settings. We may suspend accounts that put others at risk.",
        ],
        ["Disclaimers and liability", "To be written by legal counsel."],
      ]}
    />
  ),
});
