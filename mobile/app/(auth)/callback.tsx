import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
// TODO: change this import to wherever your Supabase client is created
import { supabase } from '../../src/services/supabase';

WebBrowser.maybeCompleteAuthSession();

// Lets the callback screen know Google sign-in is handling the redirect.
export const googleAuth = { inProgress: false };

export async function signInWithGoogle(): Promise<{ success: boolean; error?: string }> {
  googleAuth.inProgress = true;
  try {
    const redirectTo = Linking.createURL("auth/callback");

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error || !data?.url) {
      return { success: false, error: error?.message ?? "Could not start Google sign-in." };
    }

    const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (res.type !== "success") return { success: false, error: "Sign-in cancelled." };

    const url = res.url;
    const query = url.includes("?") ? url.split("?")[1].split("#")[0] : "";
    const fragment = url.includes("#") ? url.split("#")[1] : "";
    const params = new URLSearchParams(fragment || query);

    const errorDescription = params.get("error_description");
    if (errorDescription) return { success: false, error: errorDescription };

    const code = params.get("code");
    if (code) {
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
      if (exchangeError) return { success: false, error: exchangeError.message };
      return { success: true };
    }

    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");
    if (access_token && refresh_token) {
      const { error: sessionError } = await supabase.auth.setSession({ access_token, refresh_token });
      if (sessionError) return { success: false, error: sessionError.message };
      return { success: true };
    }

    return { success: false, error: "No session returned from Google." };
  } catch (e: any) {
    return { success: false, error: e?.message ?? "Google sign-in failed." };
  } finally {
    setTimeout(() => {
      googleAuth.inProgress = false;
    }, 1500);
  }
}