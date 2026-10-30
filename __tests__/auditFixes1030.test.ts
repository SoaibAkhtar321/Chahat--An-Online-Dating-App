// Pre-launch audit 2026-10-30: media size, chat-list load, permissions (Play), reporting reasons, data download
// (DPDP s.11), chat list dates. Server side: supabase/tests/84_scale_storage_data_access.sql.
import fs from "fs";
import path from "path";

jest.mock("../mobile/src/services/supabase", () => ({ supabase: {}, isSupabaseConfigured: () => false }));
jest.mock("../mobile/src/context/ThemeContext", () => ({ useTheme: () => ({ colors: {} }) }));
const mockManip = jest.fn();
jest.mock("expo-image-manipulator", () => ({
  manipulateAsync: (...a: any[]) => mockManip(...a),
  SaveFormat: { JPEG: "jpeg" },
}));
const mockRead = jest.fn();
jest.mock("expo-file-system/legacy", () => ({
  readAsStringAsync: (...a: any[]) => mockRead(...a),
  EncodingType: { Base64: "base64", UTF8: "utf8" },
}));

import { compressChatImage, isGifFile, CHAT_PHOTO_MAX_WIDTH, MAX_CHAT_PHOTO_BYTES } from "../mobile/src/utils/compressImage";
import { formatChatListTime } from "../mobile/src/utils/chatTime";
import { REPORT_REASONS } from "../mobile/src/components/safety/ReportSheet";
import { exportFileName } from "../mobile/src/services/dataExport";

const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

function fakeSizes(sizes: number[]) {
  let i = 0;
  (global as any).fetch = jest.fn(async () => ({ ok: true, blob: async () => ({ size: sizes[Math.min(i++, sizes.length - 1)] }) }));
}

beforeEach(() => {
  mockManip.mockReset();
  mockRead.mockReset();
});

describe("chat photo compression", () => {
  it("GIFs are sent untouched", async () => {
    mockRead.mockResolvedValue("R0lGODlh");
    expect(await isGifFile("file://a.gif")).toBe(true);
    expect(await compressChatImage("file://a.gif")).toBe("file://a.gif");
    expect(mockManip).not.toHaveBeenCalled();
  });
  it("a large camera photo is resized to at most 1600 px and re-encoded under the size target", async () => {
    mockRead.mockResolvedValue("/9j/4AAQ");
    mockManip.mockImplementation(async (_uri: string, actions: any[]) =>
      actions.length ? { uri: "file://out.jpg", width: actions[0].resize.width } : { uri: "file://probe.jpg", width: 4000 },
    );
    fakeSizes([2_000_000, 450_000]);
    expect(await compressChatImage("file://big.jpg")).toBe("file://out.jpg");
    const resized = mockManip.mock.calls.filter((c) => c[1].length);
    expect(resized[0][1][0].resize.width).toBe(CHAT_PHOTO_MAX_WIDTH);
    expect(MAX_CHAT_PHOTO_BYTES).toBeLessThanOrEqual(600_000);
  });
  it("a small photo is never enlarged", async () => {
    mockRead.mockResolvedValue("/9j/4AAQ");
    mockManip.mockImplementation(async (_uri: string, actions: any[]) =>
      actions.length ? { uri: "file://out.jpg" } : { uri: "file://probe.jpg", width: 720 },
    );
    fakeSizes([100_000]);
    await compressChatImage("file://small.jpg");
    expect(mockManip.mock.calls.find((c) => c[1].length)![1][0].resize.width).toBe(720);
  });
  it("chat send compresses before upload", () => {
    expect(read("mobile/src/services/chat.ts")).toMatch(/uploadUri = await compressChatImage\(imageUri\)/);
  });
});

describe("chat list load", () => {
  const src = read("mobile/src/services/chat.ts");
  it("loads chats in parallel and signs photos in one batch, without signing last-message media", () => {
    expect(src).toMatch(/Promise\.all\(\s*matches\.map/);
    expect(src).toMatch(/const signed = await getSignedUrls\("photos", photoPaths\)/);
    expect(src).not.toMatch(/image: last\.image_path \? await getSignedUrl/);
  });
  it("concurrent refreshes are coalesced", () => {
    expect(read("mobile/src/context/MiloContext.tsx")).toMatch(/matchesAgain\.current = true/);
  });
  it("shows a date for older chats, not just a time", () => {
    const now = new Date(2026, 9, 30, 12, 0).getTime();
    expect(formatChatListTime(new Date(2026, 9, 29, 9, 0).getTime(), now)).toBe("Yesterday");
    expect(formatChatListTime(new Date(2026, 8, 1, 9, 0).getTime(), now)).toMatch(/Sep/);
    expect(formatChatListTime(new Date(2025, 8, 1, 9, 0).getTime(), now)).toMatch(/2025/);
  });
});

describe("Google Play photo & video permissions", () => {
  const app = JSON.parse(read("mobile/app.json")).expo.android;
  it("no broad media permissions; the system photo picker is used instead", () => {
    expect(app.permissions).not.toContain("android.permission.READ_EXTERNAL_STORAGE");
    for (const p of ["READ_MEDIA_IMAGES", "READ_MEDIA_VIDEO", "READ_EXTERNAL_STORAGE"]) {
      expect(app.blockedPermissions).toContain(`android.permission.${p}`);
    }
    for (const f of ["mobile/app/chat/[id].tsx", "mobile/src/components/profile/PhotoUploader.tsx", "mobile/app/verification/index.tsx"]) {
      expect(read(f)).not.toMatch(/requestMediaLibraryPermissionsAsync/);
    }
  });
});

describe("reporting", () => {
  it("members pick a reason, including under-18 reports (Play Child Safety Standards)", () => {
    expect(REPORT_REASONS).toContain("Appears to be under 18");
    for (const r of REPORT_REASONS) expect(r.length).toBeLessThanOrEqual(60);
    for (const f of ["mobile/app/chat/[id].tsx", "mobile/app/profile/[id].tsx"]) {
      expect(read(f)).toMatch(/<ReportSheet/);
      expect(read(f)).toMatch(/reportUser\([^)]*reason/);
    }
  });
});

describe("download my data (DPDP Act s.11)", () => {
  it("settings offers it and the privacy text points to it", () => {
    expect(read("mobile/app/settings/index.tsx")).toMatch(/testID="download-my-data"/);
    expect(read("mobile/app/legal/index.tsx")).toMatch(/Settings → Download my data/);
    expect(read("mobile/src/services/dataExport.ts")).toMatch(/supabase\.rpc\("export_my_data"\)/);
    expect(exportFileName(new Date("2026-10-30T10:00:00Z"))).toBe("chahat-my-data-2026-10-30.json");
  });
  it("expo-sharing is a declared, locked dependency", () => {
    const lock = JSON.parse(read("mobile/package-lock.json"));
    expect(JSON.parse(read("mobile/package.json")).dependencies["expo-sharing"]).toBeDefined();
    expect(lock.packages["node_modules/expo-sharing"]).toBeDefined();
  });
});
