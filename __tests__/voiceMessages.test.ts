jest.mock(
  "@react-native-async-storage/async-storage",
  () => ({
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  }),
  { virtual: true },
);

jest.mock(
  "expo-secure-store",
  () => ({
    getItemAsync: jest.fn().mockResolvedValue(null),
    setItemAsync: jest.fn().mockResolvedValue(undefined),
    deleteItemAsync: jest.fn().mockResolvedValue(undefined),
  }),
  { virtual: true },
);

jest.mock("expo-application", () => ({ nativeApplicationVersion: "1.0.0" }), { virtual: true });
jest.mock(
  "expo-constants",
  () => ({
    __esModule: true,
    default: {
      expoConfig: { extra: { eas: { projectId: "d40a4e1f-fbf8-4b44-93af-7c4e1fe39b8a" } } },
    },
  }),
  { virtual: true },
);
jest.mock("expo-device", () => ({ isDevice: true }), { virtual: true });
jest.mock(
  "expo-notifications",
  () => ({
    AndroidImportance: { HIGH: 4 },
    setNotificationHandler: jest.fn(),
    setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
    getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
    requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
    getExpoPushTokenAsync: jest.fn().mockResolvedValue({ data: "ExponentPushToken[mock]" }),
  }),
  { virtual: true },
);

import fs from "fs";
import path from "path";
import {
  VOICE_LIMITS,
  validateVoiceRecording,
  cleanupAbandonedVoiceFile,
  getAudioRecorderAdapter,
  getAudioPlayerAdapter,
  registerAudioRecorderAdapter,
  registerAudioPlayerAdapter,
  type AudioRecorderAdapter,
  type AudioPlayerAdapter,
} from "../mobile/src/services/voiceMedia";
import {
  prepareVoiceUpload,
  resetUploadRateLimiter,
  STORAGE_LIMITS,
  recordUploadEvent,
} from "../mobile/src/services/storage";
import { sendVoiceMessage } from "../mobile/src/services/chat";
import { supabase } from "../mobile/src/services/supabase";
import * as supabaseModule from "../mobile/src/services/supabase";

const root = path.resolve(__dirname, "..");

const mockFs = {
  deleteAsync: jest.fn(async () => undefined),
  getInfoAsync: jest.fn(async () => ({ exists: true, size: 16384 })),
};
jest.mock("expo-file-system", () => mockFs, { virtual: true });

jest.mock(
  "expo-av",
  () => {
    const recording = {
      prepareToRecordAsync: jest.fn(async () => undefined),
      startAsync: jest.fn(async () => undefined),
      stopAndUnloadAsync: jest.fn(async () => ({ durationMillis: 4200 })),
      getURI: jest.fn(() => "file:///cache/rec.m4a"),
    };
    let statusCb: ((s: any) => void) | null = null;
    const sound = {
      playAsync: jest.fn(async () => undefined),
      pauseAsync: jest.fn(async () => undefined),
      stopAsync: jest.fn(async () => undefined),
      unloadAsync: jest.fn(async () => undefined),
    };
    return {
      __recording: recording,
      __sound: sound,
      __emitStatus: (s: any) => statusCb?.(s),
      Audio: {
        requestPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
        setAudioModeAsync: jest.fn(async () => undefined),
        Recording: jest.fn(() => recording),
        Sound: {
          createAsync: jest.fn(async (_src: any, _opts: any, cb: (s: any) => void) => {
            statusCb = cb;
            return { sound };
          }),
        },
      },
    };
  },
  { virtual: true },
);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockAv = require("expo-av");

describe("Phase 5: Secure Voice Messages and Chat Storage", () => {
  beforeEach(() => {
    resetUploadRateLimiter();
    jest.clearAllMocks();
  });

  afterAll(() => {
    supabase.auth.stopAutoRefresh();
  });

  describe("1. Audio Recording & Playback Adapters and Permissions", () => {
    test("audio recorder adapter requests runtime microphone permissions", async () => {
      const adapter = getAudioRecorderAdapter();
      const perm = await adapter.requestPermissionsAsync();
      expect(mockAv.Audio.requestPermissionsAsync).toHaveBeenCalled();
      expect(perm).toEqual({ granted: true, canAskAgain: true });
    });

    test("recorder reports denied permission and does not start", async () => {
      mockAv.Audio.requestPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: false });
      const adapter = getAudioRecorderAdapter();
      const res = await adapter.startRecordingAsync();
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/permission/i);
      expect(adapter.isRecording()).toBe(false);
    });

    test("recorder enforces a single recording and cancel deletes the file", async () => {
      const adapter = getAudioRecorderAdapter();
      expect((await adapter.startRecordingAsync(5000)).success).toBe(true);
      expect(adapter.isRecording()).toBe(true);
      const second = await adapter.startRecordingAsync(5000);
      expect(second.success).toBe(false);
      expect(second.error).toMatch(/already in progress/i);

      await adapter.cancelRecordingAsync();
      expect(adapter.isRecording()).toBe(false);
      expect(mockFs.deleteAsync).toHaveBeenCalledWith("file:///cache/rec.m4a", { idempotent: true });
      expect((await adapter.stopRecordingAsync()).success).toBe(false);
    });

    test("recorder returns the real file uri, duration and size from the device", async () => {
      const adapter = getAudioRecorderAdapter();
      await adapter.startRecordingAsync();
      const res = await adapter.stopRecordingAsync();
      expect(res.success).toBe(true);
      expect(res.result).toEqual({
        uri: "file:///cache/rec.m4a",
        durationMs: 4200,
        fileSizeBytes: 16384,
        mimeType: "audio/m4a",
      });
      expect(adapter.isRecording()).toBe(false);
    });

    test("recorder rejects and deletes a too-short or empty recording", async () => {
      const adapter = getAudioRecorderAdapter();
      mockAv.__recording.stopAndUnloadAsync.mockResolvedValueOnce({ durationMillis: 100 });
      await adapter.startRecordingAsync();
      const tooShort = await adapter.stopRecordingAsync();
      expect(tooShort.success).toBe(false);
      expect(tooShort.error).toMatch(/too short/i);
      expect(mockFs.deleteAsync).toHaveBeenCalled();

      mockFs.getInfoAsync.mockResolvedValueOnce({ exists: true, size: 0 });
      await adapter.startRecordingAsync();
      const empty = await adapter.stopRecordingAsync();
      expect(empty.success).toBe(false);
      expect(empty.error).toMatch(/empty/i);
    });

    test("recorder start failure leaves no active recording", async () => {
      mockAv.__recording.startAsync.mockRejectedValueOnce(new Error("busy"));
      const adapter = getAudioRecorderAdapter();
      const res = await adapter.startRecordingAsync();
      expect(res.success).toBe(false);
      expect(adapter.isRecording()).toBe(false);
    });

    test("player plays, pauses, resumes the same clip, stops and releases", async () => {
      const player = getAudioPlayerAdapter();
      const updates: any[] = [];
      const playRes = await player.playAsync("https://example.com/audio.m4a", (s) => updates.push(s));
      expect(playRes.success).toBe(true);
      expect(player.isPlaying()).toBe(true);
      expect(mockAv.Audio.Sound.createAsync).toHaveBeenCalledTimes(1);

      await player.pauseAsync();
      expect(player.isPlaying()).toBe(false);

      // Same clip again resumes, it does not reload.
      await player.playAsync("https://example.com/audio.m4a");
      expect(mockAv.__sound.playAsync).toHaveBeenCalled();
      expect(mockAv.Audio.Sound.createAsync).toHaveBeenCalledTimes(1);

      mockAv.__emitStatus({ isLoaded: true, isPlaying: true, positionMillis: 1000, durationMillis: 4000 });
      expect(updates.at(-1)).toMatchObject({ positionMs: 1000, durationMs: 4000, isPlaying: true });

      await player.stopAsync();
      expect(mockAv.__sound.unloadAsync).toHaveBeenCalled();
      expect(player.isPlaying()).toBe(false);
      await player.releaseAsync();
    });

    test("player reports a calm error when the (expired) URL cannot load", async () => {
      mockAv.Audio.Sound.createAsync.mockRejectedValueOnce(new Error("403"));
      const player = getAudioPlayerAdapter();
      const res = await player.playAsync("https://example.com/expired.m4a");
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/could not play/i);
      expect(player.isPlaying()).toBe(false);
    });

    test("pluggable adapter registry allows custom native or mock adapters", () => {
      const originalRecorder = getAudioRecorderAdapter();
      const originalPlayer = getAudioPlayerAdapter();

      const mockCustomRecorder: AudioRecorderAdapter = {
        isRecording: jest.fn().mockReturnValue(false),
        requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: false, canAskAgain: false }),
        startRecordingAsync: jest.fn().mockResolvedValue({ success: false, error: "Permission denied" }),
        stopRecordingAsync: jest.fn().mockResolvedValue({ success: false, error: "Not recording" }),
        cancelRecordingAsync: jest.fn().mockResolvedValue(undefined),
      };

      const mockCustomPlayer: AudioPlayerAdapter = {
        isPlaying: jest.fn().mockReturnValue(false),
        playAsync: jest.fn().mockResolvedValue({ success: true }),
        pauseAsync: jest.fn().mockResolvedValue(undefined),
        stopAsync: jest.fn().mockResolvedValue(undefined),
        releaseAsync: jest.fn().mockResolvedValue(undefined),
      };

      registerAudioRecorderAdapter(mockCustomRecorder);
      registerAudioPlayerAdapter(mockCustomPlayer);

      expect(getAudioRecorderAdapter()).toBe(mockCustomRecorder);
      expect(getAudioPlayerAdapter()).toBe(mockCustomPlayer);

      // Restore originals
      registerAudioRecorderAdapter(originalRecorder);
      registerAudioPlayerAdapter(originalPlayer);
    });
  });

  describe("2. Voice Recording Limits & Input Validation", () => {
    test("rejects recordings under minimum duration (accidental taps under 500ms)", () => {
      const res = validateVoiceRecording({
        durationMs: 300,
        fileSizeBytes: 2048,
        mimeType: "audio/m4a",
      });
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/too short/i);
    });

    test("rejects recordings exceeding maximum duration (over 60 seconds + margin)", () => {
      const res = validateVoiceRecording({
        durationMs: 62_000,
        fileSizeBytes: 250_000,
        mimeType: "audio/m4a",
      });
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/exceeds maximum duration/i);
    });

    test("rejects empty audio files (0 bytes)", () => {
      const res = validateVoiceRecording({
        durationMs: 5000,
        fileSizeBytes: 0,
        mimeType: "audio/m4a",
      });
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/empty/i);
    });

    test("rejects audio files exceeding file size limit (over 5 MB)", () => {
      const res = validateVoiceRecording({
        durationMs: 30_000,
        fileSizeBytes: 6 * 1024 * 1024,
        mimeType: "audio/m4a",
      });
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/exceeds file size limit/i);
    });

    test("accepts valid audio formats (m4a, mp4, aac, webm, ogg, x-m4a, mpeg)", () => {
      const allowed = ["audio/m4a", "audio/mp4", "audio/aac", "audio/webm", "audio/ogg", "audio/x-m4a", "audio/mpeg"];
      for (const mime of allowed) {
        const res = validateVoiceRecording({
          durationMs: 5000,
          fileSizeBytes: 20_000,
          mimeType: mime,
        });
        expect(res.valid).toBe(true);
      }
    });

    test("rejects unsupported audio or non-audio MIME types", () => {
      const forbidden = ["application/octet-stream", "text/plain", "image/jpeg", "video/mp4", "audio/flac"];
      for (const mime of forbidden) {
        const res = validateVoiceRecording({
          durationMs: 5000,
          fileSizeBytes: 20_000,
          mimeType: mime,
        });
        expect(res.valid).toBe(false);
        expect(res.error).toMatch(/unsupported audio format/i);
      }
    });
  });

  describe("3. Storage Preparation, Rate Limits, and Local File Cleanup", () => {
    test("prepareVoiceUpload rejects duration outside 1-60s range", async () => {
      await expect(prepareVoiceUpload("file:///tmp/voice.m4a", 0)).rejects.toThrow(
        /duration must be between 1 and 60 seconds/i,
      );
      await expect(prepareVoiceUpload("file:///tmp/voice.m4a", 65)).rejects.toThrow(
        /duration must be between 1 and 60 seconds/i,
      );
    });

    test("prepareVoiceUpload enforces upload rate limiting", async () => {
      for (let i = 0; i < STORAGE_LIMITS.maxUploadsPerWindow; i++) {
        recordUploadEvent();
      }
      await expect(prepareVoiceUpload("file:///tmp/voice.m4a", 10)).rejects.toThrow(
        /upload rate limit reached/i,
      );
    });

    test("cleanupAbandonedVoiceFile handles non-file URI gracefully", async () => {
      await expect(cleanupAbandonedVoiceFile("")).resolves.toBeUndefined();
      await expect(cleanupAbandonedVoiceFile("https://supabase.co/file.m4a")).resolves.toBeUndefined();
    });
  });

  describe("4. Message Transmission & Access Authorization", () => {
    test("sendVoiceMessage fails closed when matchId or senderId is missing", async () => {
      const res1 = await sendVoiceMessage("", "user-123", "file:///test.m4a", 5);
      expect(res1.success).toBe(false);
      expect(res1.error).toMatch(/missing matchId/i);

      const res2 = await sendVoiceMessage("11111111-1111-1111-1111-111111111111", "", "file:///test.m4a", 5);
      expect(res2.success).toBe(false);
      expect(res2.error).toMatch(/missing/i);
    });

    test("sendVoiceMessage rejects non-UUID matchId to prevent database type error", async () => {
      const res = await sendVoiceMessage(
        "invalid-not-uuid",
        "user-123",
        "file:///test.m4a",
        5,
      );
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/invalid match reference/i);
    });

    test("sendVoiceMessage cleans up storage upload if database insertion fails", async () => {
      const mockRemove = jest.fn().mockResolvedValue({ error: null });
      const mockUpload = jest.fn().mockResolvedValue({ error: null });
      const mockInsert = jest.fn().mockResolvedValue({
        error: { message: "Match member communication blocked by security policy" },
      });

      const spyConfig = jest.spyOn(supabaseModule, "isSupabaseConfigured").mockReturnValue(true);
      const spyStorage = jest.spyOn(supabase.storage, "from").mockReturnValue({
        upload: mockUpload,
        remove: mockRemove,
        createSignedUrls: jest.fn(),
      } as any);

      const spyFrom = jest.spyOn(supabase, "from").mockReturnValue({
        insert: mockInsert,
      } as any);

      const matchId = "22222222-2222-4222-a222-222222222222";
      const senderId = "33333333-3333-4333-b333-333333333333";

      const res = await sendVoiceMessage(
        matchId,
        senderId,
        "file:///test.m4a",
        10,
        "audio/m4a",
      );

      expect(res.success).toBe(false);
      expect(res.error).toMatch(/blocked/i);
      expect(mockUpload).toHaveBeenCalled();
      // Storage rollback must be invoked to prevent orphaned audio files
      expect(mockRemove).toHaveBeenCalledWith([expect.stringContaining(`${matchId}/voice_`)]);

      spyConfig.mockRestore();
      spyStorage.mockRestore();
      spyFrom.mockRestore();
    });
  });

  describe("5. Database Migration 20260101002500 Schema & Security Enforcement", () => {
    const migPath = path.join(
      root,
      "supabase/migrations/20260101002500_voice_messages_and_chat_storage.sql",
    );

    test("migration 20260101002500 file exists and is readable", () => {
      expect(fs.existsSync(migPath)).toBe(true);
    });

    test("configures private chat storage bucket with audio MIME types and 5MB limit", () => {
      const sql = fs.readFileSync(migPath, "utf8");
      expect(sql).toMatch(/INSERT INTO storage\.buckets/);
      expect(sql).toMatch(/'chat'/);
      expect(sql).toMatch(/5242880/); // 5 MB limit
      expect(sql).toMatch(/'audio\/m4a'/);
      expect(sql).toMatch(/'audio\/mp4'/);
      expect(sql).toMatch(/'audio\/aac'/);
      expect(sql).toMatch(/'audio\/webm'/);
      expect(sql).toMatch(/'audio\/ogg'/);
      expect(sql).toMatch(/'audio\/x-m4a'/);
    });

    test("adds audio_path, audio_duration_sec, and message_type columns to messages table", () => {
      const sql = fs.readFileSync(migPath, "utf8");
      expect(sql).toMatch(/ALTER TABLE public\.messages/);
      expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS audio_path text/);
      expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS audio_duration_sec integer CHECK/);
      expect(sql).toMatch(/audio_duration_sec > 0 AND audio_duration_sec <= 300/);
      expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS message_type text NOT NULL DEFAULT 'text'/);
      expect(sql).toMatch(/message_type IN \('text', 'image', 'voice', 'system'\)/);
    });

    test("hardens messages INSERT RLS policy with match membership and blocked pair isolation", () => {
      const sql = fs.readFileSync(migPath, "utf8");
      expect(sql).toMatch(/CREATE POLICY "members send messages" ON public\.messages FOR INSERT/);
      expect(sql).toMatch(/sender = auth\.uid\(\)::text/);
      expect(sql).toMatch(/public\.is_match_member\(match_id\)/);
      expect(sql).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM public\.matches/);
      expect(sql).toMatch(/public\.is_blocked_pair\(m\.user_a,\s*m\.user_b\)/);
    });

    test("messages_guard prevents updating audio_path, audio_duration_sec, and message_type", () => {
      const sql = fs.readFileSync(migPath, "utf8");
      expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.messages_guard\(\)/);
      expect(sql).toMatch(/NEW\.audio_path := OLD\.audio_path;/);
      expect(sql).toMatch(/NEW\.audio_duration_sec := OLD\.audio_duration_sec;/);
      expect(sql).toMatch(/NEW\.message_type := OLD\.message_type;/);
    });

    test("get_match_messages RPC returns audio metadata and enforces tier read receipt masking", () => {
      const sql = fs.readFileSync(migPath, "utf8");
      expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.get_match_messages\(uuid\)/);
      expect(sql).toMatch(/CREATE FUNCTION public\.get_match_messages/);
      expect(sql).toMatch(/audio_path text/);
      expect(sql).toMatch(/audio_duration_sec integer/);
      expect(sql).toMatch(/message_type text/);
      expect(sql).toMatch(/WHEN m\.sender = _my_id AND _tier NOT IN \('plus', 'vip'\) THEN NULL/);
      expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.get_match_messages\(uuid\) FROM PUBLIC, anon;/);
    });

    test("storage delete policy allows match members to remove abandoned files in their folder", () => {
      const sql = fs.readFileSync(migPath, "utf8");
      expect(sql).toMatch(/CREATE POLICY "chat delete members" ON storage\.objects FOR DELETE/);
      expect(sql).toMatch(/bucket_id = 'chat'/);
      expect(sql).toMatch(/public\.chat_folder_member\(\(storage\.foldername\(name\)\)\[1\]\)/);
    });
  });
});
