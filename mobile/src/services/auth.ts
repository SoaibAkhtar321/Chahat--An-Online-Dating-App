import { supabase, isSupabaseConfigured, getConfigStatus } from "./supabase";
import * as Linking from "expo-linking";
import { clearNotificationState, unregisterPushNotificationToken } from "./notifications";
import { LEGAL_ACCEPTANCE_METADATA_KEY, type LegalAcceptanceClaim } from "../constants/legalVersions";

export interface AuthResult {
  success: boolean;
  error?: string;
  isUnconfirmed?: boolean;
}

const CONFIG_ERROR =
  "Backend connection not configured: Please provide EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in mobile/.env.";

// `legalAcceptance` must only be passed after the user explicitly ticked the Terms/Privacy checkbox. It travels as signup
// metadata and is recorded server-side only after e-mail confirmation (see the legal_acceptances migration).
export async function signUpUser(
  email: string,
  password: string,
  legalAcceptance?: LegalAcceptanceClaim,
): Promise<AuthResult> {
  if (!isSupabaseConfigured()) {
    const { missing } = getConfigStatus();
    return {
      success: false,
      error: `Backend credentials required: Missing ${missing.join(", ")} in mobile/.env`,
    };
  }

  try {
    const cleanEmail = email.trim().toLowerCase();
    const { data, error } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        emailRedirectTo: Linking.createURL("callback"),
        ...(legalAcceptance ? { data: { [LEGAL_ACCEPTANCE_METADATA_KEY]: legalAcceptance } } : {}),
      },
    });

    if (error) {
      if (/registered|exists/i.test(error.message)) {
        return {
          success: false,
          error: "An account with this email already exists. Please log in.",
        };
      }
      if (/rate.*limit|too many requests|over_email_send_rate_limit/i.test(error.message)) {
        return {
          success: false,
          error:
            "Too many sign-up attempts. For security, please wait 60 seconds before trying again.",
        };
      }
      return { success: false, error: error.message };
    }

    if (data.user && data.user.identities && data.user.identities.length === 0) {
      return { success: false, error: "An account with this email already exists." };
    }

    return { success: true };
  } catch (err: any) {
    if (/rate.*limit|too many requests/i.test(err?.message || "")) {
      return {
        success: false,
        error:
          "Too many sign-up attempts. For security, please wait 60 seconds before trying again.",
      };
    }
    return { success: false, error: err.message || "Failed to sign up" };
  }
}

export async function signInUser(email: string, password: string): Promise<AuthResult> {
  if (!isSupabaseConfigured()) {
    const { missing } = getConfigStatus();
    return {
      success: false,
      error: `Backend credentials required: Missing ${missing.join(", ")} in mobile/.env`,
    };
  }

  try {
    const cleanEmail = email.trim().toLowerCase();
    const { data: currentSession, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    const currentUser = currentSession.session?.user;
    if (currentUser && currentUser.email?.trim().toLowerCase() !== cleanEmail) {
      const unregisterResult = await unregisterPushNotificationToken(currentUser.id);
      if (!unregisterResult.success) {
        console.warn(
          "Could not unregister prior account push token before account switch:",
          unregisterResult.error,
        );
        return {
          success: false,
          error: `Could not securely switch accounts: ${unregisterResult.error}`,
        };
      }
    }
    const { data, error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });

    if (error) {
      if (/confirm/i.test(error.message)) {
        return {
          success: false,
          isUnconfirmed: true,
          error: "Please verify your email address to continue.",
        };
      }
      if (/rate.*limit|too many requests/i.test(error.message)) {
        return {
          success: false,
          error: "Too many sign-in attempts. Please wait 60 seconds before trying again.",
        };
      }
      if (/invalid/i.test(error.message)) {
        return { success: false, error: "Incorrect email or password." };
      }
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    if (/rate.*limit|too many requests/i.test(err?.message || "")) {
      return {
        success: false,
        error: "Too many sign-in attempts. Please wait 60 seconds before trying again.",
      };
    }
    return { success: false, error: err.message || "Failed to sign in" };
  }
}

export async function signOutUser(): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const { data, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const userId = data.session?.user.id;
  if (userId) {
    const tokenResult = await unregisterPushNotificationToken(userId);
    if (!tokenResult.success) {
      throw new Error(`Could not securely sign out: ${tokenResult.error}`);
    }
  }
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
  if (userId) await clearNotificationState(userId);
}

export async function resetPassword(email: string): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: CONFIG_ERROR };
  }

  try {
    const cleanEmail = email.trim().toLowerCase();
    const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo: Linking.createURL("callback", { queryParams: { flow: "recovery" } }),
    });
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || "Could not send reset email" };
  }
}

export interface AuthLinkResult {
  success: boolean;
  flow: "recovery" | "confirmation";
  error?: string;
}

export async function completeAuthLink(url: string): Promise<AuthLinkResult> {
  let flow: AuthLinkResult["flow"] = "confirmation";
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "chahat:" ||
      (parsed.hostname !== "callback" && parsed.pathname !== "/callback")
    ) {
      return { success: false, flow, error: "This is not a recognized Chahat account link." };
    }
    const params = new URLSearchParams(parsed.search);
    const fragment = new URLSearchParams(parsed.hash.replace(/^#/, ""));
    flow = params.get("flow") === "recovery" ? "recovery" : "confirmation";
    const providerError = params.get("error_description") || fragment.get("error_description");
    if (providerError) return { success: false, flow, error: providerError };

    const code = params.get("code");
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) return { success: false, flow, error: error.message };
      return { success: true, flow };
    }

    const accessToken = fragment.get("access_token");
    const refreshToken = fragment.get("refresh_token");
    if (accessToken && refreshToken) {
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) return { success: false, flow, error: error.message };
      return { success: true, flow };
    }

    return {
      success: false,
      flow,
      error: "This sign-in link is incomplete or has expired. Request a new link and try again.",
    };
  } catch (error) {
    return {
      success: false,
      flow,
      error: error instanceof Error ? error.message : "Could not process the sign-in link.",
    };
  }
}

export async function updateRecoveryPassword(
  password: string,
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) return { success: false, error: CONFIG_ERROR };
  try {
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) return { success: false, error: sessionError.message };
    if (!data.session) {
      return {
        success: false,
        error: "The password reset session is missing. Request a new reset link.",
      };
    }
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return { success: false, error: error.message };
    const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
    if (signOutError) return { success: false, error: signOutError.message };
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Could not update the password.",
    };
  }
}

export async function resendConfirmation(
  email: string,
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: CONFIG_ERROR };
  }

  try {
    const cleanEmail = email.trim().toLowerCase();
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: cleanEmail,
    });
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || "Could not resend confirmation email" };
  }
}

export interface DeleteAccountResult {
  success: boolean;
  error?: string;
  /** The session is no longer valid (HTTP 401); the person must log in again before retrying. */
  sessionExpired?: boolean;
  /** The delete-account Edge Function is not reachable on this backend (HTTP 404, e.g. not deployed). */
  unavailable?: boolean;
  /** The server said a retry is safe (partial failure) or the request never reached it. */
  retryable?: boolean;
  /** Set when the server deletion succeeded but local sign-out could not be completed. */
  warning?: string;
}

const SESSION_EXPIRED_MESSAGE =
  "Your session is no longer valid. If you were in the middle of deleting your account it may already be complete. Try logging in again: if login fails, the deletion finished; if it works, retry deleting your account.";
const UNAVAILABLE_MESSAGE =
  "Account deletion isn't available right now. Please try again later or contact support.";
const NETWORK_MESSAGE = "Could not reach the server. Check your connection and try again.";
const DELETE_FAILED_MESSAGE = "Could not delete your account right now. Please try again.";

/**
 * supabase-js puts the failed Response on `error.context`, so `data` is null on non-2xx replies.
 * Read the status and (if present) the function's JSON body defensively.
 */
async function readFunctionError(
  error: any,
): Promise<{ status?: number; body?: { error?: unknown; retryable?: unknown } }> {
  const ctx = error?.context;
  const status = typeof ctx?.status === "number" ? ctx.status : undefined;
  let body: { error?: unknown; retryable?: unknown } | undefined;
  try {
    if (ctx && typeof ctx.json === "function") {
      const parsed = await ctx.json();
      if (parsed && typeof parsed === "object") body = parsed;
    }
  } catch {
    // Response body was not JSON; fall back to the status code.
  }
  return { status, body };
}

/**
 * Deletes the signed-in user's account through the `delete-account` Edge Function (server side:
 * Storage objects, database rows via purge_user_data, then the Auth user). The user id comes from the
 * verified JWT on the server; the request body only carries the confirmation flag. The local session
 * is cleared only after the function reports success. The function must be deployed for this to work
 * (see docs/ACCOUNT_DELETION.md).
 */
export async function deleteUserAccount(): Promise<DeleteAccountResult> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: CONFIG_ERROR };
  }

  try {
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData.user?.id;
    const { data, error } = await supabase.functions.invoke("delete-account", {
      body: { confirm: true },
    });

    if (error) {
      if ((error as any).name === "FunctionsFetchError") {
        return { success: false, error: NETWORK_MESSAGE, retryable: true };
      }
      const { status, body } = await readFunctionError(error);
      if (status === 401) {
        return { success: false, sessionExpired: true, error: SESSION_EXPIRED_MESSAGE };
      }
      if (status === 404) {
        return { success: false, unavailable: true, error: UNAVAILABLE_MESSAGE };
      }
      return {
        success: false,
        error: typeof body?.error === "string" ? body.error : DELETE_FAILED_MESSAGE,
        retryable: body?.retryable === true,
      };
    }

    if (!data || data.success !== true) {
      return {
        success: false,
        error: typeof data?.error === "string" ? data.error : DELETE_FAILED_MESSAGE,
      };
    }

    let cleanupWarning: string | undefined;
    if (userId) {
      try {
        await clearNotificationState(userId, true);
      } catch (cleanupError) {
        console.error("Account deleted but local notification cleanup failed:", cleanupError);
        cleanupWarning =
          "Your account was deleted, but some local notification data could not be cleared.";
      }
    }

    // Server reported success (the Auth user is gone): clear the local session without a server call.
    try {
      const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
      if (signOutError) {
        return {
          success: true,
          warning:
            cleanupWarning ||
            "Your account was deleted but you could not be signed out automatically.",
        };
      }
    } catch {
      return {
        success: true,
        warning:
          cleanupWarning ||
          "Your account was deleted but you could not be signed out automatically.",
      };
    }
    return { success: true, ...(cleanupWarning ? { warning: cleanupWarning } : {}) };
  } catch (err: any) {
    return { success: false, error: err?.message || DELETE_FAILED_MESSAGE };
  }
}
