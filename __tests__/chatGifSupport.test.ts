// GIFs in chat (2026-10-29): keyboard (Gboard GIF / stickers) and gallery GIFs are sent as chat images.
import fs from "fs";
jest.mock("../mobile/src/services/supabase", () => ({ supabase: {}, isSupabaseConfigured: () => false }));
import path from "path";
import { pickKeyboardImage } from "../mobile/src/components/chat/ChatTextInput";
import { detectImageMimeType, imageFileExtension } from "../mobile/src/services/storage";

const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const gifBytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00]);

describe("keyboard media", () => {
  it("accepts GIF / PNG / JPEG / WEBP from the keyboard and ignores anything else", () => {
    expect(pickKeyboardImage([{ uri: "file:///a.gif", type: "image/gif" }])).toEqual({ uri: "file:///a.gif", type: "image/gif" });
    expect(pickKeyboardImage([{ uri: "file:///s.webp", type: "image/webp" }])?.type).toBe("image/webp");
    expect(pickKeyboardImage([{ uri: "file:///v.mp4", type: "video/mp4" }])).toBeNull();
    expect(pickKeyboardImage([{ uri: "file:///d.pdf", type: "application/pdf" }])).toBeNull();
    expect(pickKeyboardImage([])).toBeNull();
    expect(pickKeyboardImage(undefined)).toBeNull();
  });
});

describe("GIF upload rules", () => {
  it("detects GIF by its file signature and stores it as .gif", () => {
    expect(detectImageMimeType(gifBytes)).toBe("image/gif");
    expect(imageFileExtension("image/gif")).toBe("gif");
  });

  it("only chat uploads may be GIFs; profile photos stay JPEG/PNG/WEBP", () => {
    expect(read("mobile/src/services/chat.ts")).toMatch(/sanitizeAndPrepareImageUpload\(uploadUri, \{ allowGif: true \}\)/);
    const profile = read("mobile/src/services/profile.ts");
    expect(profile).not.toMatch(/allowGif/);
  });

  it("chat composer uses the keyboard-media input and the server allows image/gif in the chat bucket only", () => {
    const chat = read("mobile/app/chat/[id].tsx");
    expect(chat).toMatch(/<ChatTextInput/);
    expect(chat).toMatch(/onKeyboardMedia=\{\(media\) => setSelectedImages\(\(prev\) => addPickedPhotos\(prev, \[media\.uri\]\)\)\}/);
    const mig = read("supabase/migrations/20260101006500_chat_gif_support.sql");
    expect(mig).toMatch(/'image\/gif'/);
    expect(mig).toMatch(/WHERE id = 'chat'/);
    for (const p of ["package.json", "mobile/package.json"]) {
      expect(JSON.parse(read(p)).dependencies["@mattermost/react-native-paste-input"]).toBe("2.0.1");
    }
  });
});
