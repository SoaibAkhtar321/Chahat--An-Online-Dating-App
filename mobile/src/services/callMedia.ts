// Client-side call media abstraction. The app talks only to these interfaces; a real video
// call SDK (Agora, ZEGOCLOUD, ...) is added later as one adapter that implements CallMediaProvider.
// Until an adapter is registered (and its SDK is present) calling is reported as unavailable instead of being faked.
import { isServiceConfigured } from "../config/appConfig";

export type CallMediaType = "video";

export type CallErrorCode =
  | "calling_disabled"
  | "provider_not_configured"
  | "unauthenticated"
  | "rate_limited"
  | "insufficient_coins"
  | "allowance_ended"
  | "call_unavailable"
  | "permission_denied"
  | "network"
  | "provider_error"
  | "invalid_state";

/** Shown when today's free video-call time is used up. There is no coin concept in the app. */
export const PREMIUM_CALL_MESSAGE =
  "Your free video-call time for today is over. Get Premium to keep calling, with up to 5 minutes of video calling every day.";

/** True for errors that should offer the Premium upgrade. */
export function isPremiumCallError(code: CallErrorCode | undefined): boolean {
  return code === "insufficient_coins" || code === "allowance_ended";
}

const USER_MESSAGES: Record<CallErrorCode, string> = {
  calling_disabled: "Calling is not available yet.",
  provider_not_configured: "Calling is not available yet.",
  unauthenticated: "Please sign in again to join the call.",
  rate_limited: "Too many call attempts. Please wait a moment and try again.",
  insufficient_coins: PREMIUM_CALL_MESSAGE,
  allowance_ended: PREMIUM_CALL_MESSAGE,
  call_unavailable: "This call is no longer available.",
  permission_denied: "Microphone or camera permission is needed to join the call.",
  network: "Network problem. Check your connection and try again.",
  provider_error: "Could not start the call. Please try again.",
  invalid_state: "That action isn't available right now.",
};

export class CallError extends Error {
  readonly code: CallErrorCode;
  constructor(code: CallErrorCode, message?: string) {
    super(message ?? USER_MESSAGES[code]);
    this.name = "CallError";
    this.code = code;
  }
}

export function toCallError(cause: unknown): CallError {
  if (cause instanceof CallError) return cause;
  return new CallError("provider_error");
}

/** Short-lived join information returned by the issue-call-token Edge Function. */
export interface CallJoinGrant {
  provider: string;
  roomId: string;
  token: string;
  expiresAt: string;
  callType: CallMediaType;
}

export interface CallMediaSession {
  setMicrophoneEnabled(enabled: boolean): Promise<void>;
  setCameraEnabled(enabled: boolean): Promise<void>;
  /** Front/back camera. Optional: providers without it simply do not show the button. */
  switchCamera?(): Promise<void>;
  leave(): Promise<void>;
  /** Called when the provider drops the session (remote hang-up, network loss, time allowance over). */
  onEnded(listener: (reason?: CallErrorCode) => void): () => void;
}

export interface CallMediaProvider {
  readonly name: string;
  readonly configured: boolean;
  requestPermissions(callType: CallMediaType): Promise<boolean>;
  join(grant: CallJoinGrant, options: { callType: CallMediaType }): Promise<CallMediaSession>;
}

export const notConfiguredMediaProvider: CallMediaProvider = {
  name: "none",
  configured: false,
  async requestPermissions() {
    return false;
  },
  async join() {
    throw new CallError("provider_not_configured");
  },
};

// Register real adapters here in a later, explicitly approved change.
let activeProvider: CallMediaProvider = notConfiguredMediaProvider;

export function getCallMediaProvider(): CallMediaProvider {
  return activeProvider;
}

/** Registers the real SDK adapter once at app start (see registerCallProvider.ts). */
export function registerCallMediaProvider(provider: CallMediaProvider): void {
  activeProvider = provider;
}

/** Test seam; production code never calls this. */
export function setCallMediaProviderForTests(provider: CallMediaProvider | null): void {
  activeProvider = provider ?? notConfiguredMediaProvider;
}

/**
 * Single UI gate for every call entry point. True only when the feature flag is on AND a media
 * provider adapter is present, so no control ever implies a connection that cannot exist.
 */
export function isCallingAvailable(
  flagOn: boolean = isServiceConfigured("calls"),
  provider: CallMediaProvider = getCallMediaProvider(),
): boolean {
  return flagOn && provider.configured;
}

/** Shown to Premium/Plus/VIP callers whose 5 minutes for today are used (never an upgrade pitch). */
export const PAID_ALLOWANCE_USED_MESSAGE =
  "You've used today's 5 minutes of video calling. It renews at midnight (India time).";

/** Turns a raw server/database error from the call RPCs into a sentence a member understands. */
export function friendlyCallError(cause: unknown, fallback: string): string {
  const raw = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
  const m = raw.toLowerCase();
  if (m.includes("already has an active call")) return "One of you is already on a call. Try again in a minute.";
  if (m.includes("too many call attempts")) return "Too many call attempts. Please wait a few minutes and try again.";
  if (m.includes("active unblocked match required") || m.includes("not eligible to call"))
    return "You can only call people you are matched with.";
  if (m.includes("used today's video-call time") || m.includes("daily_call_allowance_used"))
    return "The caller has used today's video-call time. It renews at midnight (India time).";
  if (m.includes("call not found")) return "This call is no longer available.";
  if (m.includes("authentication required") || m.includes("jwt")) return "Please sign in again to make calls.";
  if (m.includes("network") || m.includes("fetch")) return "No internet connection. Check your connection and try again.";
  return fallback;
}
