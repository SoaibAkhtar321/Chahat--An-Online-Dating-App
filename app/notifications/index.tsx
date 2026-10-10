import React, { useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Bell, Heart, MessageCircle, ShieldCheck } from "lucide-react-native";
import { Colors, Radii, Typography } from "../../src/constants/theme";
import { Header } from "../../src/components/ui/Header";

interface NoticeItem {
  id: string;
  kind: "match" | "message" | "like" | "safety";
  text: string;
  timeAgo: string;
  read: boolean;
}

const INITIAL_NOTICES: NoticeItem[] = [
  {
    id: "1",
    kind: "match",
    text: "You matched with Ananya! Say hello when you're ready.",
    timeAgo: "10m ago",
    read: false,
  },
  {
    id: "2",
    kind: "like",
    text: "Someone new liked your profile in Mumbai.",
    timeAgo: "2h ago",
    read: false,
  },
  {
    id: "3",
    kind: "safety",
    text: "Welcome to Milo! Complete photo verification to unlock your verified badge.",
    timeAgo: "1d ago",
    read: true,
  },
];

export default function NotificationsScreen() {
  const [notices, setNotices] = useState<NoticeItem[]>(INITIAL_NOTICES);

  const markAllRead = () => {
    setNotices(notices.map((n) => ({ ...n, read: true })));
  };

  const renderIcon = (kind: NoticeItem["kind"]) => {
    switch (kind) {
      case "match":
      case "like":
        return <Heart size={18} color={Colors.primary} fill={Colors.primary} />;
      case "message":
        return <MessageCircle size={18} color={Colors.primary} />;
      case "safety":
      default:
        return <ShieldCheck size={18} color={Colors.accent} />;
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Header
        title="Notifications"
        rightElement={
          <TouchableOpacity onPress={markAllRead}>
            <Text style={styles.markReadText}>Read all</Text>
          </TouchableOpacity>
        }
      />

      <FlatList
        data={notices}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={[styles.itemCard, !item.read && styles.itemUnread]}>
            <View style={styles.iconCircle}>{renderIcon(item.kind)}</View>
            <View style={styles.itemContent}>
              <Text style={styles.itemText}>{item.text}</Text>
              <Text style={styles.itemTime}>{item.timeAgo}</Text>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyView}>
            <Bell size={48} color={Colors.mutedForeground} />
            <Text style={styles.emptyText}>No notifications yet</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  markReadText: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
    color: Colors.primary,
  },
  list: {
    padding: 20,
    gap: 12,
  },
  itemCard: {
    flexDirection: "row",
    backgroundColor: Colors.card,
    padding: 16,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    gap: 12,
  },
  itemUnread: {
    borderColor: Colors.primary,
    backgroundColor: "#FFF9F8",
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: Radii.full,
    backgroundColor: Colors.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  itemContent: {
    flex: 1,
  },
  itemText: {
    fontSize: Typography.sizes.sm,
    color: Colors.foreground,
    lineHeight: 18,
  },
  itemTime: {
    fontSize: Typography.sizes.xs,
    color: Colors.mutedForeground,
    marginTop: 4,
  },
  emptyView: {
    alignItems: "center",
    marginTop: 80,
    gap: 12,
  },
  emptyText: {
    fontSize: Typography.sizes.base,
    color: Colors.mutedForeground,
  },
});
