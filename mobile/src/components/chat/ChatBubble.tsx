import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Pressable, Alert } from "react-native";
import { Image } from "expo-image";
import { Check, CheckCheck, AlertCircle, Play, Pause, Mic, Ban } from "lucide-react-native";
import { Radii, Typography, ThemeColors } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import type { Message } from "../../types";
import { getAudioPlayerAdapter } from "../../services/voiceMedia";
import { DELETED_BY_ME_PREVIEW_TEXT, DELETED_PREVIEW_TEXT } from "../../utils/messageState";

interface ChatBubbleProps {
  message: Message;
  showDayHeader?: boolean;
  /** Long press on the bubble (message actions). Omit to keep the bubble non-interactive. */
  onLongPress?: (message: Message) => void;
}

export const ChatBubble: React.FC<ChatBubbleProps> = ({
  message,
  showDayHeader = false,
  onLongPress,
}) => {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const isMe = message.from === "me";
  const date = new Date(message.at);
  const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const isDeleted = !!message.deletedAt;
  const isVoice = !isDeleted && (message.messageType === "voice" || !!message.audio);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const durationSec = message.audioDurationSec || 5;

  // A voice note that gets deleted for everyone while this bubble is playing it must stop at once.
  useEffect(() => {
    if (!isDeleted || !isPlaying) return;
    setIsPlaying(false);
    setProgress(0);
    getAudioPlayerAdapter()
      .stopAsync()
      .catch(() => {});
  }, [isDeleted, isPlaying]);

  const formatDateHeader = (timestamp: number) => {
    const today = new Date().toDateString();
    const msgDate = new Date(timestamp).toDateString();
    if (today === msgDate) return "Today";
    return new Date(timestamp).toLocaleDateString([], { month: "short", day: "numeric" });
  };

  const handleTogglePlay = async () => {
    if (!message.audio) return;
    const player = getAudioPlayerAdapter();
    if (isPlaying) {
      await player.pauseAsync();
      setIsPlaying(false);
      return;
    }
    setIsPlaying(true);
    const res = await player.playAsync(message.audio, (status) => {
      if (status.durationMs > 0) {
        setProgress(status.positionMs / status.durationMs);
      }
      if (status.didJustFinish || (!status.isPlaying && status.positionMs === 0)) {
        setIsPlaying(false);
        setProgress(0);
      }
    });
    if (!res.success) {
      setIsPlaying(false);
      setProgress(0);
      Alert.alert(
        "Voice message",
        res.error || "Could not play this voice message. Please try again.",
      );
    }
  };

  return (
    <View style={styles.container}>
      {showDayHeader && (
        <View style={styles.dayHeader}>
          <Text style={styles.dayHeaderText}>{formatDateHeader(message.at)}</Text>
        </View>
      )}

      <View style={[styles.row, isMe ? styles.rowMe : styles.rowThem]}>
        <Pressable
          testID={`message-bubble-${message.id}`}
          onLongPress={onLongPress ? () => onLongPress(message) : undefined}
          delayLongPress={350}
          accessibilityHint={onLongPress ? "Long press for message options" : undefined}
          style={[
            styles.bubble,
            isMe ? styles.bubbleMe : styles.bubbleThem,
            isVoice && styles.bubbleVoice,
            message.status === "failed" && styles.bubbleFailed,
            isDeleted && styles.bubbleDeleted,
          ]}
        >
          {isDeleted ? (
            <View style={styles.deletedRow} testID={`message-tombstone-${message.id}`}>
              <Ban size={14} color={Colors.mutedForeground} />
              <Text style={styles.deletedText}>
                {isMe ? DELETED_BY_ME_PREVIEW_TEXT : DELETED_PREVIEW_TEXT}
              </Text>
            </View>
          ) : null}

          {!isDeleted && message.image ? (
            <Image source={{ uri: message.image }} style={styles.image} contentFit="cover" />
          ) : null}

          {isDeleted ? null : isVoice ? (
            <View style={styles.voiceContainer}>
              <TouchableOpacity
                style={[
                  styles.voicePlayBtn,
                  isMe ? styles.voicePlayBtnMe : styles.voicePlayBtnThem,
                ]}
                onPress={handleTogglePlay}
                activeOpacity={0.8}
              >
                {isPlaying ? (
                  <Pause size={18} color={isMe ? Colors.primary : Colors.primaryForeground} />
                ) : (
                  <Play
                    size={18}
                    color={isMe ? Colors.primary : Colors.primaryForeground}
                    style={{ marginLeft: 2 }}
                  />
                )}
              </TouchableOpacity>

              <View style={styles.voiceDetails}>
                <View style={styles.waveContainer}>
                  {[30, 60, 45, 90, 70, 40, 85, 55, 100, 65, 45, 80, 50, 75, 35].map(
                    (h, idx) => {
                      const isActive = progress > idx / 15;
                      return (
                        <View
                          key={idx}
                          style={[
                            styles.waveBar,
                            { height: (h / 100) * 20 },
                            isMe
                              ? isActive
                                ? styles.waveBarActiveMe
                                : styles.waveBarInactiveMe
                              : isActive
                                ? styles.waveBarActiveThem
                                : styles.waveBarInactiveThem,
                          ]}
                        />
                      );
                    },
                  )}
                </View>

                <View style={styles.voiceMetaRow}>
                  <View style={styles.micTag}>
                    <Mic size={10} color={isMe ? Colors.primaryForeground : Colors.mutedForeground} />
                    <Text
                      style={[
                        styles.voiceDurationText,
                        isMe ? styles.voiceTextMe : styles.voiceTextThem,
                      ]}
                    >
                      {durationSec}s
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          ) : message.text ? (
            <Text style={[styles.text, isMe ? styles.textMe : styles.textThem]}>
              {message.text}
            </Text>
          ) : null}

          <View style={styles.footer}>
            <Text
              style={[
                styles.time,
                isMe && !isDeleted ? styles.timeMe : styles.timeThem,
              ]}
            >
              {timeStr}
            </Text>

            {isMe && !isDeleted && message.status !== "failed" && (
              <View style={styles.tick}>
                {message.status === "read" ? (
                  <CheckCheck size={13} color={Colors.primaryForeground} />
                ) : (
                  <Check size={13} color={Colors.primaryForeground} />
                )}
              </View>
            )}

            {isMe && !isDeleted && message.status === "failed" && (
              <View style={styles.tick}>
                <AlertCircle size={13} color={Colors.destructive} />
              </View>
            )}
          </View>
        </Pressable>
      </View>
    </View>
  );
};

const createStyles = (Colors: ThemeColors) => StyleSheet.create({
  container: {
    marginVertical: 4,
    paddingHorizontal: 16,
  },
  dayHeader: {
    alignItems: "center",
    marginVertical: 12,
  },
  dayHeaderText: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
    color: Colors.mutedForeground,
  },
  row: {
    flexDirection: "row",
  },
  rowMe: {
    justifyContent: "flex-end",
  },
  rowThem: {
    justifyContent: "flex-start",
  },
  bubble: {
    maxWidth: "80%",
    borderRadius: Radii.lg,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleMe: {
    backgroundColor: Colors.primary,
    borderBottomRightRadius: Radii.sm,
  },
  bubbleThem: {
    backgroundColor: Colors.card,
    borderBottomLeftRadius: Radii.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  bubbleFailed: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.destructive,
  },
  bubbleDeleted: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: Colors.border,
  },
  deletedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  deletedText: {
    fontSize: Typography.sizes.sm,
    fontStyle: "italic",
    color: Colors.mutedForeground,
  },
  image: {
    width: 220,
    height: 220,
    borderRadius: Radii.md,
    marginBottom: 6,
  },
  text: {
    fontSize: Typography.sizes.base,
    lineHeight: 20,
  },
  textMe: {
    color: Colors.primaryForeground,
  },
  textThem: {
    color: Colors.foreground,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    marginTop: 4,
    gap: 4,
  },
  time: {
    fontSize: 10,
  },
  timeMe: {
    color: "rgba(255, 255, 255, 0.75)",
  },
  timeThem: {
    color: Colors.mutedForeground,
  },
  tick: {
    marginLeft: 2,
  },
  bubbleVoice: {
    minWidth: 200,
  },
  voiceContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
    gap: 10,
  },
  voicePlayBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  voicePlayBtnMe: {
    backgroundColor: Colors.primaryForeground,
  },
  voicePlayBtnThem: {
    backgroundColor: Colors.primary,
  },
  voiceDetails: {
    flex: 1,
    justifyContent: "center",
  },
  waveContainer: {
    flexDirection: "row",
    alignItems: "center",
    height: 24,
    gap: 3,
  },
  waveBar: {
    width: 3,
    borderRadius: 1.5,
  },
  waveBarActiveMe: {
    backgroundColor: Colors.primaryForeground,
  },
  waveBarInactiveMe: {
    backgroundColor: "rgba(255, 255, 255, 0.4)",
  },
  waveBarActiveThem: {
    backgroundColor: Colors.primary,
  },
  waveBarInactiveThem: {
    backgroundColor: Colors.border,
  },
  voiceMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 2,
  },
  micTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  voiceDurationText: {
    fontSize: 10,
    fontWeight: Typography.weights.semibold,
  },
  voiceTextMe: {
    color: "rgba(255, 255, 255, 0.85)",
  },
  voiceTextThem: {
    color: Colors.mutedForeground,
  },
});
