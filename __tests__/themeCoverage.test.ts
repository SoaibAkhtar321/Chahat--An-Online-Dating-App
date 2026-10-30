import * as fs from "fs";
import * as path from "path";
import { LightColors, DarkColors } from "../mobile/src/constants/theme";

const MOBILE = path.join(__dirname, "..", "mobile");

function listTsx(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return listTsx(p);
    return p.endsWith(".tsx") ? [p] : [];
  });
}

describe("theme token parity", () => {
  it("Light and Dark palettes define exactly the same tokens", () => {
    expect(Object.keys(DarkColors).sort()).toEqual(Object.keys(LightColors).sort());
  });

  it("Dark palette differs from Light for core surface tokens", () => {
    expect(DarkColors.background).not.toBe(LightColors.background);
    expect(DarkColors.card).not.toBe(LightColors.card);
    expect(DarkColors.foreground).not.toBe(LightColors.foreground);
  });
});

describe("theme coverage", () => {
  const files = [
    ...listTsx(path.join(MOBILE, "app")),
    ...listTsx(path.join(MOBILE, "src", "components")),
  ];

  it("finds screens and components to scan", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it("no screen or component imports the static light-only Colors", () => {
    const offenders = files.filter((f) =>
      /import\s*\{[^}]*\bColors\b[^}]*\}\s*from\s*["'][^"']*constants\/theme["']/.test(
        fs.readFileSync(f, "utf8"),
      ),
    );
    expect(offenders.map((f) => path.relative(MOBILE, f))).toEqual([]);
  });
});

// Files whose remaining hex/rgba literals were reviewed and are intentional:
// photo overlays, white text over photos, brand tints and semantic tints.
// Any NEW file with hardcoded colors must be reviewed for Dark Mode, then added here.
const REVIEWED_HARDCODED_COLOR_FILES = [
  "app/(auth)/welcome.tsx",
  "app/(tabs)/likes.tsx",
  "app/call/[id].tsx",
  "app/explore/index.tsx",
  "app/match/[id].tsx",
  "app/premium/index.tsx",
  "app/profile/[id].tsx",
  "src/components/call/CallVideoStage.tsx", // black video letterbox behind camera surfaces
  "src/components/chat/ChatBubble.tsx",
  "src/components/chat/CoupleGamesModal.tsx",
  "src/components/chat/ImageViewerModal.tsx",
  "src/components/discovery/DiscoveryCard.tsx",
  "src/components/profile/PhotoUploader.tsx",
  "src/components/profile/ShareProfileSheet.tsx", // WhatsApp brand green on the WhatsApp share button
  "src/components/ui/DatePicker.tsx",
  "src/components/ui/Slider.tsx",
];

describe("hardcoded color regression guard", () => {
  const files = [
    ...listTsx(path.join(MOBILE, "app")),
    ...listTsx(path.join(MOBILE, "src", "components")),
  ];

  it("only reviewed files contain hex/rgb(a) literals", () => {
    const withLiterals = files
      .filter((f) => /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(MOBILE, f).split(path.sep).join("/"))
      .sort();
    const unreviewed = withLiterals.filter((f) => !REVIEWED_HARDCODED_COLOR_FILES.includes(f));
    expect(unreviewed).toEqual([]);
  });
});

describe("native appearance config", () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(MOBILE, "app.json"), "utf8")).expo;

  it("follows the device appearance", () => {
    expect(cfg.userInterfaceStyle).toBe("automatic");
  });

  it("has a dark splash matching the dark background token", () => {
    expect(cfg.splash.backgroundColor).toBe(LightColors.background);
    expect(cfg.splash.dark.backgroundColor).toBe(DarkColors.background);
  });
});