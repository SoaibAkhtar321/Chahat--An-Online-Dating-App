// Server-side call provider abstraction. Provider SDKs, credentials and token signing live ONLY
// behind this interface, inside Edge Functions. Nothing here is ever sent to the mobile client
// except the short-lived join grant returned by `issueJoinToken`.
//
// No real provider adapter ships in this build. `resolveCallProvider` therefore returns the
// explicit "not configured" provider unless a registered adapter is selected AND has its
// credentials. See docs/CALLS.md.

export type CallType = "audio" | "video";

export type ProviderFailureCode = "not_configured" | "provider_error";

export type ProviderResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: ProviderFailureCode; message: string };

export interface CallRoom {
  roomId: string;
}

export interface JoinGrant {
  roomId: string;
  token: string;
  /** ISO-8601 timestamp after which the provider rejects the token. */
  expiresAt: string;
}

export interface EnsureRoomInput {
  callId: string;
  callType: CallType;
}

export interface IssueJoinTokenInput {
  roomId: string;
  /** The authenticated user id, taken from the verified JWT, never from the request body. */
  participantId: string;
  callType: CallType;
  ttlSeconds: number;
}

export interface CallProvider {
  readonly name: string;
  readonly configured: boolean;
  /** Create the room for a call, or return the existing one (must be idempotent). */
  ensureRoom(input: EnsureRoomInput): Promise<ProviderResult<CallRoom>>;
  /** Issue a time-limited join token for exactly one participant. */
  issueJoinToken(input: IssueJoinTokenInput): Promise<ProviderResult<JoinGrant>>;
  /** Close the room. Must succeed (or report not-found as ok) when called twice. */
  endRoom(input: { roomId: string }): Promise<ProviderResult<void>>;
}

export class NotConfiguredCallProvider implements CallProvider {
  readonly name = "none";
  readonly configured = false;

  constructor(private readonly reason: string = "No call provider is configured.") {}

  private fail<T>(): ProviderResult<T> {
    return { ok: false, code: "not_configured", message: this.reason };
  }
  async ensureRoom(): Promise<ProviderResult<CallRoom>> {
    return this.fail();
  }
  async issueJoinToken(): Promise<ProviderResult<JoinGrant>> {
    return this.fail();
  }
  async endRoom(): Promise<ProviderResult<void>> {
    return this.fail();
  }
}

export type CallProviderEnv = Record<string, string | undefined>;

/**
 * A factory returns a provider, or null when its own credentials are missing. Real adapters
 * (for example Agora or ZEGOCLOUD) are added here in a later, explicitly approved change.
 */
export type CallProviderFactory = (env: CallProviderEnv) => CallProvider | null;

export const REGISTERED_CALL_PROVIDERS: Readonly<Record<string, CallProviderFactory>> = {};

export function resolveCallProvider(
  env: CallProviderEnv,
  registry: Readonly<Record<string, CallProviderFactory>> = REGISTERED_CALL_PROVIDERS,
): CallProvider {
  const selected = (env.CALL_PROVIDER ?? "").trim().toLowerCase();
  if (!selected) return new NotConfiguredCallProvider("CALL_PROVIDER is not set.");
  if (!Object.prototype.hasOwnProperty.call(registry, selected)) {
    return new NotConfiguredCallProvider("The selected call provider has no adapter in this build.");
  }
  let provider: CallProvider | null = null;
  try {
    provider = registry[selected](env);
  } catch {
    return new NotConfiguredCallProvider("The selected call provider failed to initialise.");
  }
  if (!provider || !provider.configured) {
    return new NotConfiguredCallProvider("The selected call provider is missing credentials.");
  }
  return provider;
}
