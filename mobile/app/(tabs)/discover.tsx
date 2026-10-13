import React, { useState, useMemo } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { Alert } from "../../src/utils/alert";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  Bell,
  SlidersHorizontal,
  RotateCcw,
  X,
  Heart,
  Gem,
  Rocket,
  MapPin,
  Crown,
} from "lucide-react-native";
import { Radii, Shadows, Typography, ThemeColors } from "../../src/constants/theme";
import { useTheme } from "../../src/context/ThemeContext";
import { DiscoveryCard } from "../../src/components/discovery/DiscoveryCard";
import { FilterModal } from "../../src/components/discovery/FilterModal";
import { useMilo } from "../../src/context/MiloContext";

export default function DiscoverScreen() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const router = useRouter();
  const {
    currentProfile,
    deck,
    likesRemaining,
    lastPassedId,
    filters,
    loadingDeck,
    isBoosting,
    boostTimeRemaining,
    subscription,
    swipeCard,
    undoPass,
    triggerBoost,
    setFilters,
    refreshDeck,
  } = useMilo();

  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [swiping, setSwiping] = useState(false);

  const handleSwipe = async (dir: "like" | "pass" | "priority") => {
    if (swiping || !currentProfile) return;
    setSwiping(true);
    const targetId = currentProfile.id;
    const res = await swipeCard(dir);
    setSwiping(false);

    if (res.error === "daily_like_limit_reached") {
      Alert.alert(
        "Out of likes",
        "You've reached your free daily like limit. Daily likes reset at midnight IST.",
      );
      return;
    }

    if (res.isMatch) {
      router.push({
        pathname: "/match/[id]",
        params: { id: targetId },
      });
    }
  };

  const handleUndo = async () => {
    const ok = await undoPass();
    if (!ok) {
      Alert.alert("Undo Pass", "No recent pass to undo.");
    }
  };

  const handleBoost = () => {
    if (isBoosting) {
      Alert.alert(
        "Boost Active",
        `Your profile is boosted for another ${boostTimeRemaining} minutes.`,
      );
      return;
    }
    triggerBoost();
    Alert.alert(
      "Boost Activated!",
      "Your profile will be highlighted to more people for 30 minutes.",
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Top Header */}
      <View style={styles.header}>
        <Text style={styles.logoText}>
          mi<Text style={styles.logoAccent}>l</Text>o
        </Text>

        <View style={styles.headerIcons}>
          <TouchableOpacity
            style={styles.iconCircle}
            onPress={() => router.push("/notifications")}
            activeOpacity={0.7}
          >
            <Bell size={20} color={Colors.foreground} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.iconCircle}
            onPress={() => setFilterModalVisible(true)}
            activeOpacity={0.7}
          >
            <SlidersHorizontal size={20} color={Colors.foreground} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Subheader status bar */}
      <TouchableOpacity
        style={styles.statusBar}
        onPress={() => router.push("/premium")}
        activeOpacity={0.8}
      >
        {subscription && subscription.tier !== "free" ? (
          <View style={styles.premiumStatusRow}>
            <Crown size={14} color={Colors.accent} />
            <Text style={styles.premiumStatusText}>
              CHAHAT {subscription.tier.toUpperCase()} · {likesRemaining} likes left today
            </Text>
          </View>
        ) : (
          <Text style={styles.quotaText}>
            {likesRemaining} likes left today · <Text style={styles.upgradeLinkText}>See plans</Text>
          </Text>
        )}
        {isBoosting && (
          <Text style={styles.boostActiveText}>🚀 Boost on ({boostTimeRemaining}m left)</Text>
        )}
      </TouchableOpacity>

      {/* Active Filter Bar if interests/vibes are applied */}
      {filters.interests && filters.interests.length > 0 ? (
        <View style={styles.activeFilterBar}>
          <Text style={styles.activeFilterLabel}>Vibe filter: {filters.interests.join(", ")}</Text>
          <TouchableOpacity
            onPress={() => setFilters((prev) => ({ ...prev, interests: [] }))}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.clearFilterText}>Clear</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Deck Card Area */}
      <View style={styles.cardArea}>
        {loadingDeck ? (
          <ActivityIndicator size="large" color={Colors.primary} />
        ) : currentProfile ? (
          <DiscoveryCard
            profile={currentProfile}
            onPressDetails={() =>
              router.push({
                pathname: "/profile/[id]",
                params: { id: currentProfile.id },
              })
            }
          />
        ) : (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconCircle}>
              <MapPin size={32} color={Colors.primary} />
            </View>
            <Text style={styles.emptyTitle}>No one new right now</Text>
            <Text style={styles.emptySubtitle}>
              Try widening your age, distance or interests in filters, or check back later.
            </Text>
            <TouchableOpacity style={styles.emptyBtn} onPress={() => setFilterModalVisible(true)}>
              <Text style={styles.emptyBtnText}>Adjust filters</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.resetBtn} onPress={refreshDeck}>
              <Text style={styles.resetBtnText}>Refresh deck</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Floating Action Buttons */}
      {currentProfile && (
        <View style={styles.actionRow}>
          {/* Undo Pass */}
          <TouchableOpacity
            onPress={handleUndo}
            disabled={!lastPassedId}
            style={[styles.smallBtn, !lastPassedId && styles.btnDisabled]}
            activeOpacity={0.7}
          >
            <RotateCcw size={20} color={Colors.foreground} />
          </TouchableOpacity>

          {/* Pass */}
          <TouchableOpacity
            onPress={() => handleSwipe("pass")}
            style={styles.mediumBtn}
            activeOpacity={0.7}
          >
            <X size={28} color={Colors.mutedForeground} strokeWidth={2.5} />
          </TouchableOpacity>

          {/* Like */}
          <TouchableOpacity
            onPress={() => handleSwipe("like")}
            style={styles.likeBtn}
            activeOpacity={0.8}
          >
            <Heart size={34} color={Colors.primaryForeground} fill={Colors.primaryForeground} />
          </TouchableOpacity>

          {/* Priority Like */}
          <TouchableOpacity
            onPress={() => handleSwipe("priority")}
            style={styles.smallBtn}
            activeOpacity={0.7}
          >
            <Gem size={20} color={Colors.accent} />
          </TouchableOpacity>

          {/* Boost */}
          <TouchableOpacity
            onPress={handleBoost}
            style={[styles.smallBtn, isBoosting && styles.boostBtnActive]}
            activeOpacity={0.7}
          >
            <Rocket size={20} color={isBoosting ? Colors.primaryForeground : Colors.primary} />
          </TouchableOpacity>
        </View>
      )}

      {/* Filter Modal */}
      <FilterModal
        visible={filterModalVisible}
        filters={filters}
        onClose={() => setFilterModalVisible(false)}
        onApply={(newFilters) => {
          setFilters(newFilters);
          refreshDeck();
        }}
      />
    </SafeAreaView>
  );
}

const createStyles = (Colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
  },
  logoText: {
    fontFamily: Typography.fontDisplay,
    fontSize: 32,
    fontWeight: Typography.weights.bold,
    fontStyle: "italic",
    color: Colors.foreground,
  },
  logoAccent: {
    color: Colors.primary,
  },
  headerIcons: {
    flexDirection: "row",
    gap: 10,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: Radii.full,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  statusBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 6,
  },
  quotaText: {
    fontSize: Typography.sizes.xs,
    color: Colors.mutedForeground,
    fontWeight: Typography.weights.medium,
  },
  upgradeLinkText: {
    color: Colors.primary,
    fontWeight: Typography.weights.bold,
  },
  premiumStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  premiumStatusText: {
    fontSize: Typography.sizes.xs,
    color: Colors.primary,
    fontWeight: Typography.weights.bold,
  },
  boostActiveText: {
    fontSize: Typography.sizes.xs,
    color: Colors.primary,
    fontWeight: Typography.weights.bold,
  },
  activeFilterBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: 20,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: Colors.secondary,
    borderRadius: Radii.full,
  },
  activeFilterLabel: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.semibold,
    color: Colors.foreground,
  },
  clearFilterText: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
    color: Colors.primary,
  },
  cardArea: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  emptyContainer: {
    alignItems: "center",
    paddingHorizontal: 32,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: Radii.full,
    backgroundColor: Colors.secondary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: Typography.sizes.xxl,
    fontWeight: Typography.weights.bold,
    fontFamily: Typography.fontDisplay,
    color: Colors.foreground,
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: Typography.sizes.sm,
    color: Colors.mutedForeground,
    textAlign: "center",
    marginTop: 8,
    lineHeight: 20,
    marginBottom: 20,
  },
  emptyBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: Radii.full,
    ...Shadows.glow,
  },
  emptyBtnText: {
    color: Colors.primaryForeground,
    fontWeight: Typography.weights.bold,
    fontSize: Typography.sizes.base,
  },
  resetBtn: {
    marginTop: 12,
  },
  resetBtnText: {
    color: Colors.mutedForeground,
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.semibold,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingBottom: 16,
  },
  smallBtn: {
    width: 48,
    height: 48,
    borderRadius: Radii.full,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
    ...Shadows.card,
  },
  mediumBtn: {
    width: 60,
    height: 60,
    borderRadius: Radii.full,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
    ...Shadows.card,
  },
  likeBtn: {
    width: 68,
    height: 68,
    borderRadius: Radii.full,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
    ...Shadows.glow,
  },
  btnDisabled: {
    opacity: 0.35,
  },
  boostBtnActive: {
    backgroundColor: Colors.primary,
  },
});
