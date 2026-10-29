// Settings → Blocked accounts: everyone the member has blocked, with Unblock.
// Blocking removes the match and the conversation for both people (safety: a blocked person can never see or
// message the blocker). After unblocking, the two can see each other in Discover again and match again.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Header } from "../../src/components/ui/Header";
import { AvatarPlaceholder } from "../../src/components/ui/AvatarPlaceholder";
import { Dialog } from "../../src/components/ui/Dialog";
import { useTheme } from "../../src/context/ThemeContext";
import { useMilo } from "../../src/context/MiloContext";
import { safeBack } from "../../src/utils/navigation";
import { Alert } from "../../src/utils/alert";
import { fetchBlockedUsers, unblockUser, type BlockedUser } from "../../src/services/moderation";
import { Radii, Spacing, ThemeColors, Typography } from "../../src/constants/theme";

function blockedSince(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `Blocked on ${d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`;
}

export default function BlockedAccountsScreen() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const router = useRouter();
  const { refreshDeck } = useMilo();
  const [items, setItems] = useState<BlockedUser[] | null>(null);
  const [confirm, setConfirm] = useState<BlockedUser | null>(null);

  const load = useCallback(async () => {
    setItems(await fetchBlockedUsers());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const doUnblock = async () => {
    const target = confirm;
    setConfirm(null);
    if (!target) return;
    const ok = await unblockUser(target.id);
    if (!ok) {
      Alert.alert("Couldn't unblock", "Please check your connection and try again.");
      return;
    }
    setItems((prev) => (prev ?? []).filter((u) => u.id !== target.id));
    void refreshDeck();
  };

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Blocked accounts" onBackPress={() => safeBack(router, "/settings")} />
      {items === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(u) => u.id}
          contentContainerStyle={items.length === 0 ? styles.center : styles.list}
          ListHeaderComponent={
            items.length > 0 ? (
              <Text style={styles.intro}>
                Blocked people can't see your profile, message or call you. Unblocking doesn't bring back your old
                chat, but you may see each other in Discover again.
              </Text>
            ) : null
          }
          ListEmptyComponent={<Text style={styles.empty}>You haven't blocked anyone.</Text>}
          renderItem={({ item }) => (
            <View style={styles.row} testID={`blocked-${item.id}`}>
              <AvatarPlaceholder name={item.name} size={44} />
              <View style={styles.rowText}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.meta}>{blockedSince(item.blockedAt)}</Text>
              </View>
              <TouchableOpacity
                style={styles.unblockBtn}
                onPress={() => setConfirm(item)}
                accessibilityRole="button"
                accessibilityLabel={`Unblock ${item.name}`}
              >
                <Text style={styles.unblockText}>Unblock</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      )}
      <Dialog
        visible={confirm !== null}
        title={`Unblock ${confirm?.name ?? ""}?`}
        body="They'll be able to see your profile in Discover again. Your previous chat won't come back."
        confirmText="Unblock"
        onConfirm={() => void doUnblock()}
        onCancel={() => setConfirm(null)}
      />
    </SafeAreaView>
  );
}

const createStyles = (Colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
    center: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: Spacing.xl },
    list: { padding: Spacing.lg, gap: Spacing.sm },
    intro: { color: Colors.mutedForeground, fontSize: Typography.sizes.sm, lineHeight: 20, marginBottom: Spacing.md },
    empty: { color: Colors.mutedForeground, fontSize: Typography.sizes.base },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.md,
      padding: Spacing.md,
      borderRadius: Radii.lg,
      backgroundColor: Colors.card,
      borderWidth: 1,
      borderColor: Colors.border,
    },
    rowText: { flex: 1, minWidth: 0 },
    name: { color: Colors.foreground, fontSize: Typography.sizes.base, fontWeight: Typography.weights.semibold },
    meta: { color: Colors.mutedForeground, fontSize: Typography.sizes.xs, marginTop: 2 },
    unblockBtn: {
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.sm,
      borderRadius: Radii.full,
      borderWidth: 1,
      borderColor: Colors.primary,
    },
    unblockText: { color: Colors.primary, fontSize: Typography.sizes.sm, fontWeight: Typography.weights.semibold },
  });
