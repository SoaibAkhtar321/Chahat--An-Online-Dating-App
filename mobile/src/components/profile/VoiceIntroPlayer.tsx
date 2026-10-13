import React, { useMemo, useState, useEffect } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Play, Pause, Mic, Volume2 } from "lucide-react-native";
import { Radii, Typography, ThemeColors } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";

interface VoiceIntroPlayerProps {
  userName?: string;
  durationSec?: number;
}

export const VoiceIntroPlayer: React.FC<VoiceIntroPlayerProps> = ({
  userName = "Member",
  durationSec = 22,
}) => {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSec, setCurrentSec] = useState(0);

  useEffect(() => {
    let timer: any;
    if (isPlaying) {
      timer = setInterval(() => {
        setCurrentSec((prev) => {
          if (prev >= durationSec) {
            setIsPlaying(false);
            return 0;
          }
          return prev + 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isPlaying, durationSec]);

  const togglePlay = () => {
    if (isPlaying) {
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
    }
  };

  const progressPercent = Math.min(100, Math.round((currentSec / durationSec) * 100));

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.tag}>
          <Mic size={14} color={Colors.primary} />
          <Text style={styles.tagText}>Voice Intro · {durationSec}s</Text>
        </View>
        <Volume2 size={16} color={Colors.mutedForeground} />
      </View>

      <Text style={styles.title}>Listen to {userName}'s voice introduction</Text>

      <View style={styles.playerRow}>
        <TouchableOpacity style={styles.playButton} onPress={togglePlay} activeOpacity={0.8}>
          {isPlaying ? (
            <Pause size={18} color={Colors.primaryForeground} fill={Colors.primaryForeground} />
          ) : (
            <Play size={18} color={Colors.primaryForeground} fill={Colors.primaryForeground} />
          )}
        </TouchableOpacity>

        <View style={styles.trackContainer}>
          <View style={styles.waveform}>
            {[4, 10, 16, 8, 22, 14, 18, 24, 12, 20, 8, 16, 22, 10, 6, 14, 20, 12, 18, 8].map(
              (height, idx) => {
                const barProgress = (idx / 20) * 100;
                const active = barProgress <= progressPercent;
                return (
                  <View
                    key={idx}
                    style={[
                      styles.bar,
                      { height },
                      active ? styles.barActive : styles.barInactive,
                    ]}
                  />
                );
              },
            )}
          </View>

          <View style={styles.timeRow}>
            <Text style={styles.timeText}>0:{currentSec.toString().padStart(2, "0")}</Text>
            <Text style={styles.timeText}>0:{durationSec.toString().padStart(2, "0")}</Text>
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
