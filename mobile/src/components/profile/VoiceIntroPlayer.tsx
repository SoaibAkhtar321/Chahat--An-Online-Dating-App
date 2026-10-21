import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Alert } from "react-native";
import { Play, Pause, Mic, Volume2 } from "lucide-react-native";
import { Radii, Typography, ThemeColors } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { getAudioPlayerAdapter } from "../../services/voiceMedia";
import { fetchVoiceIntro, type VoiceIntroPlayback } from "../../services/voiceIntro";

interface VoiceIntroPlayerProps {
  /** Profile whose intro is played. The intro is looked up (and signed) on demand. */
  userId?: string;
  userName?: string;
  /** Already-resolved intro, e.g. from the Discover feed. Skips the lookup. */
  source?: VoiceIntroPlayback | null;
}

const BAR_HEIGHTS = [4, 10, 16, 8, 22, 14, 18, 24, 12, 20, 8, 16, 22, 10, 6, 14, 20, 12, 18, 8];

const fmt = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
};

// Renders nothing when the member has not recorded a voice intro.
export const VoiceIntroPlayer: React.FC<VoiceIntroPlayerProps> = ({
  userId,
  userName = "Member",
  source,
}) => {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const [intro, setIntro] = useState<VoiceIntroPlayback | null>(source ?? null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState((source?.durationSec ?? 0) * 1000);
  const activeUrl = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (source) {
      setIntro(source);
      return;
    }
    if (!userId) return;
    void fetchVoiceIntro(userId).then((res) => {
      if (!cancelled) setIntro(res);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, source]);

  useEffect(() => {
    setDurationMs((intro?.durationSec ?? 0) * 1000);
  }, [intro]);

  // Stop playback when the profile screen goes away.
  useEffect(
    () => () => {
      const adapter = getAudioPlayerAdapter();
      if (activeUrl.current) void adapter.stopAsync();
    },
    [],
  );

  const toggle = useCallback(async () => {
    if (!intro) return;
    const adapter = getAudioPlayerAdapter();
    if (isPlaying) {
      await adapter.pauseAsync();
      setIsPlaying(false);
      return;
    }
    activeUrl.current = intro.url;
    const res = await adapter.playAsync(intro.url, (status) => {
      if (status.durationMs > 0) setDurationMs(status.durationMs);
      setPositionMs(status.didJustFinish ? 0 : status.positionMs);
      setIsPlaying(status.isPlaying && !status.didJustFinish);
    });
    if (!res.success) {
      Alert.alert("Voice intro", res.error || "Could not play this voice intro.");
      setIsPlaying(false);
      return;
    }
    setIsPlaying(true);
  }, [intro, isPlaying]);

  if (!intro) return null;

  const totalSec = Math.round(durationMs / 1000) || intro.durationSec;
  const progressPercent = durationMs > 0 ? Math.min(100, Math.round((positionMs / durationMs) * 100)) : 0;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.tag}>
          <Mic size={14} color={Colors.primary} />
          <Text style={styles.tagText}>Voice Intro · {totalSec}s</Text>
        </View>
        <Volume2 size={16} color={Colors.mutedForeground} />
      </View>

      <Text style={styles.title}>Listen to {userName}'s voice introduction</Text>

      <View style={styles.playerRow}>
        <TouchableOpacity
          style={styles.playButton}
          onPress={() => void toggle()}
          activeOpacity={0.8}
          accessibilityLabel={isPlaying ? "Pause voice intro" : "Play voice intro"}
          testID="voice-intro-play"
        >
          {isPlaying ? (
            <Pause size={18} color={Colors.primaryForeground} fill={Colors.primaryForeground} />
          ) : (
            <Play size={18} color={Colors.primaryForeground} fill={Colors.primaryForeground} />
          )}
        </TouchableOpacity>

        <View style={styles.trackContainer}>
          <View style={styles.waveform}>
            {BAR_HEIGHTS.map((height, idx) => {
              const active = (idx / BAR_HEIGHTS.length) * 100 <= progressPercent;
              return (
                <View
                  key={idx}
                  style={[styles.bar, { height }, active ? styles.barActive : styles.barInactive]}
                />
              );
            })}
          </View>

          <View style={styles.timeRow}>
            <Text style={styles.timeText}>{fmt(positionMs / 1000)}</Text>
            <Text style={styles.timeText}>{fmt(totalSec)}</Text>
          </View>
        </View>
      </View>
    </View>
  );
};

const createStyles = (Colors: ThemeColors) => StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginVertical: 10,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.secondary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radii.full,
  },
  tagText: {
    fontSize: 11,
    fontWeight: Typography.weights.semibold,
    color: Colors.primary,
  },
  title: {
    fontSize: Typography.sizes.sm,
    color: Colors.mutedForeground,
    marginBottom: 12,
  },
  playerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  playButton: {
    width: 44,
    height: 44,
    borderRadius: Radii.full,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  trackContainer: {
    flex: 1,
  },
  waveform: {
    flexDirection: "row",
    alignItems: "center",
    height: 28,
    gap: 4,
  },
  bar: {
    flex: 1,
    borderRadius: 2,
  },
  barActive: {
    backgroundColor: Colors.primary,
  },
  barInactive: {
    backgroundColor: Colors.muted,
  },
  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },
  timeText: {
    fontSize: 10,
    color: Colors.mutedForeground,
    fontWeight: Typography.weights.medium,
  },
});
