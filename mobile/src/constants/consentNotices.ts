// Single client-side source of truth for the optional-processing consent notices (location and push).
// The server-side registry (public.consent_notice_versions, see supabase/migrations/*_optional_processing_consents.sql)
// is the enforcement authority; __tests__/consent.test.ts fails if the two drift apart.
// To publish new notice text: change the text here, bump the version date here, and add a NEW migration that inserts the
// matching registry row. Never edit an existing registry row or migration.
// These are separate from the Terms/Privacy acceptance in legalVersions.ts.

export type ConsentPurpose = "location_discovery" | "push_notifications";

export const CONSENT_PURPOSES: readonly ConsentPurpose[] = ["location_discovery", "push_notifications"];

export const CONSENT_NOTICE_VERSIONS: Record<ConsentPurpose, string> = {
  location_discovery: "2026-10-18",
  push_notifications: "2026-10-18",
};

export interface ConsentNotice {
  title: string;
  body: string;
  agreeLabel: string;
  declineLabel: string;
}

// Plain-language, purpose-specific, and shown immediately before the OS permission prompt. Declining never blocks
// unrelated features: discovery by city, likes, matches and chat all work without either choice.
export const CONSENT_NOTICES: Record<ConsentPurpose, ConsentNotice> = {
  location_discovery: {
    title: "Use your location to find people nearby?",
    body:
      "Chahat will read your device location while the app is open and store only a rounded area (about 1 km), not your exact position. " +
      "It is used only to show people near you and an approximate distance to other members, who never see your coordinates. " +
      "This is optional: without it you can still discover people by city. " +
      "You can turn it off any time in Settings > Discovery & Privacy, which deletes the stored location.",
    agreeLabel: "Agree and continue",
    declineLabel: "Not now",
  },
  push_notifications: {
    title: "Turn on push notifications?",
    body:
      "Chahat will store a notification token for this device so it can alert you about new matches, messages, likes and incoming calls. " +
      "You choose which alerts you want in Settings. This is optional and the app works without it. " +
      "You can turn it off any time in Settings > Notifications, which removes your device token. " +
      "Your phone will then ask for its own notification permission; you can also change that in your device settings.",
    agreeLabel: "Agree and continue",
    declineLabel: "Not now",
  },
};
