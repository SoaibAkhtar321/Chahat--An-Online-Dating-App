import fs from "fs";
import path from "path";
import {
  buildProfileShareUrl,
  buildShareMessage,
  isValidProfileId,
  parseProfileShareUrl,
  setPendingSharedProfile,
  shareProfile,
  takePendingSharedProfile,
  type ShareDeps,
} from "../mobile/src/services/profileShare";

const ID = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

function deps(over: Partial<ShareDeps> = {}) {
  const calls: Record<string, unknown[]> = { copy: [], open: [], share: [] };
  const d: ShareDeps = {
    copy: async (t) => void calls.copy.push(t),
    canOpen: async () => true,
    open: async (u) => void calls.open.push(u),
    share: async (m) => {
      calls.share.push(m);
      return { action: "sharedAction" };
    },
    ...over,
  };
  return { d, calls };
}

describe("profile share links", () => {
  it("builds an https link that carries only the id", () => {
    expect(buildProfileShareUrl(ID.toUpperCase())).toBe(`https://chahatlegal.netlify.app/p/${ID}`);
  });

  it("rejects ids that are not member UUIDs", () => {
    for (const bad of ["", "abc", "../settings", `${ID}/x`, `${ID}?a=1`]) {
      expect(isValidProfileId(bad)).toBe(false);
      expect(() => buildProfileShareUrl(bad)).toThrow();
    }
  });

  it("parses https and app-scheme links and refuses others", () => {
    expect(parseProfileShareUrl(`https://chahatlegal.netlify.app/p/${ID}`)).toBe(ID);
    expect(parseProfileShareUrl(`https://chahatlegal.netlify.app/p/${ID}/?utm=x`)).toBe(ID);
    expect(parseProfileShareUrl(`chahat://p/${ID}`)).toBe(ID);
    expect(parseProfileShareUrl(`http://chahatlegal.netlify.app/p/${ID}`)).toBeNull();
    expect(parseProfileShareUrl("https://chahatlegal.netlify.app/p/not-an-id")).toBeNull();
  });

  it("never puts another member's name in the share text", () => {
    const url = buildProfileShareUrl(ID);
    expect(buildShareMessage(url, false)).toBe(`Check out this profile on Chahat: ${url}`);
    expect(buildShareMessage(url, true)).toBe(`Check out my profile on Chahat: ${url}`);
  });
});

describe("shareProfile channels", () => {
  it("copy puts the bare link on the clipboard", async () => {
    const { d, calls } = deps();
    await expect(shareProfile(ID, "copy", { isOwnProfile: true }, d)).resolves.toEqual({ ok: true, channel: "copy" });
    expect(calls.copy).toEqual([`https://chahatlegal.netlify.app/p/${ID}`]);
  });

  it("whatsapp opens the app with the encoded message", async () => {
    const { d, calls } = deps();
    await shareProfile(ID, "whatsapp", { isOwnProfile: true }, d);
    expect(calls.open[0]).toBe(
      `whatsapp://send?text=${encodeURIComponent(`Check out my profile on Chahat: https://chahatlegal.netlify.app/p/${ID}`)}`,
    );
  });

  it("whatsapp falls back to wa.me when the app cannot be detected", async () => {
    const { d, calls } = deps({ canOpen: async () => false });
    await shareProfile(ID, "whatsapp", { isOwnProfile: false }, d);
    expect(String(calls.open[0])).toMatch(/^https:\/\/wa\.me\/\?text=/);
  });

  it("whatsapp failure is reported as unavailable", async () => {
    const { d } = deps({ open: async () => Promise.reject(new Error("no handler")) });
    await expect(shareProfile(ID, "whatsapp", { isOwnProfile: true }, d)).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("system share sheet; dismiss counts as cancelled", async () => {
    const { d, calls } = deps();
    await expect(shareProfile(ID, "system", { isOwnProfile: true }, d)).resolves.toEqual({ ok: true, channel: "system" });
    expect(calls.share).toHaveLength(1);
    const { d: d2 } = deps({ share: async () => ({ action: "dismissedAction" }) });
    await expect(shareProfile(ID, "system", { isOwnProfile: true }, d2)).resolves.toEqual({ ok: false, reason: "cancelled" });
  });

  it("invalid id never reaches any channel", async () => {
    const { d, calls } = deps();
    await expect(shareProfile("bad", "copy", { isOwnProfile: true }, d)).resolves.toEqual({ ok: false, reason: "error" });
    expect(calls.copy).toHaveLength(0);
  });
});

describe("pending shared profile (link opened before sign-in)", () => {
  it("is taken once and only for valid ids", () => {
    setPendingSharedProfile(ID);
    expect(takePendingSharedProfile()).toBe(ID);
    expect(takePendingSharedProfile()).toBeNull();
    setPendingSharedProfile("../x");
    expect(takePendingSharedProfile()).toBeNull();
  });
});

describe("wiring", () => {
  const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

  it("App Link intent filter covers /p/ on the share host with autoVerify", () => {
    const app = JSON.parse(read("mobile/app.json"));
    const filters = app.expo.android.intentFilters;
    expect(filters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          autoVerify: true,
          data: [expect.objectContaining({ scheme: "https", host: "chahatlegal.netlify.app", pathPrefix: "/p/" })],
        }),
      ]),
    );
  });

  it("deep-link route, Me menu and profile screen use the share sheet", () => {
    expect(read("mobile/app/p/[id].tsx")).toMatch(/setPendingSharedProfile/);
    expect(read("mobile/app/index.tsx")).toMatch(/takePendingSharedProfile/);
    expect(read("mobile/app/(tabs)/me.tsx")).toMatch(/Share my profile/);
    expect(read("mobile/app/profile/[id].tsx")).toMatch(/ShareProfileSheet/);
  });

  it("landing page shows no profile data", () => {
    const page = read("docs/profile-share-website/app/p/[id]/page.tsx");
    expect(page).not.toMatch(/supabase|fetch\(/i);
    expect(page).toMatch(/noindex|index: false/);
  });

  it("expo-clipboard is declared in both package.json files (SDK 54 line)", () => {
    for (const p of ["package.json", "mobile/package.json"]) {
      expect(JSON.parse(read(p)).dependencies["expo-clipboard"]).toMatch(/^~8\./);
    }
  });
});
