import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Alert, Linking } from "react-native";
import { Mic, Square, Play, Pause, Trash2, RotateCcw } from "lucide-react-native";
import { Radii, Typography, ThemeColors } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import {
  cleanupAbandonedVoiceFile,
  getAudioPlayerAdapter,
  getAudioRecorderAdapter,
} from "../../services/voiceMedia";
import {
  VOICE_INTRO_LIMITS,
  validateVoiceIntroDuration,
  type VoiceIntroValue,
} from "../../services/voiceIntroPolicy";

export type { VoiceIntroValue };

interface Props {
  value: VoiceIntroValue;
  onChange: (next: VoiceIntroValue) => void;
  disabled?: boolean;
}

const fmt = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
};

// Record, preview, re-record or delete a short voice introduction. Used while onboarding and in
// Complete Profile. Nothing is uploaded here; the parent uploads the local file when it saves.
export const VoiceIntroRecorder: React.FC<Props> = ({ value, onChange, disabled }) => {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stoppingRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const stopRecording = useCallback(async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    clearTimer();
    try {
      const res = await getAudioRecorderAdapter().stopRecordingAsync();
      setRecording(false);
      if (!res.success || !res.result) {
        Alert.alert("Voice intro", res.error || "The recording could not be saved.");
        return;
      }
      const durationSec = Math.round(res.result.durationMs / 1000);
      const check = validateVoiceIntroDuration(durationSec);
      if (!check.valid) {
        await cleanupAbandonedVoiceFile(res.result.uri);
        Alert.alert("Voice intro", check.error);
        return;
      }
      if (value.kind === "local") await cleanupAbandonedVoiceFile(value.uri);
      onChange({ kind: "local", uri: res.result.uri, durationSec });
    } finally {
      stoppingRef.current = false;
    }
  }, [onChange, value]);

  const startRecording = async () => {
    if (disabled || recording) return;
    await getAudioPlayerAdapter().stopAsync();
    setPreviewing(false);
    const recorder = getAudioRecorderAdapter();
    const perm = await recorder.requestPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "Microphone access needed",
        perm.canAskAgain
          ? "Allow microphone access to record your voice intro."
          : "Turn on microphone access for Chahat in your phone's Settings to record a voice intro.",
        perm.canAskAgain ? undefined : [{ text: "Open Settings", onPress: () => void Linking.openSettings() }, { text: "Not now", style: "cancel" }],
      );
      return;
    }
    const started = await recorder.startRecordingAsync(VOICE_INTRO_LIMITS.maxDurationSec * 1000);
    if (!started.success) {
      Alert.alert("Voice intro", started.error || "Could not start recording.");
      return;
    }
    setSeconds(0);
    setRecording(true);
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
  };

  // Auto-stop at the maximum length.
  useEffect(() => {
    if (recording && seconds >= VOICE_INTRO_LIMITS.maxDurationSec) void stopRecording();
  }, [recording, seconds, stopRecording]);

  // Leaving the screen mid-recording discards it and releases the microphone.
  useEffect(
    () => () => {
      clearTimer();
      void getAudioRecorderAdapter().cancelRecordingAsync();
      void getAudioPlayerAdapter().stopAsync();
    },
    [],
  );

  const playbackUri = value.kind === "local" ? value.uri : null;

  const togglePreview = async () => {
    const adapter = getAudioPlayerAdapter();
    if (previewing) {
      await adapter.pauseAsync();
      setPreviewing(false);
      return;
    }
    if (!playbackUri) return;
    const res = await adapter.playAsync(playbackUri, (status) => {
      setPreviewing(status.isPlaying && !status.didJustFinish);
    });
    if (!res.success) Alert.alert("Voice intro", res.error || "Could not play the recording.");
    else setPreviewing(true);
  };

  const remove = () => {
    void getAudioPlayerAdapter().stopAsync();
    setPreviewing(false);
    if (value.kind === "local") void cleanupAbandonedVoiceFile(value.uri);
    onChange({ kind: "none" });
  };

  const rerecord = async () => {
    remove();
    await startRecording();
  };

  if (recording) {
    return (
      <View style={styles.card} testID="voice-intro-recording">
        <View style={styles.row}>
          <View style={styles.dot} />
          <Text style={styles.time}>
            {fmt(seconds)} / {fmt(VOICE_INTRO_LIMITS.maxDurationSec)}
          </Text>
          <TouchableOpacity
            style={styles.stopBtn}
            onPress={() => void stopRecording()}
            accessibilityLabel="Stop recording"
            testID="voice-intro-stop"
          >
            <Square size={16} color={Colors.primaryForeground} fill={Colors.primaryForeground} />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (value.kind === "none") {
    return (
      <View style={styles.card}>
        <TouchableOpacity
          style={[styles.recordBtn, disabled && styles.disabled]}
          onPress={() => void startRecording()}
          disabled={disabled}
          accessibilityLabel="Record voice intro"
          testID="voice-intro-record"
          activeOpacity={0.8}
        >
          <Mic size={18} color={Colors.primaryForeground} />
          <Text style={styles.recordText}>Record voice intro</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>
          {VOICE_INTRO_LIMITS.minDurationSec}–{VOICE_INTRO_LIMITS.maxDurationSec} seconds. Say hi and tell people what you're about.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.card} testID="voice-intro-ready">
      <View style={styles.row}>
        {playbackUri ? (
          <TouchableOpacity
            style={styles.playBtn}
            onPress={() => void togglePreview()}
            accessibilityLabel={previewing ? "Pause preview" : "Play preview"}
            testID="voice-intro-preview"
          >
            {previewing ? (
              <Pause size={18} color={Colors.primaryForeground} fill={Colors.primaryForeground} />
            ) : (
              <Play size={18} color={Colors.primaryForeground} fill={Colors.primaryForeground} />
            )}
          </TouchableOpacity>
        ) : (
          <View style={styles.playBtn}>
            <Mic size={18} color={Colors.primaryForeground} />
          </View>
        )}
        <View style={styles.flex}>
          <Text style={styles.title}>Voice intro · {fmt(value.durationSec)}</Text>
          <Text style={styles.hint}>
            {value.kind === "local" ? "Saved when you save your profile." : "Visible on your profile."}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => void rerecord()}
          accessibilityLabel="Re-record voice intro"
          testID="voice-intro-rerecord"
        >
          <RotateCcw size={18} color={Colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={remove}
          accessibilityLabel="Delete voice intro"
          testID="voice-intro-delete"
        >
          <Trash2 size={18} color={Colors.destructive} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const createStyles = (Colors: ThemeColors) =>
  StyleSheet.create({
    card: {
      backgroundColor: Colors.card,
      borderRadius: Radii.xl,
      borderWidth: 1,
      borderColor: Colors.border,
      padding: 14,
      marginTop: 8,
    },
    row: { flexDirection: "row", alignItems: "center", gap: 12 },
    flex: { flex: 1 },
    dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.destructive },
    time: { flex: 1, fontSize: Typography.sizes.base, fontWeight: Typography.weights.semibold, color: Colors.foreground },
    stopBtn: {
      width: 44, height: 44, borderRadius: Radii.full, backgroundColor: Colors.destructive,
      alignItems: "center", justifyContent: "center",
    },
    recordBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
      backgroundColor: Colors.primary, borderRadius: Radii.full, paddingVertical: 12,
    },
    recordText: { color: Colors.primaryForeground, fontWeight: Typography.weights.semibold, fontSize: Typography.sizes.sm },
    disabled: { opacity: 0.5 },
    playBtn: {
      width: 44, height: 44, borderRadius: Radii.full, backgroundColor: Colors.primary,
      alignItems: "center", justifyContent: "center",
    },
    title: { fontSize: Typography.sizes.sm, fontWeight: Typography.weights.semibold, color: Colors.foreground },
    hint: { fontSize: 12, color: Colors.mutedForeground, marginTop: 6 },
    iconBtn: { padding: 8 },
  });
