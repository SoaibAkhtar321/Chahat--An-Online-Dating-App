// Deno-only: wraps Agora's official token library (RTC token v007). Kept separate so unit tests
// never import it.
import { RtcRole, RtcTokenBuilder } from "npm:agora-token@2.0.5";
import type { AgoraTokenParams } from "./agoraProvider.ts";

export function buildAgoraRtcToken(p: AgoraTokenParams): string {
  return RtcTokenBuilder.buildTokenWithUserAccount(
    p.appId,
    p.appCertificate,
    p.channel,
    p.account,
    RtcRole.PUBLISHER,
    p.ttlSeconds,
    p.ttlSeconds,
  );
}
