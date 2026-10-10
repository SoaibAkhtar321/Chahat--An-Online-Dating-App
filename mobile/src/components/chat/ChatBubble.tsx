import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { Check, CheckCheck, AlertCircle } from "lucide-react-native";
import { Colors, Radii, Typography } from "../../constants/theme";
import type { Message } from "../../types";

interface ChatBubbleProps {
  message: Message;
  showDayHeader?: boolean;
}

export const ChatBubble: React.FC<ChatBubbleProps> = ({ message, showDayHeader = false }) => {
  const isMe = message.from === "me";
  const date = new Date(message.at);
  const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const formatDateHeader = (timestamp: number) => {
    const today = new Date().toDateString();
    const msgDate = new Date(timestamp).toDateString();
    if (today === msgDate) return "Today";
    return new Date(timestamp).toLocaleDateString([], { month: "short", day: "numeric" });
  };

  return (
    <View style={styles.container}>
      {showDayHeader && (
        <View style={styles.dayHeader}>
          <Text style={styles.dayHeaderText}>{formatDateHeader(message.at)}</Text>
        </View>
      )}

      <View style={[styles.row, isMe ? styles.rowMe : styles.rowThem]}>
        <View
          style={[
            styles.bubble,
            isMe ? styles.bubbleMe : styles.bubbleThem,
            message.status === "failed" && styles.bubbleFailed,
          ]}
        >
          {message.image ? (
            <Image source={{ uri: message.image }} style={styles.image} contentFit="cover" />
          ) : null}

          {message.text ? (
            <Text style={[styles.text, isMe ? styles.textMe : styles.textThem]}>
              {message.text}
            </Text>
          ) : null}

          <View style={styles.footer}>
            <Text style={[styles.time, isMe ? styles.timeMe : styles.timeThem]}>{timeStr}</Text>

            {isMe && message.status !== "failed" && (
              <View style={styles.tick}>
                {message.status === "read" ? (
                  <CheckCheck size={13} color={Colors.primaryForeground} />
                ) : (
                  <Check size={13} color={Colors.primaryForeground} />
                )}
              </View>
            )}

            {isMe && message.status === "failed" && (
              <View style={styles.tick}>
                <AlertCircle size={13} color={Colors.destructive} />
              </View>
            )}
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
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
});
