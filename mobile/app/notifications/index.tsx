import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Bell, Heart, MessageCircle, ShieldCheck, CheckCheck } from "lucide-react-native";
import { Colors, Radii, Typography } from "../../src/constants/theme";
import { Header } from "../../src/components/ui/Header";
import {
  fetchNotificationInbox,
  markAllNotificationsRead,
  markNotificationRead,
  NoticeItem,
} from "../../src/services/notifications";

export default function NotificationsScreen() {
  const router = useRouter();
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadNotices = useCallback(async () => {
    const list = await fetchNotificationInbox();
    setNotices(list);
  }, []);

  useEffect(() => {
    loadNotices();
  }, [loadNotices]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadNotices();
    setRefreshing(false);
  };

  const handleMarkAllRead = async () => {
    await markAllNotificationsRead();
    setNotices((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const handlePressNotice = async (item: NoticeItem) => {
    if (!item.read) {
      await markNotificationRead(item.id);
      setNotices((prev) => prev.map((n) => (n.id === item.id ? { ...n, read: true } : n)));
    }

    if (item.data?.matchId) {
      router.push({
        pathname: "/chat/[id]",
        params: { id: item.data.matchId },
      });
    } else if (item.kind === "like") {
      router.push("/(tabs)/likes");
    } else if (item.kind === "safety") {
      router.push("/safety");
    }
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

  const unreadCount = notices.filter((n) => !n.read).length;

  return (
    <SafeAreaView style={styles.container}>
      <Header
        title="Notifications"
        rightElement={
          unreadCount > 0 ? (
            <TouchableOpacity onPress={handleMarkAllRead} style={styles.markReadBtn} activeOpacity={0.7}>
              <CheckCheck size={16} color={Colors.primary} />
              <Text style={styles.markReadText}>Read all</Text>
            </TouchableOpacity>
          ) : undefined
        }
      />

      <FlatList
        data={notices}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.itemCard, !item.read && styles.itemUnread]}
            onPress={() => handlePressNotice(item)}
            activeOpacity={0.8}
          >
            <View style={styles.iconCircle}>{renderIcon(item.kind)}</View>
            <View style={styles.itemContent}>
              {item.title ? <Text style={styles.itemTitle}>{item.title}</Text> : null}
              <Text style={styles.itemText}>{item.text}</Text>
              <Text style={styles.itemTime}>{item.timeAgo}</Text>
            </View>
            {!item.read && <View style={styles.unreadDot} />}
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.emptyView}>
            <View style={styles.emptyIconCircle}>
              <Bell size={36} color={Colors.mutedForeground} />
            </View>
            <Text style={styles.emptyTitle}>No notifications</Text>
            <Text style={styles.emptyText}>You're all caught up with your matches and messages.</Text>
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
  markReadBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  markReadText: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
    color: Colors.primary,
  },
  list: {
    padding: 16,
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
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.primary,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: Radii.full,
    backgroundColor: Colors.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  itemContent: {
    flex: 1,
  },
  itemTitle: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
    marginBottom: 2,
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
    paddingHorizontal: 32,
    gap: 10,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.secondary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: Typography.sizes.lg,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
  },
  emptyText: {
    fontSize: Typography.sizes.sm,
    color: Colors.mutedForeground,
    textAlign: "center",
    lineHeight: 20,
  },
});
