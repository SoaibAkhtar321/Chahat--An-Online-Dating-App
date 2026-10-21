import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Pressable, Alert } from "react-native";
import { Image } from "expo-image";
import { Check, CheckCheck, AlertCircle, Play, Pause, Mic, Ban, Camera } from "lucide-react-native";
import { Radii, Typography, ThemeColors, Layout, Spacing } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import type { Message } from "../../types";
import { getAudioPlayerAdapter } from "../../services/voiceMedia";
import { DELETED_BY_ME_PREVIEW_TEXT, DELETED_PREVIEW_TEXT } from "../../utils/messageState";
import type { ReactionSummary } from "../../utils/reactions";
import { replyAuthorLabel, replySnippet } from "../../utils/replies";

interface ChatBubbleProps {
  message: Message;
  showDayHeader?: boolean;
  /** Long press on the bubble (message actions). Omit to keep the bubble non-interactive. */
  onLongPress?: (message: Message) => void;
  /** Reaction chips under the bubble (already grouped). Never shown on a message deleted for everyone. */
  reactions?: ReactionSummary[];
  /** Tap on a chip: toggles the current user's reaction with that emoji. */
  onReactionPress?: (message: Message, emoji: string) => void;
  /** Name shown on the quote of a reply to the partner's message. */
  partnerName?: string;
  /** The quoted original was deleted (for everyone or for me): the quote shows no content. */
  replyUnavailable?: boolean;
  /** Tap on the quote: jump to the original message. Ignored while the original is unavailable. */
  onReplyPress?: (replyToId: string) => void;
}

export const ChatBubble: React.FC<ChatBubbleProps> = ({
  message,
  showDayHeader = false,
  onLongPress,
  reactions,
  onReactionPress,
  partnerName = "",
  replyUnavailable = false,
  onReplyPress,
}) => {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const isMe = message.from === "me";
  const date = new Date(message.at);
  const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const isDeleted = !!message.deletedAt;
  const isVoice = !isDeleted && (message.messageType === "voice" || !!message.audio);
  // Quoted original of a reply. Never shown on a message deleted for everyone.
  const quote = !isDeleted && message.replyTo ? message.replyTo : null;
  const quoteUnavailable = !!quote && (quote.unavailable || replyUnavailable);
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

          {quote ? (
            <Pressable
              testID={`message-reply-quote-${message.id}`}
              onPress={!quoteUnavailable && onReplyPress ? () => onReplyPress(quote.id) : undefined}
              disabled={quoteUnavailable || !onReplyPress}
              accessibilityRole="button"
              accessibilityLabel={
                quoteUnavailable
                  ? "Reply to a message that is no longer available"
                  : `Reply to ${replyAuthorLabel(quote, partnerName)}: ${replySnippet(quote)}`
              }
              style={[styles.quote, isMe ? styles.quoteMe : styles.quoteThem]}
            >
              {quoteUnavailable ? (
                <View style={styles.quoteLine}>
                  <Ban size={12} color={isMe ? "rgba(255,255,255,0.8)" : Colors.mutedForeground} />
                  <Text
                    style={[styles.quoteText, styles.quoteTextUnavailable, isMe ? styles.quoteTextMe : styles.quoteTextThem]}
                    numberOfLines={1}
                  >
                    {replySnippet({ ...quote, unavailable: true })}
                  </Text>
                </View>
              ) : (
                <>
                  <Text
                    style={[styles.quoteAuthor, isMe ? styles.quoteAuthorMe : styles.quoteAuthorThem]}
                    numberOfLines={1}
                  >
                    {replyAuthorLabel(quote, partnerName)}
                  </Text>
                  <View style={styles.quoteLine}>
                    {quote.kind === "image" ? (
                      <Camera size={12} color={isMe ? "rgba(255,255,255,0.8)" : Colors.mutedForeground} />
                    ) : quote.kind === "voice" ? (
                      <Mic size={12} color={isMe ? "rgba(255,255,255,0.8)" : Colors.mutedForeground} />
                    ) : null}
                    <Text
                      style={[styles.quoteText, isMe ? styles.quoteTextMe : styles.quoteTextThem]}
                      numberOfLines={2}
                    >
                      {replySnippet(quote)}
                    </Text>
                  </View>
                </>
              )}
            </Pressable>
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
                accessibilityRole="button"
                accessibilityLabel={isPlaying ? "Pause voice message" : "Play voice message"}
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
              <View
                style={styles.tick}
                accessibilityLabel={
                  message.status === "read" ? "Read" : message.status === "delivered" ? "Delivered" : "Sent"
                }
              >
                {message.status === "read" ? (
                  <CheckCheck size={14} color={READ_TICK_COLOR} />
                ) : message.status === "delivered" ? (
                  <CheckCheck size={14} color={PENDING_TICK_COLOR} />
                ) : (
                  <Check size={14} color={PENDING_TICK_COLOR} />
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

      {!isDeleted && reactions && reactions.length > 0 ? (
        <View
          style={[styles.reactionRow, isMe ? styles.rowMe : styles.rowThem]}
          testID={`message-reactions-${message.id}`}
        >
          {reactions.map((r) => (
            <TouchableOpacity
              key={r.emoji}
              style={[styles.reactionChip, r.mine && styles.reactionChipMine]}
              onPress={onReactionPress ? () => onReactionPress(message, r.emoji) : undefined}
              disabled={!onReactionPress}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`${r.emoji} reaction${r.count > 1 ? `, ${r.count} people` : ""}${r.mine ? ", yours" : ""}`}
              testID={`message-reaction-chip-${message.id}-${r.emoji}`}
            >
              <Text style={styles.reactionEmoji}>{r.emoji}</Text>
              {r.count > 1 ? <Text style={styles.reactionCount}>{r.count}</Text> : null}
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
};

// Read tick colour: a light sky blue that stays legible on the primary (terracotta) sent-bubble background.
const READ_TICK_COLOR = "#7DD3FC";
const PENDING_TICK_COLOR = "rgba(255, 255, 255, 0.75)";

const createStyles = (Colors: ThemeColors) => StyleSheet.create({
  container: {
    marginVertical: Spacing.xs,
    paddingHorizontal: Spacing.lg,
  },
  dayHeader: {
    alignItems: "center",
    marginVertical: Spacing.md,
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
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
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
    gap: Spacing.sm,
  },
  deletedText: {
    fontSize: Typography.sizes.sm,
    fontStyle: "italic",
    color: Colors.mutedForeground,
  },
  quote: {
    borderLeftWidth: 3,
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  quoteMe: {
    backgroundColor: "rgba(0, 0, 0, 0.15)",
    borderLeftColor: Colors.primaryForeground,
  },
  quoteThem: {
    backgroundColor: Colors.muted,
    borderLeftColor: Colors.primary,
  },
  quoteAuthor: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
    marginBottom: 1,
  },
  quoteAuthorMe: {
    color: Colors.primaryForeground,
  },
  quoteAuthorThem: {
    color: Colors.primary,
  },
  quoteLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  quoteText: {
    flexShrink: 1,
    fontSize: Typography.sizes.sm,
  },
  quoteTextMe: {
    color: "rgba(255, 255, 255, 0.85)",
  },
  quoteTextThem: {
    color: Colors.mutedForeground,
  },
  quoteTextUnavailable: {
    fontStyle: "italic",
  },
  image: {
    width: 220,
    height: 220,
    borderRadius: Radii.md,
    marginBottom: Spacing.sm,
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
    marginTop: Spacing.xs,
    gap: Spacing.xs,
  },
  time: {
    fontSize: Typography.sizes.xs,
  },
  timeMe: {
    color: "rgba(255, 255, 255, 0.75)",
  },
  timeThem: {
    color: Colors.mutedForeground,
  },
  tick: {
    marginLeft: Spacing.xs,
  },
  reactionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
    marginTop: -6,
    paddingHorizontal: Spacing.sm,
  },
  reactionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Radii.full,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  reactionChipMine: {
    borderColor: Colors.primary,
  },
  reactionEmoji: {
    fontSize: Typography.sizes.base,
  },
  reactionCount: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.semibold,
    color: Colors.mutedForeground,
  },
  bubbleVoice: {
    minWidth: 200,
  },
  voiceContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.xs,
    gap: Spacing.md,
  },
  voicePlayBtn: {
    width: Layout.minTap,
    height: Layout.minTap,
    borderRadius: Radii.full,
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
    gap: Spacing.xs,
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
    marginTop: Spacing.xs,
  },
  micTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  voiceDurationText: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.semibold,
  },
  voiceTextMe: {
    color: "rgba(255, 255, 255, 0.85)",
  },
  voiceTextThem: {
    color: Colors.mutedForeground,
  },
});
