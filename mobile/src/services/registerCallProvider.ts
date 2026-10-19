// Registers the Agora adapter at app start. Safe when the SDK or App ID is missing: the adapter then
// reports configured=false and every call entry point stays hidden (see isCallingAvailable).
import { registerCallMediaProvider } from "./callMedia";
import { createAgoraCallProvider } from "./agoraCallMedia";
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
