import { supabase, isSupabaseConfigured } from "./supabase";
import {
  CONSENT_NOTICE_VERSIONS,
  CONSENT_NOTICES,
  type ConsentPurpose,
} from "../constants/consentNotices";
import { Alert } from "../utils/alert";

export type ConsentDecision = "granted" | "withdrawn";

export interface ConsentState {
  purpose: ConsentPurpose;
  /** null = the user has never decided. */
  decision: ConsentDecision | null;
  /** Notice version the latest decision was made under. */
  noticeVersion: string | null;
  /** The newest published notice version known to the server. */
  currentNoticeVersion: string;
}

export interface SetConsentResult {
  success: boolean;
  /** The server has a newer notice than this app build shows. */
  outdated?: boolean;
  error?: string;
}

interface ConsentRow {
  purpose: string;
  current_notice_version: string;
  decision: string | null;
  notice_version: string | null;
}

function isPurpose(value: string): value is ConsentPurpose {
  return value === "location_discovery" || value === "push_notifications";
}

/** Latest decision per purpose for the signed-in user (RLS: own rows only). Throws on failure. */
export async function fetchMyConsents(): Promise<Record<ConsentPurpose, ConsentState>> {
  const empty = (purpose: ConsentPurpose): ConsentState => ({
    purpose,
    decision: null,
    noticeVersion: null,
    currentNoticeVersion: CONSENT_NOTICE_VERSIONS[purpose],
  });
  const result: Record<ConsentPurpose, ConsentState> = {
    location_discovery: empty("location_discovery"),
    push_notifications: empty("push_notifications"),
  };
  if (!isSupabaseConfigured()) return result;

  const { data, error } = await supabase.rpc("get_my_consents");
  if (error) throw new Error(`Could not load your choices: ${error.message}`);
  for (const row of (data ?? []) as ConsentRow[]) {
    if (!isPurpose(row.purpose)) continue;
    result[row.purpose] = {
      purpose: row.purpose,
      decision: row.decision === "granted" || row.decision === "withdrawn" ? row.decision : null,
      noticeVersion: row.notice_version,
      currentNoticeVersion: row.current_notice_version,
    };
  }
  return result;
}

/** True only when the latest recorded decision is a grant. Any failure reads as "not granted" (fail closed). */
export async function hasConsent(purpose: ConsentPurpose): Promise<boolean> {
  try {
    return (await fetchMyConsents())[purpose].decision === "granted";
  } catch {
    return false;
  }
}

/** Records a decision server-side (server time and identity; only the current notice version can be granted). */
export async function setConsent(
  purpose: ConsentPurpose,
  decision: ConsentDecision,
): Promise<SetConsentResult> {
  if (!isSupabaseConfigured()) return { success: false, error: "This needs a configured backend." };
  try {
    const { error } = await supabase.rpc("set_my_consent", {
      _purpose: purpose,
      _notice_version: CONSENT_NOTICE_VERSIONS[purpose],
      _decision: decision,
      _method: decision === "granted" ? "in_app_notice" : "settings_toggle",
    });
    if (error) {
      if ((error as { code?: string }).code === "22023") {
        return {
          success: false,
          outdated: true,
          error: "This choice has been updated. Please update Chahat to continue.",
        };
      }
      return { success: false, error: "Could not save your choice. Check your connection and try again." };
    }
    return { success: true };
  } catch {
    return { success: false, error: "Could not save your choice. Check your connection and try again." };
  }
}

/** Shows the purpose-specific notice and resolves true only on an explicit tap of the agree button. */
export function confirmConsentNotice(purpose: ConsentPurpose): Promise<boolean> {
  const notice = CONSENT_NOTICES[purpose];
  return new Promise((resolve) => {
    Alert.alert(notice.title, notice.body, [
      { text: notice.declineLabel, style: "cancel", onPress: () => resolve(false) },
      { text: notice.agreeLabel, onPress: () => resolve(true) },
    ]);
  });
}

/**
 * Makes sure the user has consented to this purpose: returns true immediately if already granted, otherwise shows the
 * notice and records a grant on an explicit agree. Navigating away or declining records nothing.
 */
export async function ensureConsent(purpose: ConsentPurpose): Promise<boolean> {
  if (await hasConsent(purpose)) return true;
  if (!(await confirmConsentNotice(purpose))) return false;
  const result = await setConsent(purpose, "granted");
  if (!result.success) {
    Alert.alert("Could not save your choice", result.error ?? "Please try again.");
    return false;
  }
  return true;
}
