// Single client-side source of truth for the published legal document versions.
// The server-side registry (public.legal_document_versions, see supabase/migrations/*_legal_acceptances.sql) is the
// enforcement authority; __tests__/legalVersions.test.ts fails if the two drift apart.
// To publish a new version: update the legal text, bump the date here, and add a NEW migration that inserts the
// matching registry row. Never edit an existing registry row or migration.
export const LEGAL_DOCUMENT_VERSIONS = {
  terms: "2026-10-18",
  privacy: "2026-10-18",
} as const;

/** Key under which the signup choice travels in Supabase user metadata (read by the confirmation trigger). */
export const LEGAL_ACCEPTANCE_METADATA_KEY = "legal_acceptance";

export interface LegalAcceptanceClaim {
  terms_version: string;
  privacy_version: string;
}

/** The versions the user is being shown at this moment. Only build this after an explicit user action. */
export function currentLegalAcceptanceClaim(): LegalAcceptanceClaim {
  return {
    terms_version: LEGAL_DOCUMENT_VERSIONS.terms,
    privacy_version: LEGAL_DOCUMENT_VERSIONS.privacy,
  };
}
