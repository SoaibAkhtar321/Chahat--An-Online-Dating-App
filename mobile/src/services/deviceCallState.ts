// Stops Chahat from placing or answering a video call while the phone is already in a normal phone call or a
// WhatsApp / other VoIP call (the same way WhatsApp itself behaves). Reads Android's audio mode through the local
// native module in mobile/modules/call-state. Best effort: if the module is missing (tests, Expo Go, iOS, old
// builds) the check says "not busy" and nothing is blocked.
import { Platform } from "react-native";

// android.media.AudioManager modes
const MODE_RINGTONE = 1;
const MODE_IN_CALL = 2;
const MODE_IN_COMMUNICATION = 3;
const MODE_CALL_SCREENING = 4;

let nativeModule: { getAudioMode(): number } | null | undefined;

function loadModule(): { getAudioMode(): number } | null {
  if (nativeModule !== undefined) return nativeModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const expo = require("expo");
    nativeModule = expo.requireOptionalNativeModule?.("ChahatCallState") ?? null;
  } catch {
    nativeModule = null;
  }
  return nativeModule ?? null;
}

/** For tests. */
export function __setCallStateModuleForTests(mod: { getAudioMode(): number } | null | undefined) {
  nativeModule = mod;
}

export function isBusyAudioMode(mode: number): boolean {
  return mode === MODE_RINGTONE || mode === MODE_IN_CALL || mode === MODE_IN_COMMUNICATION || mode === MODE_CALL_SCREENING;
}

/** True when another call (phone or VoIP) is ringing or in progress on this phone. */
export function isPhoneInAnotherCall(): boolean {
  if (Platform.OS !== "android") return false;
  const mod = loadModule();
  if (!mod) return false;
  try {
    return isBusyAudioMode(Number(mod.getAudioMode()));
  } catch {
    return false;
  }
}

export const PHONE_BUSY_TITLE = "You're on another call";
export const PHONE_BUSY_MESSAGE = "End your current phone or WhatsApp call to start a video call on Chahat.";
export const PHONE_BUSY_ANSWER_MESSAGE = "End your current phone or WhatsApp call to answer this video call.";
