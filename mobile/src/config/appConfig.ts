// Central, side-effect-free app configuration.
// Reports which external services are configured. Never throws, never calls the network,
// and reads only public EXPO_PUBLIC_* values. Secrets live in Supabase Edge Function secrets
// and EAS, never in the client bundle. See docs/SECRETS_CHECKLIST.md.

export type ServiceName =
  | "supabase"
  | "billing"
  | "push"
  | "calls"
  | "voiceMessages"
  | "coinTopup";

export interface ServiceStatus {
  configured: boolean;
  missing: string[];
}

export type ServiceStatusMap = Record<ServiceName, ServiceStatus>;
export type EnvSource = Record<string, string | undefined>;

// Expo inlines EXPO_PUBLIC_* values at bundle time ONLY for literal `process.env.EXPO_PUBLIC_X`
// references. Passing the whole `process.env` object does not work in a built app, so every
// public variable is read explicitly here. Add new public variables to this list.
export function readPublicEnv(): EnvSource {
  return {
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    EXPO_PUBLIC_FEATURE_BILLING: process.env.EXPO_PUBLIC_FEATURE_BILLING,
    EXPO_PUBLIC_FEATURE_PUSH: process.env.EXPO_PUBLIC_FEATURE_PUSH,
    EXPO_PUBLIC_FEATURE_CALLS: process.env.EXPO_PUBLIC_FEATURE_CALLS,
    EXPO_PUBLIC_FEATURE_VOICE_MESSAGES: process.env.EXPO_PUBLIC_FEATURE_VOICE_MESSAGES,
    EXPO_PUBLIC_FEATURE_COIN_TOPUP: process.env.EXPO_PUBLIC_FEATURE_COIN_TOPUP,
    // Public Agora App ID (an identifier, not a secret). The App Certificate stays on the server.
    EXPO_PUBLIC_AGORA_APP_ID: process.env.EXPO_PUBLIC_AGORA_APP_ID,
  };
}

const PLACEHOLDER_MARKERS = ["placeholder", "your-project", "your-supabase", "changeme"];

function clean(value: string | undefined): string {
  return (value ?? "").trim();
}

function isPlaceholder(value: string): boolean {
  const lower = value.toLowerCase();
  return PLACEHOLDER_MARKERS.some((marker) => lower.includes(marker));
}

function isSet(env: EnvSource, key: string): boolean {
  const value = clean(env[key]);
  return value.length > 0 && !isPlaceholder(value);
}

// A feature flag is on only when explicitly set to "true". Flags default to OFF so that a
// feature without its provider credentials is never shown to users.
function isFlagOn(env: EnvSource, key: string): boolean {
  return clean(env[key]) === "true";
}

function status(missing: string[]): ServiceStatus {
  return { configured: missing.length === 0, missing };
}

function flagStatus(env: EnvSource, flag: string): ServiceStatus {
  return status(isFlagOn(env, flag) ? [] : [flag]);
}

export function getServiceStatus(env: EnvSource = readPublicEnv()): ServiceStatusMap {
  const supabaseMissing: string[] = [];
  if (!isSet(env, "EXPO_PUBLIC_SUPABASE_URL")) supabaseMissing.push("EXPO_PUBLIC_SUPABASE_URL");
  if (
    !isSet(env, "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY") &&
    !isSet(env, "EXPO_PUBLIC_SUPABASE_ANON_KEY")
  ) {
    supabaseMissing.push("EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  }

  return {
    supabase: status(supabaseMissing),
    // Same flag already used by mobile/src/services/subscription.ts (BILLING_ENABLED).
    billing: flagStatus(env, "EXPO_PUBLIC_FEATURE_BILLING"),
    // Turn these on only after the matching server secrets and credentials are attached.
    push: flagStatus(env, "EXPO_PUBLIC_FEATURE_PUSH"),
    calls: flagStatus(env, "EXPO_PUBLIC_FEATURE_CALLS"),
    voiceMessages: flagStatus(env, "EXPO_PUBLIC_FEATURE_VOICE_MESSAGES"),
    coinTopup: flagStatus(env, "EXPO_PUBLIC_FEATURE_COIN_TOPUP"),
  };
}

export function isServiceConfigured(name: ServiceName, env: EnvSource = readPublicEnv()): boolean {
  return getServiceStatus(env)[name].configured;
}

export function getMissingConfig(env: EnvSource = readPublicEnv()): string[] {
  const all = getServiceStatus(env);
  return (Object.keys(all) as ServiceName[]).flatMap((name) => all[name].missing);
}
