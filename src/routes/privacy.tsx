import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/milo/LegalPage";
import { meta } from "@/lib/meta";

export const Route = createFileRoute("/privacy")({
  head: () => meta("Privacy Policy (draft)", "Draft Milo Privacy Policy, pending legal review."),
  component: () => <LegalPage title="Privacy Policy" sections={[
    ["Who can use Milo", "Milo is only for adults aged 18 and over. We don't knowingly collect data from anyone under 18."],
    ["What we collect", "Account details (email), profile information you choose to add (photos, bio, interests, spoken languages, intentions, optional voice intro), approximate location, messages, reports, call records and purchase status."],
    ["Location", "We use approximate location to show nearby people. Others only see a rounded distance, never your exact location or address. You can hide your distance in Settings."],
    ["How we use it", "To run matching, chat and calls; keep people safe (moderation and fraud signals); process subscriptions; and improve the service. Safety signals are reviewed by people and are not treated as proof on their own."],
    ["Sharing", "Your profile is visible to other members. We share data with service providers (hosting, payments, video calling, notifications) only as needed, and with authorities when legally required."],
    ["Your choices and rights", "Edit or hide your profile, control online status and read receipts, download your data, and delete your account at any time."],
    ["Retention and deletion", "When you delete your account, your profile is removed from the app. Some records may be kept for a limited time for safety, legal or billing reasons. Exact periods to be confirmed."],
    ["Security", "Data will be encrypted in transit and access-controlled on the server. Details to be confirmed after the production backend is built."],
  ]} />,
});
