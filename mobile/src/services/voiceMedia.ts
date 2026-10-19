// Voice Media Service: real expo-av recording and playback adapters for Chahat (Android).
// Manages runtime microphone permissions, voice note duration limits, file size constraints,
// audio adapters, and local file cleanup.

export const VOICE_LIMITS = {
  maxDurationMs: 60_000, // 60 seconds maximum voice note duration
  minDurationMs: 500, // Reject accidental taps under 500ms
  maxFileSizeBytes: 5 * 1024 * 1024, // 5 MB maximum file size limit
  allowedMimeTypes: [
    "audio/m4a",
    "audio/mp4",
    "audio/aac",
    "audio/mpeg",
    "audio/webm",
    "audio/ogg",
    "audio/x-m4a",
  ] as const,
  defaultExtension: "m4a",
};

export interface VoiceRecordingResult {
  uri: string;
  durationMs: number;
  fileSizeBytes: number;
  mimeType: string;
}

export interface PlaybackStatus {
  positionMs: number;
  durationMs: number;
  isPlaying: boolean;
  didJustFinish: boolean;
}

export interface AudioRecorderAdapter {
  isRecording(): boolean;
  requestPermissionsAsync(): Promise<{ granted: boolean; canAskAgain: boolean }>;
  startRecordingAsync(maxDurationMs?: number): Promise<{ success: boolean; error?: string }>;
  stopRecordingAsync(): Promise<{
    success: boolean;
    result?: VoiceRecordingResult;
    error?: string;
  }>;
  cancelRecordingAsync(): Promise<void>;
}

export interface AudioPlayerAdapter {
  isPlaying(): boolean;
  playAsync(
    uri: string,
    onStatusUpdate?: (status: PlaybackStatus) => void,
  ): Promise<{ success: boolean; error?: string }>;
  pauseAsync(): Promise<void>;
  stopAsync(): Promise<void>;
  releaseAsync(): Promise<void>;
}

/**
 * Validates a voice recording's duration, size, and MIME type against strict boundaries.
 */
export function validateVoiceRecording(recording: {
  durationMs: number;
  fileSizeBytes: number;
  mimeType?: string;
}): { valid: boolean; error?: string } {
  if (recording.durationMs < VOICE_LIMITS.minDurationMs) {
    return {
      valid: false,
      error: "Voice message is too short. Press and hold to record.",
    };
  }

  if (recording.durationMs > VOICE_LIMITS.maxDurationMs + 1000) {
    // 1s grace margin for stop latency
    return {
      valid: false,
      error: `Voice message exceeds maximum duration limit of ${VOICE_LIMITS.maxDurationMs / 1000} seconds.`,
    };
  }

  if (recording.fileSizeBytes <= 0) {
    return {
      valid: false,
      error: "Recorded audio file is empty.",
    };
  }

  if (recording.fileSizeBytes > VOICE_LIMITS.maxFileSizeBytes) {
    const maxMb = VOICE_LIMITS.maxFileSizeBytes / (1024 * 1024);
    return {
      valid: false,
      error: `Voice message exceeds file size limit of ${maxMb} MB.`,
    };
  }

  if (
    recording.mimeType &&
    !VOICE_LIMITS.allowedMimeTypes.includes(recording.mimeType.toLowerCase() as any)
  ) {
    return {
      valid: false,
      error: `Unsupported audio format (${recording.mimeType}). Allowed: ${VOICE_LIMITS.allowedMimeTypes.join(", ")}`,
    };
  }

  return { valid: true };
}

/**
 * Deletes an abandoned or failed local voice file to prevent storage bloat on the device.
 */
export async function cleanupAbandonedVoiceFile(uri: string): Promise<void> {
  if (!uri || !uri.startsWith("file://")) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const FileSystem = require("expo-file-system");
    if (FileSystem?.deleteAsync) {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    }
  } catch {
    // Non-fatal cleanup failure
  }
}

// -----------------------------------------------------------------------------
// Pluggable Adapter Registry
// -----------------------------------------------------------------------------

// Real adapters backed by expo-av (SDK 52). expo-av is required lazily so that importing this module
// never fails in tests or in a build that lacks the native module; each call then reports a calm error.
function loadExpoAv(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("expo-av");
  } catch {
    return null;
  }
}

const UNAVAILABLE = "Voice messages aren't available in this build.";

const RECORDING_OPTIONS = {
  isMeteringEnabled: false,
  android: {
    extension: ".m4a",
    outputFormat: 2, // MPEG_4
    audioEncoder: 3, // AAC
    sampleRate: 22050,
    numberOfChannels: 1,
    bitRate: 32000,
  },
  ios: {
    extension: ".m4a",
    outputFormat: "aac ",
    audioQuality: 64,
    sampleRate: 22050,
    numberOfChannels: 1,
    bitRate: 32000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: { mimeType: "audio/webm", bitsPerSecond: 32000 },
};

class ExpoAvAudioRecorderAdapter implements AudioRecorderAdapter {
  private recording: any = null;

  isRecording(): boolean {
    return this.recording !== null;
  }

  async requestPermissionsAsync(): Promise<{ granted: boolean; canAskAgain: boolean }> {
    const av = loadExpoAv();
    if (!av) return { granted: false, canAskAgain: false };
    try {
      const res = await av.Audio.requestPermissionsAsync();
      return { granted: !!res.granted, canAskAgain: res.canAskAgain !== false };
    } catch {
      return { granted: false, canAskAgain: true };
    }
  }

  async startRecordingAsync(): Promise<{ success: boolean; error?: string }> {
    const av = loadExpoAv();
    if (!av) return { success: false, error: UNAVAILABLE };
    if (this.recording) return { success: false, error: "A recording is already in progress." };
    const perm = await this.requestPermissionsAsync();
    if (!perm.granted) return { success: false, error: "Microphone permission was denied." };

    const rec = new av.Audio.Recording();
    try {
      await av.Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      await rec.prepareToRecordAsync(RECORDING_OPTIONS);
      await rec.startAsync();
      this.recording = rec;
      return { success: true };
    } catch {
      try {
        await rec.stopAndUnloadAsync();
      } catch {
        // Nothing was started.
      }
      await this.resetAudioMode(av);
      return { success: false, error: "Could not start recording. Please try again." };
    }
  }

  async stopRecordingAsync(): Promise<{
    success: boolean;
    result?: VoiceRecordingResult;
    error?: string;
  }> {
    const av = loadExpoAv();
    const rec = this.recording;
    if (!av || !rec) return { success: false, error: "No recording is currently active." };
    this.recording = null;
    let uri: string | null = null;
    try {
      const status = await rec.stopAndUnloadAsync();
      uri = rec.getURI();
      const durationMs = Math.round(status?.durationMillis ?? 0);
      if (!uri) return { success: false, error: "The recording could not be saved." };

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const FileSystem = require("expo-file-system");
      const info = await FileSystem.getInfoAsync(uri);
      const fileSizeBytes = info?.exists && typeof info.size === "number" ? info.size : 0;

      const validation = validateVoiceRecording({ durationMs, fileSizeBytes, mimeType: "audio/m4a" });
      if (!validation.valid) {
        await cleanupAbandonedVoiceFile(uri);
        return { success: false, error: validation.error };
      }
      return { success: true, result: { uri, durationMs, fileSizeBytes, mimeType: "audio/m4a" } };
    } catch {
      if (uri) await cleanupAbandonedVoiceFile(uri);
      return { success: false, error: "The recording could not be saved." };
    } finally {
      await this.resetAudioMode(av);
    }
  }

  async cancelRecordingAsync(): Promise<void> {
    const av = loadExpoAv();
    const rec = this.recording;
    this.recording = null;
    if (!rec) return;
    let uri: string | null = null;
    try {
      await rec.stopAndUnloadAsync();
      uri = rec.getURI();
    } catch {
      // Already stopped.
    }
    if (uri) await cleanupAbandonedVoiceFile(uri);
    if (av) await this.resetAudioMode(av);
  }

  private async resetAudioMode(av: any): Promise<void> {
    try {
      await av.Audio.setAudioModeAsync({ allowsRecordingIOS: false });
    } catch {
      // Non-fatal.
    }
  }
}

class ExpoAvAudioPlayerAdapter implements AudioPlayerAdapter {
  private sound: any = null;
  private currentUri: string | null = null;
  private playing = false;
  // Incremented on every play/stop so a late status callback from an old sound is ignored.
  private generation = 0;
  // Listener of the clip currently loaded, told when another clip replaces it so its bubble resets.
  private activeListener: ((status: PlaybackStatus) => void) | undefined;

  isPlaying(): boolean {
    return this.playing;
  }

  async playAsync(
    uri: string,
    onStatusUpdate?: (status: PlaybackStatus) => void,
  ): Promise<{ success: boolean; error?: string }> {
    const av = loadExpoAv();
    if (!av) return { success: false, error: UNAVAILABLE };
    if (!uri) return { success: false, error: "Audio URI is required." };

    try {
      // Resume the same clip after a pause instead of reloading it.
      if (this.sound && this.currentUri === uri) {
        await this.sound.playAsync();
        this.playing = true;
        return { success: true };
      }

      this.activeListener?.({ positionMs: 0, durationMs: 0, isPlaying: false, didJustFinish: true });
      await this.stopAsync();
      this.activeListener = onStatusUpdate;
      const gen = ++this.generation;
      await av.Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
      });
      const { sound } = await av.Audio.Sound.createAsync(
        { uri },
        { shouldPlay: true, progressUpdateIntervalMillis: 200 },
        (status: any) => {
          if (gen !== this.generation) return;
          if (!status?.isLoaded) {
            if (status?.error) {
              this.playing = false;
              onStatusUpdate?.({ positionMs: 0, durationMs: 0, isPlaying: false, didJustFinish: true });
            }
            return;
          }
          this.playing = !!status.isPlaying;
          onStatusUpdate?.({
            positionMs: status.positionMillis ?? 0,
            durationMs: status.durationMillis ?? 0,
            isPlaying: !!status.isPlaying,
            didJustFinish: !!status.didJustFinish,
          });
          if (status.didJustFinish) {
            void this.stopAsync();
          }
        },
      );
      if (gen !== this.generation) {
        await sound.unloadAsync().catch(() => {});
        return { success: false, error: "Playback was interrupted." };
      }
      this.sound = sound;
      this.currentUri = uri;
      this.playing = true;
      return { success: true };
    } catch {
      this.playing = false;
      return { success: false, error: "Could not play this voice message. It may have expired." };
    }
  }

  async pauseAsync(): Promise<void> {
    this.playing = false;
    try {
      await this.sound?.pauseAsync();
    } catch {
      // Already unloaded.
    }
  }

  async stopAsync(): Promise<void> {
    this.generation++;
    this.playing = false;
    const sound = this.sound;
    this.sound = null;
    this.currentUri = null;
    if (!sound) return;
    try {
      await sound.stopAsync();
    } catch {
      // Already stopped.
    }
    try {
      await sound.unloadAsync();
    } catch {
      // Already unloaded.
    }
  }

  async releaseAsync(): Promise<void> {
    await this.stopAsync();
  }
}

let activeRecorderAdapter: AudioRecorderAdapter = new ExpoAvAudioRecorderAdapter();
let activePlayerAdapter: AudioPlayerAdapter = new ExpoAvAudioPlayerAdapter();

export function getAudioRecorderAdapter(): AudioRecorderAdapter {
  return activeRecorderAdapter;
}

export function registerAudioRecorderAdapter(adapter: AudioRecorderAdapter): void {
  activeRecorderAdapter = adapter;
}

export function getAudioPlayerAdapter(): AudioPlayerAdapter {
  return activePlayerAdapter;
}

export function registerAudioPlayerAdapter(adapter: AudioPlayerAdapter): void {
  activePlayerAdapter = adapter;
}
