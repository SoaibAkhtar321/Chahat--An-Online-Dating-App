// Profile sharing (Instagram/LinkedIn style): a public https link that opens the profile in the app.
//
// Privacy rules:
//  * The link carries only the member id. It contains no name, photo, city or age, and the landing web page that
//    opens it shows no profile data either: the profile is only shown INSIDE the app, to a signed-in member, through
//    get_public_profile (which applies the normal visibility and block rules). Someone outside Chahat who receives the
//    link learns nothing about the person.
//  * The share text never includes another member's name (sharing someone else's profile must not reveal who it is
//    to people outside the app). Your own profile text says "my profile".
import { Linking, Share } from "react-native";
import { LEGAL_WEBSITE_BASE_URL } from "../constants/legalLinks";

/** Same website that hosts the legal pages; it serves /p/<id> (see docs/PROFILE_SHARING.md). */
export const PROFILE_SHARE_BASE_URL = LEGAL_WEBSITE_BASE_URL;
export const PROFILE_SHARE_PATH = "/p/";

const PROFILE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Member ids are auth UUIDs; anything else is rejected so a crafted link cannot route somewhere unexpected. */
export function isValidProfileId(id: unknown): id is string {
  return typeof id === "string" && PROFILE_ID_PATTERN.test(id);
}

export function buildProfileShareUrl(profileId: string): string {
  if (!isValidProfileId(profileId)) throw new Error("Invalid profile id");
  return `${PROFILE_SHARE_BASE_URL}${PROFILE_SHARE_PATH}${profileId.toLowerCase()}`;
}

/** Profile id from a shared link (https://…/p/<id> or chahat://p/<id>), or null. */
export function parseProfileShareUrl(url: string): string | null {
  const match = /^(?:https:\/\/[^/]+|chahat:\/\/)\/?p\/([^/?#]+)\/?(?:[?#].*)?$/i.exec(url.trim());
  if (!match) return null;
  const id = decodeURIComponent(match[1]);
  return isValidProfileId(id) ? id.toLowerCase() : null;
}

export function buildShareMessage(url: string, isOwnProfile: boolean): string {
  return isOwnProfile
    ? `Check out my profile on Chahat: ${url}`
    : `Check out this profile on Chahat: ${url}`;
}

export type ShareChannel = "copy" | "whatsapp" | "system";
export type ShareResult = { ok: true; channel: ShareChannel } | { ok: false; reason: "cancelled" | "unavailable" | "error" };

export interface ShareDeps {
  copy: (text: string) => Promise<unknown>;
  canOpen: (url: string) => Promise<boolean>;
  open: (url: string) => Promise<unknown>;
  share: (message: string, url: string) => Promise<{ action: string }>;
}

const defaultDeps = (): ShareDeps => ({
  copy: async (text) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Clipboard = require("expo-clipboard");
    await Clipboard.setStringAsync(text);
  },
  canOpen: (url) => Linking.canOpenURL(url),
  open: (url) => Linking.openURL(url),
  share: async (message) => Share.share({ message }),
});

export async function shareProfile(
  profileId: string,
  channel: ShareChannel,
  opts: { isOwnProfile: boolean },
  deps: ShareDeps = defaultDeps(),
): Promise<ShareResult> {
  let url: string;
  try {
    url = buildProfileShareUrl(profileId);
  } catch {
    return { ok: false, reason: "error" };
  }
  const message = buildShareMessage(url, opts.isOwnProfile);
  try {
    if (channel === "copy") {
      await deps.copy(url);
      return { ok: true, channel };
    }
    if (channel === "whatsapp") {
      const appUrl = `whatsapp://send?text=${encodeURIComponent(message)}`;
      if (await deps.canOpen(appUrl).catch(() => false)) {
        await deps.open(appUrl);
      } else {
        // WhatsApp not installed (or not visible to the app): wa.me works in the browser / WhatsApp Business.
        await deps.open(`https://wa.me/?text=${encodeURIComponent(message)}`);
      }
      return { ok: true, channel };
    }
    const res = await deps.share(message, url);
    return res.action === "dismissedAction" ? { ok: false, reason: "cancelled" } : { ok: true, channel };
  } catch {
    return { ok: false, reason: channel === "whatsapp" ? "unavailable" : "error" };
  }
}

// A shared link opened while signed out (or before onboarding) is remembered and opened once the member reaches
// the main app, instead of being lost at the login screen.
let pendingProfileId: string | null = null;
export function setPendingSharedProfile(id: string | null) {
  pendingProfileId = isValidProfileId(id) ? id.toLowerCase() : null;
}
export function takePendingSharedProfile(): string | null {
  const id = pendingProfileId;
  pendingProfileId = null;
  return id;
}
