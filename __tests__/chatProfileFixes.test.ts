// Fixes from the 2026-10-30 device test: chat keyboard/cursor/menu/photos, blocked accounts, shared-profile likes,
// share sheet, edit-profile layout, app name, notification icon, and no calls while the phone is in another call.
// Server side: supabase/tests/83_profile_actions_block_list.sql.
import fs from "fs";
import path from "path";

const mockRpc = jest.fn();
jest.mock("../mobile/src/services/supabase", () => ({
  isSupabaseConfigured: () => true,
  supabase: { rpc: (...args: any[]) => mockRpc(...args), auth: { getUser: async () => ({ data: { user: { id: "me" } } }) } },
}));
jest.mock("expo-crypto", () => ({}));
const mockAlert = jest.fn();
jest.mock("../mobile/src/utils/alert", () => ({ Alert: { alert: (...a: any[]) => mockAlert(...a) } }));

import { MAX_PHOTOS_PER_SEND, addPickedPhotos } from "../mobile/src/utils/chatPhotos";
import { parseProfileActions, profileActionNote, getProfileActions } from "../mobile/src/services/profileActions";
import { fetchBlockedUsers } from "../mobile/src/services/moderation";
import {
  __setCallStateModuleForTests,
  isBusyAudioMode,
  isPhoneInAnotherCall,
} from "../mobile/src/services/deviceCallState";
import { startVideoCallIfAllowed } from "../mobile/src/services/callAllowanceGate";

const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

beforeEach(() => {
  mockRpc.mockReset();
  mockAlert.mockReset();
  __setCallStateModuleForTests(undefined);
});

describe("several photos per send", () => {
  it("keeps order, drops duplicates, caps at the limit", () => {
    expect(addPickedPhotos(["a"], ["b", "a", "c"])).toEqual(["a", "b", "c"]);
    const many = Array.from({ length: 15 }, (_, i) => `p${i}`);
    expect(addPickedPhotos([], many)).toHaveLength(MAX_PHOTOS_PER_SEND);
  });
  it("chat picker allows multiple selection and sends the rest after the first", () => {
    const chat = read("mobile/app/chat/[id].tsx");
    expect(chat).toMatch(/allowsMultipleSelection: true/);
    expect(chat).toMatch(/for \(const extra of images\.slice\(1\)\)/);
  });
});

describe("chat screen", () => {
  const chat = read("mobile/app/chat/[id].tsx");
  it("text box stays above the keyboard (edge-to-edge Android)", () => {
    expect(chat).toMatch(/<KeyboardAvoidingView\s+behavior="padding"/);
    expect(chat).not.toMatch(/behavior=\{undefined\}/);
  });
  it("placeholder fits one line so the cursor sits at the start of the line", () => {
    expect(chat).toContain('placeholder="Type a message…"');
    expect(chat).not.toContain("Type a message or use icebreaker");
  });
  it("menu closes when tapping anywhere outside it", () => {
    expect(chat).toMatch(/testID="chat-menu-backdrop"/);
    expect(chat).toMatch(/onPress=\{\(\) => setMenuVisible\(false\)\}/);
  });
  it("block/unmatch explain what happens and where to unblock", () => {
    expect(chat).toMatch(/Settings → Blocked accounts/);
    expect(chat).toMatch(/won't see each other in Discover again/);
  });
});

describe("profile actions (shared links, chat, Discover)", () => {
  it("parses the server answer", () => {
    expect(
      parseProfileActions({ available: true, match_id: "m1", can_like: false, reason: "matched", your_preference: "woman" }),
    ).toEqual({ available: true, self: false, matchId: "m1", canLike: false, reason: "matched", yourPreference: "woman" });
    expect(parseProfileActions(null).canLike).toBe(false);
    expect(parseProfileActions({ reason: "something_else" }).reason).toBeNull();
  });
  it("explains preference mismatch without saying whose preference", () => {
    const note = profileActionNote(parseProfileActions({ available: true, reason: "preferences_dont_match", your_preference: "woman" }), "Ravi")!;
    expect(note).toMatch(/looking for women/);
    expect(note).toMatch(/still view and share/);
    expect(profileActionNote(parseProfileActions({ available: true, can_like: true }), "Ravi")).toBeNull();
  });
  it("asks the server about the viewed profile", async () => {
    mockRpc.mockResolvedValue({ data: { available: true, can_like: true }, error: null });
    expect((await getProfileActions("abc")).canLike).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith("get_profile_actions", { _id: "abc" });
    mockRpc.mockResolvedValue({ data: null, error: { message: "x" } });
    expect((await getProfileActions("abc")).canLike).toBe(false);
  });
  it("profile screen likes THIS profile, not the top Discover card; shows Message for a match", () => {
    const screen = read("mobile/app/profile/[id].tsx");
    expect(screen).toMatch(/swipeProfile\(targetProfile\.id, dir\)/);
    expect(screen).not.toMatch(/swipeCard\(/);
    expect(screen).toMatch(/testID="profile-message"/);
    expect(read("mobile/src/context/MiloContext.tsx")).toMatch(/submitSwipe\(targetId, direction, user\.id\)/);
  });
});

describe("blocked accounts", () => {
  it("lists own blocks", async () => {
    mockRpc.mockResolvedValue({ data: [{ id: "u1", name: "Asha", blocked_at: "2026-10-30T10:00:00Z" }, { bad: 1 }], error: null });
    expect(await fetchBlockedUsers()).toEqual([{ id: "u1", name: "Asha", blockedAt: "2026-10-30T10:00:00Z" }]);
    mockRpc.mockResolvedValue({ data: null, error: { message: "x" } });
    expect(await fetchBlockedUsers()).toEqual([]);
  });
  it("settings links to the screen and the route is registered", () => {
    expect(read("mobile/app/settings/index.tsx")).toMatch(/router\.push\("\/settings\/blocked"\)/);
    expect(read("mobile/app/_layout.tsx")).toMatch(/name="settings\/blocked"/);
    expect(read("mobile/app/settings/blocked.tsx")).toMatch(/unblockUser\(target\.id\)/);
  });
});

describe("share sheet", () => {
  const sheet = read("mobile/src/components/profile/ShareProfileSheet.tsx");
  it("uses the WhatsApp icon in WhatsApp green", () => {
    expect(sheet).toMatch(/FontAwesome name="whatsapp"/);
    expect(sheet).toContain("#25D366");
  });
  it("copy link just says Link copied", () => {
    expect(sheet).toMatch(/ToastAndroid\.show\("Link copied"/);
    expect(sheet).not.toMatch(/Paste it anywhere/);
  });
  it("@expo/vector-icons is a declared, locked dependency of the app", () => {
    const pkg = JSON.parse(read("mobile/package.json"));
    const lock = JSON.parse(read("mobile/package-lock.json"));
    expect(pkg.dependencies["@expo/vector-icons"]).toBeDefined();
    expect(lock.packages["node_modules/@expo/vector-icons"]).toBeDefined();
  });
});

describe("edit profile layout", () => {
  it("inputs next to an icon or button shrink inside the card", () => {
    const src = read("mobile/app/profile/complete.tsx");
    expect(src.match(/containerStyle=\{styles\.rowInput\}/g)).toHaveLength(3);
    expect(src).toMatch(/rowInput: \{\s+flex: 1,\s+width: "auto",\s+minWidth: 0/);
  });
});

describe("app identity and notifications", () => {
  const app = JSON.parse(read("mobile/app.json"));
  it("launcher name is just Chahat", () => {
    expect(app.expo.name).toBe("Chahat");
  });
  it("notifications use a white-on-transparent small icon (no white square on other phones)", () => {
    const plugin = app.expo.plugins.find((p: any) => Array.isArray(p) && p[0] === "expo-notifications");
    expect(plugin[1].icon).toBe("./assets/notification-icon.png");
    const png = fs.readFileSync(path.join(root, "mobile/assets/notification-icon.png"));
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png[25]).toBe(6); // colour type 6 = RGBA: has transparency
  });
});

describe("no Chahat call while the phone is in another call", () => {
  it("phone call, VoIP call and ringing count as busy", () => {
    expect([0, 1, 2, 3, 4].map(isBusyAudioMode)).toEqual([false, true, true, true, true]);
  });
  it("without the native module nothing is blocked", () => {
    __setCallStateModuleForTests(null);
    expect(isPhoneInAnotherCall()).toBe(false);
  });
  it("busy phone: the call button says so and opens nothing", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require("react-native").Platform.OS = "android";
    __setCallStateModuleForTests({ getAudioMode: () => 3 });
    const router = { push: jest.fn() };
    expect(await startVideoCallIfAllowed(router, "m1")).toBe(false);
    expect(router.push).not.toHaveBeenCalled();
    expect(mockAlert.mock.calls[0][0]).toMatch(/another call/);
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it("answer paths check too, and the native module is an autolinked local module", () => {
    expect(read("mobile/app/call/[id].tsx")).toMatch(/PHONE_BUSY_ANSWER_MESSAGE/);
    expect(read("mobile/app/calls/index.tsx")).toMatch(/isPhoneInAnotherCall\(\)/);
    expect(read("mobile/src/services/incomingCallController.ts")).toMatch(/deps\.isPhoneBusy\?\.\(\)/);
    const cfg = JSON.parse(read("mobile/modules/call-state/expo-module.config.json"));
    expect(cfg.android.modules).toEqual(["expo.modules.callstate.CallStateModule"]);
    expect(read("mobile/modules/call-state/android/src/main/java/expo/modules/callstate/CallStateModule.kt")).toMatch(
      /Name\("ChahatCallState"\)/,
    );
  });
});
