// Registers the Agora adapter at app start. Safe when the SDK or App ID is missing: the adapter then
// reports configured=false and every call entry point stays hidden (see isCallingAvailable).
import { registerCallMediaProvider } from "./callMedia";
import { agoraLoadError, createAgoraCallProvider } from "./agoraCallMedia";
import { isServiceConfigured } from "../config/appConfig";
import { requestCallToken } from "./callToken";
import { supabase } from "./supabase";
import { readPublicEnv } from "../config/appConfig";

let registered = false;

export function registerDefaultCallProvider(): void {
  if (registered) return;
  registered = true;
  const appId = (readPublicEnv().EXPO_PUBLIC_AGORA_APP_ID ?? "").trim();
  registerCallMediaProvider(
    createAgoraCallProvider({
      appId,
      getUserId: async () => (await supabase.auth.getSession()).data.session?.user?.id ?? null,
      renewToken: (callId) => requestCallToken(callId),
    }),
  );
}

/**
 * Plain reason calling is unavailable in this build (null when it is available). Shown in small print on the call
 * screen so a broken build can be diagnosed from a screenshot. Contains no secrets (the App ID is public anyway and
 * is never shown).
 */
export function callingUnavailableReason(): string | null {
  if (!isServiceConfigured("calls")) return "Calls are switched off in this build (EXPO_PUBLIC_FEATURE_CALLS).";
  if (!(readPublicEnv().EXPO_PUBLIC_AGORA_APP_ID ?? "").trim()) return "The Agora App ID was not included in this build (EXPO_PUBLIC_AGORA_APP_ID).";
  if (agoraLoadError) return `The calling SDK failed to load: ${agoraLoadError}`;
  return null;
}
