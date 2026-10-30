import React, { useMemo } from "react";
import { formatChatListTime } from "../../src/utils/chatTime";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { MessageCircle, Video } from "lucide-react-native";
import { Radii, Typography, ThemeColors, Layout, Spacing } from "../../src/constants/theme";
import { useTheme } from "../../src/context/ThemeContext";
import { ProfilePhoto } from "../../src/components/profile/ProfilePhoto";
import { useMilo } from "../../src/context/MiloContext";
import { Button } from "../../src/components/ui/Button";
import { messagePreviewText } from "../../src/utils/messageState";

export default function ChatsScreen() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const router = useRouter();
  const { matches } = useMilo();

  const newMatches = matches.filter((m) => !m.lastMessage);
  const conversations = matches.filter((m) => !!m.lastMessage);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Chats</Text>
        <TouchableOpacity
          style={styles.callsBtn}
          onPress={() => router.push("/calls")}
          activeOpacity={0.7}
        >
          <Video size={16} color={Colors.primary} />
          <Text style={styles.callsText}>Calls</Text>
        </TouchableOpacity>
      </View>

      {matches.length === 0 ? (
        <View style={styles.emptyContainer}>
          <MessageCircle size={56} color={Colors.mutedForeground} />
          <Text style={styles.emptyTitle}>No matches yet</Text>
          <Text style={styles.emptySubtitle}>
            When you and someone like each other, you can chat here.
          </Text>
          <Button
            title="Start discovering"
            onPress={() => router.push("/(tabs)/discover")}
            size="lg"
            style={styles.emptyBtn}
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* New matches horizontal reel */}
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>NEW MATCHES</Text>
            {newMatches.length === 0 ? (
              <Text style={styles.noMatchesText}>No new matches. Keep swiping!</Text>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.matchReel}
              >
                {newMatches.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    style={styles.matchAvatarItem}
                    onPress={() =>
                      router.push({
                        pathname: "/chat/[id]",
                        params: { id: item.id },
                      })
                    }
                    activeOpacity={0.8}
                  >
                    <ProfilePhoto
                      uri={item.otherUser.photos[0]}
                      name={item.otherUser.name}
                      style={styles.avatarNew}
                    />
                    <Text style={styles.matchAvatarName} numberOfLines={1}>
                      {item.otherUser.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>

          {/* Messages list */}
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>MESSAGES</Text>
            {conversations.length === 0 && (
              <Text style={styles.noMatchesText}>
                Say hi to a new match to start a conversation.
              </Text>
            )}

            {conversations.map((item) => {
              const last = item.lastMessage;
              const hasUnread = item.unreadCount > 0;
              // Today: time. Yesterday: "Yesterday". Older: date (it used to show only the time, even for last week).
              const timeStr = last ? formatChatListTime(last.at) : "";

              return (
                <TouchableOpacity
                  key={item.id}
                  style={styles.convoItem}
                  onPress={() =>
                    router.push({
                      pathname: "/chat/[id]",
                      params: { id: item.id },
                    })
                  }
                  activeOpacity={0.7}
                >
                  <ProfilePhoto
                    uri={item.otherUser.photos[0]}
                    name={item.otherUser.name}
                    style={styles.convoAvatar}
                  />
                  <View style={styles.convoDetails}>
                    <View style={styles.convoTopRow}>
                      <Text style={styles.convoName}>{item.otherUser.name}</Text>
                      <Text style={[styles.convoTime, hasUnread && styles.timeUnread]}>
                        {timeStr}
                      </Text>
                    </View>
                    <View style={styles.convoBottomRow}>
                      <Text
                        style={[styles.convoSnippet, hasUnread && styles.snippetUnread]}
                        numberOfLines={1}
                      >
                        {last?.from === "me" && !last.deletedAt ? "You: " : ""}
                        {messagePreviewText(last)}
                      </Text>
                      {hasUnread && (
                        <View style={styles.unreadBadge}>
                          <Text style={styles.unreadBadgeText}>{item.unreadCount}</Text>
                        </View>
                      )}
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const createStyles = (Colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    height: 60,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Layout.screenPadding,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  title: {
    fontSize: Typography.sizes.title,
    fontWeight: Typography.weights.bold,
    fontFamily: Typography.fontDisplay,
    color: Colors.foreground,
  },
  callsBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  callsText: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.bold,
    color: Colors.primary,
  },
  content: {
    padding: Spacing.lg,
  },
  section: {
    marginBottom: Spacing.xl,
  },
  sectionHeader: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
    color: Colors.mutedForeground,
    letterSpacing: 1,
    marginBottom: Spacing.md,
  },
  noMatchesText: {
    fontSize: Typography.sizes.sm,
    color: Colors.mutedForeground,
    paddingVertical: Spacing.sm,
  },
  matchReel: {
    gap: Spacing.lg,
    paddingVertical: Spacing.xs,
  },
  matchAvatarItem: {
    alignItems: "center",
    width: 68,
  },
  avatarNew: {
    width: 64,
    height: 64,
    borderRadius: Radii.full,
    borderWidth: 2,
    borderColor: Colors.primary,
  },
  matchAvatarName: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
    marginTop: Spacing.sm,
    textAlign: "center",
  },
  convoItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: Spacing.md,
  },
  convoAvatar: {
    width: 54,
    height: 54,
    borderRadius: Radii.full,
  },
  convoDetails: {
    flex: 1,
  },
  convoTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.xs,
  },
  convoName: {
    fontSize: Typography.sizes.base,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
  },
  convoTime: {
    fontSize: Typography.sizes.xs,
    color: Colors.mutedForeground,
  },
  timeUnread: {
    color: Colors.primary,
    fontWeight: Typography.weights.bold,
  },
  convoBottomRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  convoSnippet: {
    flex: 1,
    fontSize: Typography.sizes.sm,
    color: Colors.mutedForeground,
  },
  snippetUnread: {
    color: Colors.foreground,
    fontWeight: Typography.weights.semibold,
  },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: Radii.full,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.sm,
    marginLeft: Spacing.sm,
  },
  unreadBadgeText: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
    color: Colors.primaryForeground,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.xxl,
  },
  emptyTitle: {
    fontSize: Typography.sizes.xxl,
    fontWeight: Typography.weights.bold,
    fontFamily: Typography.fontDisplay,
    color: Colors.foreground,
    marginTop: Spacing.lg,
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: Typography.sizes.base,
    color: Colors.mutedForeground,
    textAlign: "center",
    marginTop: Spacing.sm,
    lineHeight: 22,
    marginBottom: Spacing.xl,
  },
  emptyBtn: {
    width: "100%",
  },
});
