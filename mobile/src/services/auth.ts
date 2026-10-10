import { supabase, isSupabaseConfigured, getConfigStatus } from "./supabase";

export interface AuthResult {
  success: boolean;
  error?: string;
  isUnconfirmed?: boolean;
}

const CONFIG_ERROR =
  "Backend connection not configured: Please provide EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in mobile/.env.";

export async function signUpUser(email: string, password: string): Promise<AuthResult> {
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
    });

    if (error) {
      if (/registered|exists/i.test(error.message)) {
        return {
          success: false,
          error: "An account with this email already exists. Please log in.",
        };
      }
      return { success: false, error: error.message };
    }

    if (data.user && data.user.identities && data.user.identities.length === 0) {
      return { success: false, error: "An account with this email already exists." };
    }

    return { success: true };
  } catch (err: any) {
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
      if (/invalid/i.test(error.message)) {
        return { success: false, error: "Incorrect email or password." };
      }
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to sign in" };
  }
}

export async function signOutUser(): Promise<void> {
  try {
    if (isSupabaseConfigured()) {
      await supabase.auth.signOut();
    }
  } catch (err) {
    console.error("Sign out error", err);
  }
}

export async function resetPassword(email: string): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: CONFIG_ERROR };
  }

  try {
    const cleanEmail = email.trim().toLowerCase();
    const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || "Could not send reset email" };
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

export async function deleteUserAccount(): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: CONFIG_ERROR };
  }

  try {
    const { error } = await supabase.rpc("delete_user_account");
    if (error) {
      await supabase
        .from("profiles")
        .delete()
        .eq("id", (await supabase.auth.getUser()).data.user?.id ?? "");
    }
    await supabase.auth.signOut();
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to delete account" };
  }
}
