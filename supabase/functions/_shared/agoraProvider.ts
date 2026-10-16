// Agora RTC adapter for the CallProvider interface. Server-side only.
// The Agora App Certificate never leaves the Edge Function; the client only receives a short-lived
// RTC token bound to one channel (the call id) and one user account (the verified user id).
//
// Agora channels are created implicitly on first join, so ensureRoom/endRoom hold no remote state.
// Enforcement of call length comes from the token's privilege expiry plus the server-owned call
// lifecycle (transition_video_call), not from the provider.
import type {
  CallProvider,
  CallProviderEnv,
  CallRoom,
  EnsureRoomInput,
  IssueJoinTokenInput,
  JoinGrant,
  ProviderResult,
} from "./callProvider.ts";

export interface AgoraTokenParams {
  appId: string;
  appCertificate: string;
  channel: string;
  account: string;
  ttlSeconds: number;
}

/** Injected so tests need no Agora SDK and the Deno-only import lives in one file. */
export type AgoraTokenBuilder = (params: AgoraTokenParams) => string;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TTL_SECONDS = 120;

export class AgoraCallProvider implements CallProvider {
  readonly name = "agora";
  readonly configured = true;

  constructor(
    private readonly appId: string,
    private readonly appCertificate: string,
    private readonly buildToken: AgoraTokenBuilder,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async ensureRoom(input: EnsureRoomInput): Promise<ProviderResult<CallRoom>> {
    if (!UUID.test(input.callId)) {
      return { ok: false, code: "provider_error", message: "Invalid call id." };
    }
    return { ok: true, value: { roomId: `call_${input.callId}` } };
  }

  async issueJoinToken(input: IssueJoinTokenInput): Promise<ProviderResult<JoinGrant>> {
    if (!input.roomId.startsWith("call_") || !UUID.test(input.participantId)) {
      return { ok: false, code: "provider_error", message: "Invalid room or participant." };
    }
    const ttl = Math.max(1, Math.min(MAX_TTL_SECONDS, Math.floor(input.ttlSeconds)));
    try {
      const token = this.buildToken({
        appId: this.appId,
        appCertificate: this.appCertificate,
        channel: input.roomId,
        account: input.participantId,
        ttlSeconds: ttl,
      });
      return {
        ok: true,
        value: {
          roomId: input.roomId,
          token,
          expiresAt: new Date(this.now() + ttl * 1000).toISOString(),
        },
      };
    } catch {
      return { ok: false, code: "provider_error", message: "Token generation failed." };
    }
  }

  async endRoom(): Promise<ProviderResult<void>> {
    return { ok: true, value: undefined };
  }
}

export function createAgoraProviderFactory(buildToken: AgoraTokenBuilder) {
  return (env: CallProviderEnv): CallProvider | null => {
    const appId = (env.AGORA_APP_ID ?? "").trim();
    const cert = (env.AGORA_APP_CERTIFICATE ?? "").trim();
    if (!/^[0-9a-f]{32}$/i.test(appId) || !/^[0-9a-f]{32}$/i.test(cert)) return null;
    return new AgoraCallProvider(appId, cert, buildToken);
  };
}
