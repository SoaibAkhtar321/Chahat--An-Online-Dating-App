import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
} from "react-native";
import { Alert } from "../../src/utils/alert";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
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
import { Layout, Radii, Shadows, Spacing, Typography, ThemeColors } from "../../src/constants/theme";
import { Button } from "../../src/components/ui/Button";
import { useTheme } from "../../src/context/ThemeContext";
import { DiscoveryCard } from "../../src/components/discovery/DiscoveryCard";
import {
  SwipeableCard,
  type SwipeableCardHandle,
  type SwipeAction,
} from "../../src/components/discovery/SwipeableCard";
import { FilterModal } from "../../src/components/discovery/FilterModal";
import { useMilo } from "../../src/context/MiloContext";
import { hasEntitlement } from "../../src/services/subscription";
import { isLocationSharingEnabled } from "../../src/services/location";
import { loadLocationSelection } from "../../src/services/locationSelection";
import { ensureConsent, setConsent } from "../../src/services/consent";
import type { Filters } from "../../src/types";

export default function DiscoverScreen() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const router = useRouter();
  const {
    currentProfile,
    deck,
    likesRemaining,
    dailyLikeLimit,
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
  const [refreshing, setRefreshing] = useState(false);
  const cardRef = useRef<SwipeableCardHandle>(null);
  const [locationSharing, setLocationSharing] = useState(false);

  useEffect(() => {
    isLocationSharingEnabled()
      .then(setLocationSharing)
      .catch((error) => console.warn("Could not load location-sharing status:", error));
  }, []);

  // When the member comes back from the Location screen, reload the deck only if their selection changed.
  const lastSelection = useRef<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void loadLocationSelection().then((selection) => {
        if (!active || !selection) return;
        const signature = `${selection.mode}|${selection.city ?? ""}|${selection.hasLocation}`;
        const previous = lastSelection.current;
        lastSelection.current = signature;
        setLocationSharing(selection.mode === "current");
        if (previous !== null && previous !== signature) void refreshDeck();
      });
      return () => {
        active = false;
      };
    }, [refreshDeck]),
  );

  const toggleLocationSharing = () => {
    if (locationSharing) {
      Alert.alert(
        "Turn off location discovery?",
        "Your stored location will be deleted. You can still discover profiles in your city.",
        [
          { text: "Keep on", style: "cancel" },
          {
            text: "Turn off",
            style: "destructive",
            onPress: async () => {
              // Withdrawing the location choice also deletes the stored location on the server.
              const result = await setConsent("location_discovery", "withdrawn");
              if (!result.success) {
                Alert.alert("Could not update location", result.error ?? "Please try again.");
                return;
              }
              setLocationSharing(false);
              await refreshDeck();
            },
          },
        ],
      );
      return;
    }

    void (async () => {
      // Purpose-specific notice and consent first; detection itself happens on the Location screen, which saves
      // the city and the rounded coordinates together so Discover never sees a mismatched pair.
      if (!(await ensureConsent("location_discovery"))) return;
      router.push("/settings/location");
    })();
  };

  const handleSwipe = async (dir: SwipeAction) => {
    if (swiping || !currentProfile) return;
    setSwiping(true);
    const targetId = currentProfile.id;
    const res = await swipeCard(dir);
    setSwiping(false);

    if (res.error === "daily_like_limit_reached") {
      Alert.alert(
        "Out of likes",
        `You've reached the daily like limit of ${dailyLikeLimit ?? "configured"} likes. Daily likes reset at midnight IST.`,
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

  // Buttons and drags share one path: the card animates away first, then handleSwipe runs.
  const triggerSwipe = (dir: SwipeAction) => {
    const started = cardRef.current?.swipe(dir);
    if (started === undefined) void handleSwipe(dir); // no card mounted to animate
  };

  const handleUndo = async () => {
    if (!hasEntitlement(subscription?.tier || "free", "undoPass")) {
      Alert.alert(
        "Rewind Pass is Premium",
        "Undo last swipe is a CHAHAT Premium feature. Upgrade to rewind any accidental passes.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Upgrade", onPress: () => router.push("/premium") },
        ],
      );
      return;
    }

    const ok = await undoPass();
    if (!ok) {
      Alert.alert("Undo Pass", "No recent pass to undo.");
    }
  };

  const handleBoost = () => {
    if (!hasEntitlement(subscription?.tier || "free", "priorityVisibility")) {
      Alert.alert(
        "Boost is CHAHAT Plus / VIP",
        "Priority Visibility & Boost is available with CHAHAT Plus and VIP. Upgrade to jump to top profiles in your area.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Upgrade", onPress: () => router.push("/premium") },
        ],
      );
      return;
    }

    if (isBoosting) {
      Alert.alert(
        "Boost Active",
        `Your profile is boosted for another ${boostTimeRemaining} minutes.`,
      );
      return;
    }
    if (!triggerBoost()) {
      Alert.alert(
        "Boost unavailable",
        "Boost has not been activated because the server-side boost service is not configured.",
      );
    }
  };

  const handlePullRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshDeck();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Top Header */}
      <View style={styles.header}>
        <Text style={styles.logoText}>CHAHAT</Text>

        <View style={styles.headerIcons}>
          <TouchableOpacity
            style={styles.iconCircle}
            onPress={() => router.push("/notifications")}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Notifications"
          >
            <Bell size={20} color={Colors.foreground} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.iconCircle}
            onPress={toggleLocationSharing}
            activeOpacity={0.7}
            accessibilityLabel={
              locationSharing ? "Turn off location discovery" : "Enable location discovery"
            }
          >
            <MapPin size={20} color={locationSharing ? Colors.primary : Colors.foreground} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.iconCircle}
            onPress={() => setFilterModalVisible(true)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Filters"
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
              CHAHAT {subscription.tier.toUpperCase()} ·{" "}
              {dailyLikeLimit === null
                ? "Like limit unavailable"
                : `${likesRemaining} likes left today`}
            </Text>
          </View>
        ) : (
          <Text style={styles.quotaText}>
            {dailyLikeLimit === null ? (
              "Daily like limit unavailable"
            ) : (
              <>
                {likesRemaining} likes left today ·{" "}
                <Text style={styles.upgradeLinkText}>See plans</Text>
              </>
            )}
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
          <SwipeableCard
            key={currentProfile.id}
            ref={cardRef}
            disabled={swiping}
            onSwipe={handleSwipe}
          >
            <DiscoveryCard
              profile={currentProfile}
              onPressDetails={() =>
                router.push({
                  pathname: "/profile/[id]",
                  params: { id: currentProfile.id },
                })
              }
            />
          </SwipeableCard>
        ) : (
          <ScrollView
            style={styles.emptyScroll}
            contentContainerStyle={styles.emptyContainer}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handlePullRefresh}
                tintColor={Colors.primary}
                colors={[Colors.primary]}
                progressBackgroundColor={Colors.card}
              />
            }
          >
            <View style={styles.emptyIconCircle}>
              <MapPin size={32} color={Colors.primary} />
            </View>
            <Text style={styles.emptyTitle}>No one new right now</Text>
            <Text style={styles.emptySubtitle}>
              You have seen everyone who matches your filters. Widen them, or check back soon as new
              people join.
            </Text>
            <Button
              title="Adjust filters"
              onPress={() => setFilterModalVisible(true)}
              size="lg"
              style={styles.emptyPrimary}
            />
            <View style={styles.emptySecondary}>
              <Button
                title="Refresh"
                variant="text"
                size="sm"
                onPress={handlePullRefresh}
                loading={refreshing}
              />
              <Button
                title="Change location"
                variant="text"
                size="sm"
                onPress={() => router.push("/settings/location")}
              />
            </View>
          </ScrollView>
        )}
      </View>

      {/* Floating Action Buttons */}
      {currentProfile && (
        <View style={styles.actionRow}>
          {/* Undo Pass */}
          <TouchableOpacity
            accessibilityLabel="Undo last pass" onPress={handleUndo}
            disabled={!lastPassedId}
            style={[styles.smallBtn, !lastPassedId && styles.btnDisabled]}
            activeOpacity={0.7}
          >
            <RotateCcw size={20} color={Colors.foreground} />
          </TouchableOpacity>

          {/* Pass */}
          <TouchableOpacity
            onPress={() => triggerSwipe("pass")}
            style={styles.mediumBtn}
            testID="discover-pass-button"
            accessibilityLabel="Pass"
            activeOpacity={0.7}
          >
            <X size={28} color={Colors.mutedForeground} strokeWidth={2.5} />
          </TouchableOpacity>

          {/* Like */}
          <TouchableOpacity
            onPress={() => triggerSwipe("like")}
            style={styles.likeBtn}
            testID="discover-like-button"
            accessibilityLabel="Like"
            activeOpacity={0.8}
          >
            <Heart size={34} color={Colors.primaryForeground} fill={Colors.primaryForeground} />
          </TouchableOpacity>

          {/* Priority Like */}
          <TouchableOpacity
            onPress={() => triggerSwipe("priority")}
            style={styles.smallBtn}
            testID="discover-priority-button"
            accessibilityLabel="Priority like"
            activeOpacity={0.7}
          >
            <Gem size={20} color={Colors.accent} />
          </TouchableOpacity>

          {/* Boost */}
          <TouchableOpacity
            onPress={handleBoost}
            accessibilityLabel="Boost your profile"
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
        onApply={(newFilters: Filters) => {
          setFilters(newFilters);
          refreshDeck();
        }}
      />
    </SafeAreaView>
  );
}

const createStyles = (Colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: Colors.background,
    },
    header: {
      minHeight: 56,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: Layout.screenPadding,
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
      gap: Spacing.sm,
    },
    iconCircle: {
      width: Layout.minTap,
      height: Layout.minTap,
      borderRadius: Radii.full,
      backgroundColor: Colors.card,
      alignItems: "center",
      justifyContent: "center",
    },
    statusBar: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: Layout.screenPadding,
      paddingVertical: Spacing.sm,
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
      gap: Spacing.sm,
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
      marginHorizontal: Layout.screenPadding,
      marginBottom: Spacing.sm,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
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
      paddingHorizontal: Spacing.lg,
      paddingBottom: Spacing.sm,
    },
    emptyScroll: {
      alignSelf: "stretch",
    },
    emptyContainer: {
      flexGrow: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: Spacing.xl,
      paddingVertical: Spacing.xl,
    },
    emptyIconCircle: {
      width: 72,
      height: 72,
      borderRadius: Radii.full,
      backgroundColor: Colors.secondary,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: Spacing.xl,
    },
    emptyTitle: {
      fontSize: Typography.sizes.xxl,
      fontWeight: Typography.weights.bold,
      fontFamily: Typography.fontDisplay,
      color: Colors.foreground,
      textAlign: "center",
    },
    emptySubtitle: {
      fontSize: Typography.sizes.base,
      color: Colors.mutedForeground,
      textAlign: "center",
      marginTop: Spacing.sm,
      lineHeight: 22,
      maxWidth: 320,
    },
    emptyPrimary: {
      alignSelf: "stretch",
      marginTop: Spacing.xxl,
    },
    emptySecondary: {
      alignSelf: "stretch",
      flexDirection: "row",
      justifyContent: "center",
      gap: Spacing.sm,
      marginTop: Spacing.md,
    },
    actionRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: Spacing.md,
      paddingBottom: Spacing.lg,
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
