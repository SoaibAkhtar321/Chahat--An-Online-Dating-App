import { supabase } from "./supabase";
import { LEGAL_DOCUMENT_VERSIONS } from "../constants/legalVersions";

export type LegalAcceptanceStatus = "accepted" | "required";

export interface AcceptLegalResult {
  success: boolean;
  error?: string;
  /** The server has newer documents than this app build knows about. */
  outdated?: boolean;
}

/** Has this user accepted the CURRENT Terms and Privacy versions? Reads only the caller's own rows (RLS). */
export async function fetchLegalStatus(userId: string): Promise<LegalAcceptanceStatus> {
  const { data, error } = await supabase
    .from("legal_acceptances")
    .select("id")
    .eq("user_id", userId)
    .eq("terms_version", LEGAL_DOCUMENT_VERSIONS.terms)
    .eq("privacy_version", LEGAL_DOCUMENT_VERSIONS.privacy)
    .limit(1);
  if (error) throw new Error(error.message);
  return data && data.length > 0 ? "accepted" : "required";
}

/** Records the signed-in user's acceptance server-side; the server only accepts the current versions. */
export async function acceptCurrentLegalDocuments(): Promise<AcceptLegalResult> {
  try {
    const { error } = await supabase.rpc("accept_current_legal_documents", {
      _terms_version: LEGAL_DOCUMENT_VERSIONS.terms,
      _privacy_version: LEGAL_DOCUMENT_VERSIONS.privacy,
      _method: "reacceptance_prompt",
    });
    if (error) {
      if ((error as { code?: string }).code === "22023") {
        return {
          success: false,
          outdated: true,
          error: "The legal documents have been updated. Please update Chahat to continue.",
        };
      }
      return { success: false, error: "Could not save your acceptance. Check your connection and try again." };
    }
    return { success: true };
  } catch {
    return { success: false, error: "Could not save your acceptance. Check your connection and try again." };
  }
}
