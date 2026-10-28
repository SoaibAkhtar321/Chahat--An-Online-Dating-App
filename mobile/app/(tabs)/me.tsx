import React, { useState, useMemo } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  Pencil,
  Crown,
  BadgeCheck,
  Sparkles,
  Bell,
  Video,
  Settings,
  Share2,
  ShieldCheck,
  LogOut,
  ChevronRight,
  HeartHandshake,
  Zap,
} from "lucide-react-native";
import { Radii, Shadows, Typography, ThemeColors, Spacing } from "../../src/constants/theme";
import { useTheme } from "../../src/context/ThemeContext";
import { useAuth } from "../../src/context/AuthContext";
import { useMilo } from "../../src/context/MiloContext";
import { calculateAge } from "../../src/services/profile";
import { calculateProfileCompleteness } from "../../src/services/profilePolicy";
import { Dialog } from "../../src/components/ui/Dialog";
import { ProfilePhoto } from "../../src/components/profile/ProfilePhoto";
import { ShareProfileSheet } from "../../src/components/profile/ShareProfileSheet";
import { Alert } from "../../src/utils/alert";

export default function MeScreen() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const router = useRouter();
  const { profile, signOut } = useAuth();
  const { subscription, likesRemaining, dailyLikeLimit } = useMilo();
  const [logoutVisible, setLogoutVisible] = useState(false);
  const [shareVisible, setShareVisible] = useState(false);

  const mainPhotoUri =
    profile?.photos && profile.photos.length > 0 ? profile.photos[0]!.uri : undefined;

  const age = profile?.dob ? calculateAge(profile.dob) : 25;
  const isVerified = profile?.verificationStatus === "approved";
  const planTier = subscription?.tier || "free";

  // Authoritative completeness computation
  const completeness = useMemo(() => calculateProfileCompleteness(profile), [profile]);
  const pct = completeness.percentage;

  const menuItems = [
    {
      icon: Pencil,
      label: "Edit profile & photos",
      onPress: () => router.push("/profile/complete"),
      badge: pct < 100 ? `${pct}%` : "100%",
    },
    {
      icon: Share2,
      label: "Share my profile",
      onPress: () => setShareVisible(true),
    },
    {
      icon: Crown,
      label:
        planTier === "free"
          ? "Upgrade to CHAHAT Premium"
          : `CHAHAT ${subscription?.tier ? subscription.tier.toUpperCase() : ""}`,
      onPress: () => router.push("/premium"),
      badge: planTier === "free" ? "See plans" : "Active",
    },
    {
      icon: BadgeCheck,
      label: isVerified ? "Verified profile" : "Verify your profile (Selfie badge)",
      onPress: () => router.push("/verification"),
      badge: isVerified ? "Approved" : "Free",
    },
    {
      icon: Sparkles,
      label: "Explore vibes & daily pick",
      onPress: () => router.push("/explore"),
    },
    {
      icon: Bell,
      label: "Notifications",
      onPress: () => router.push("/notifications"),
    },
    {
      icon: Video,
      label: "Video calls & billing ledger",
      onPress: () => router.push("/calls"),
    },
    {
      icon: Settings,
      label: "Settings & privacy",
      onPress: () => router.push("/settings"),
    },
    {
      icon: ShieldCheck,
      label: "Safety centre & helplines",
      onPress: () => router.push("/safety"),
    },
    {
      icon: LogOut,
      label: "Log out",
      onPress: () => setLogoutVisible(true),
    },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Profile Card Header */}
        <View style={styles.profileHeader}>
          <View style={styles.avatarWrapper}>
            <ProfilePhoto
              uri={mainPhotoUri}
              name={profile?.name || "Your profile"}
              style={styles.avatarImage}
              placeholderSize={56}
            />
            <View style={styles.pctBadge}>
              <Text style={styles.pctText}>{pct}%</Text>
            </View>
          </View>

          <Text style={styles.profileName}>
            {profile?.name || "Your Profile"}
            {age ? `, ${age}` : ""}
          </Text>

          <View style={styles.badgeRow}>
            {isVerified ? (
              <View style={styles.verifiedTag}>
                <BadgeCheck size={14} color={Colors.highlightForeground} />
                <Text style={styles.verifiedTagText}>Verified</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.unverifiedButton}
                onPress={() => router.push("/verification")}
                activeOpacity={0.8}
              >
                <Text style={styles.unverifiedText}>Get Free Verified Badge ✨</Text>
              </TouchableOpacity>
            )}
          </View>

          {profile?.intents && profile.intents.length > 0 ? (
            <View style={styles.intentTag}>
              <HeartHandshake size={12} color={Colors.primary} />
              <Text style={styles.intentTagText}>Looking for: {profile.intents[0]}</Text>
            </View>
          ) : null}

          <Text style={styles.cityText}>
            {profile?.city ? `${profile.city} · ` : ""}Profile {pct}% complete
          </Text>
        </View>

        {/* Complete Profile Callout Banner */}
        {pct < 100 && (
          <TouchableOpacity
            style={styles.completeProfileCard}
            onPress={() => router.push("/profile/complete")}
            activeOpacity={0.85}
          >
            <View style={styles.completeProfileLeft}>
              <View style={styles.completeIconWrap}>
                <Sparkles size={20} color={Colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.completeTitle}>Complete Your Profile ({pct}%)</Text>
                <Text style={styles.completeSubtitle}>
                  Add your bio, interests & lifestyle to get 3x more matches!
                </Text>
                <View style={styles.completeProgressTrack}>
                  <View style={[styles.completeProgressFill, { width: `${pct}%` }]} />
                </View>
              </View>
            </View>
            <View style={styles.completeActionBtn}>
              <Text style={styles.completeActionText}>Continue</Text>
              <ChevronRight size={14} color={Colors.primaryForeground} />
            </View>
          </TouchableOpacity>
        )}

        {/* Subscription / Plan Tier Status Card */}
        <TouchableOpacity
          style={styles.planCard}
          onPress={() => router.push("/premium")}
          activeOpacity={0.85}
        >
          <View style={styles.planCardHeader}>
            <View style={styles.planCardIcon}>
              <Crown size={22} color={planTier === "free" ? Colors.primary : Colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.planCardTitle}>
                {planTier === "free"
                  ? `Free Plan · ${dailyLikeLimit ?? "—"} Likes/Day`
                  : `CHAHAT ${subscription?.tier ? subscription.tier.toUpperCase() : ""}`}
              </Text>
              <Text style={styles.planCardSubtitle}>
                {planTier === "free"
                  ? `${likesRemaining} likes left today · Resets midnight`
                  : likesRemaining < 0
                    ? "Unlimited likes · Active"
                    : `${likesRemaining} likes left today · Active`}
              </Text>
            </View>
            <View style={styles.planUpgradeBtn}>
              <Text style={styles.planUpgradeBtnText}>
                {planTier === "free" ? "Upgrade" : "Manage"}
              </Text>
              <ChevronRight size={14} color={Colors.primaryForeground} />
            </View>
          </View>
        </TouchableOpacity>

        {/* Menu list */}
        <View style={styles.menuCard}>
          {menuItems.map((item, index) => {
            const Icon = item.icon;
            return (
              <TouchableOpacity
                key={index}
                style={[styles.menuItem, index === menuItems.length - 1 && styles.menuItemLast]}
                onPress={item.onPress}
                activeOpacity={0.7}
              >
                <Icon size={20} color={Colors.primary} />
                <Text style={styles.menuLabel}>{item.label}</Text>
                {item.badge ? (
                  <View style={styles.itemBadge}>
                    <Text style={styles.itemBadgeText}>{item.badge}</Text>
                  </View>
                ) : null}
                <ChevronRight size={18} color={Colors.mutedForeground} />
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {/* Logout dialog */}
      <Dialog
        visible={logoutVisible}
        title="Log out?"
        body="Your profile, matches, and chats are safely stored in your account. You can log back in anytime."
        confirmText="Log out"
        danger
        onConfirm={async () => {
          setLogoutVisible(false);
          try {
            await signOut();
            router.replace("/(auth)/welcome");
          } catch (error) {
            Alert.alert(
              "Could not sign out securely",
              error instanceof Error
                ? error.message
                : "Some server cleanup could not be confirmed.",
            );
          }
        }}
        onCancel={() => setLogoutVisible(false)}
      />
      {profile?.id ? (
        <ShareProfileSheet
          visible={shareVisible}
          profileId={profile.id}
          isOwnProfile
          onClose={() => setShareVisible(false)}
        />
      ) : null}
    </SafeAreaView>
  );
}

const createStyles = (Colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: Colors.background,
    },
    content: {
      padding: Spacing.lg,
      paddingBottom: Spacing.xxl,
      gap: Spacing.lg,
    },
    profileHeader: {
      alignItems: "center",
      marginBottom: Spacing.sm,
    },
    avatarWrapper: {
      position: "relative",
      marginBottom: Spacing.md,
    },
    avatarImage: {
      width: 100,
      height: 100,
      borderRadius: Radii.full,
      borderWidth: 3,
      borderColor: Colors.primary,
      overflow: "hidden",
      backgroundColor: Colors.secondary,
    },
    pctBadge: {
      position: "absolute",
      bottom: 0,
      right: 0,
      backgroundColor: Colors.primary,
      borderRadius: Radii.full,
      paddingHorizontal: Spacing.sm,
      paddingVertical: Spacing.xs,
      borderWidth: 2,
      borderColor: Colors.card,
    },
    pctText: {
      color: Colors.primaryForeground,
      fontSize: Typography.sizes.xs,
      fontWeight: Typography.weights.bold,
    },
    profileName: {
      fontSize: Typography.sizes.xl,
      fontWeight: Typography.weights.bold,
      fontFamily: Typography.fontDisplay,
      color: Colors.foreground,
    },
    badgeRow: {
      marginTop: Spacing.sm,
      flexDirection: "row",
      alignItems: "center",
    },
    verifiedTag: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.xs,
      backgroundColor: Colors.highlight,
      paddingHorizontal: Spacing.sm,
      paddingVertical: Spacing.xs,
      borderRadius: Radii.full,
    },
    verifiedTagText: {
      color: Colors.highlightForeground,
      fontSize: Typography.sizes.xs,
      fontWeight: Typography.weights.bold,
    },
    unverifiedButton: {
      backgroundColor: Colors.secondary,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.xs,
      borderRadius: Radii.full,
      borderWidth: 1,
      borderColor: Colors.border,
    },
    unverifiedText: {
      color: Colors.primary,
      fontSize: Typography.sizes.xs,
      fontWeight: Typography.weights.medium,
    },
    intentTag: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.sm,
      backgroundColor: Colors.secondary,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.xs,
      borderRadius: Radii.full,
      marginTop: Spacing.sm,
    },
    intentTagText: {
      fontSize: Typography.sizes.xs,
      color: Colors.foreground,
      fontWeight: Typography.weights.medium,
    },
    cityText: {
      fontSize: Typography.sizes.xs,
      color: Colors.mutedForeground,
      marginTop: Spacing.sm,
    },
    completeProfileCard: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: Colors.card,
      borderRadius: Radii.xl,
      padding: Spacing.lg,
      borderWidth: 1.5,
      borderColor: Colors.accent,
      ...Shadows.card,
    },
    completeProfileLeft: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.md,
      marginRight: Spacing.sm,
    },
    completeIconWrap: {
      width: 40,
      height: 40,
      borderRadius: Radii.full,
      backgroundColor: Colors.secondary,
      alignItems: "center",
      justifyContent: "center",
    },
    completeTitle: {
      fontSize: Typography.sizes.sm,
      fontWeight: Typography.weights.bold,
      color: Colors.foreground,
    },
    completeSubtitle: {
      fontSize: Typography.sizes.xs,
      color: Colors.mutedForeground,
      marginTop: Spacing.xs,
      lineHeight: 15,
    },
    completeProgressTrack: {
      height: 4,
      backgroundColor: Colors.secondary,
      borderRadius: 2,
      overflow: "hidden",
      marginTop: Spacing.sm,
      width: "90%",
    },
    completeProgressFill: {
      height: "100%",
      backgroundColor: Colors.primary,
    },
    completeActionBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.xs,
      backgroundColor: Colors.primary,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      borderRadius: Radii.full,
    },
    completeActionText: {
      fontSize: Typography.sizes.xs,
      fontWeight: Typography.weights.bold,
      color: Colors.primaryForeground,
    },
    planCard: {
      backgroundColor: Colors.card,
      borderRadius: Radii.xl,
      padding: Spacing.lg,
      borderWidth: 1.5,
      borderColor: Colors.primary,
      ...Shadows.card,
    },
    planCardHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.md,
    },
    planCardIcon: {
      width: 42,
      height: 42,
      borderRadius: Radii.full,
      backgroundColor: Colors.secondary,
      alignItems: "center",
      justifyContent: "center",
    },
    planCardTitle: {
      fontSize: Typography.sizes.base,
      fontWeight: Typography.weights.bold,
      color: Colors.foreground,
    },
    planCardSubtitle: {
      fontSize: Typography.sizes.xs,
      color: Colors.mutedForeground,
      marginTop: Spacing.xs,
    },
    planUpgradeBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.xs,
      backgroundColor: Colors.primary,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      borderRadius: Radii.full,
    },
    planUpgradeBtnText: {
      fontSize: Typography.sizes.xs,
      fontWeight: Typography.weights.bold,
      color: Colors.primaryForeground,
    },
    menuCard: {
      backgroundColor: Colors.card,
      borderRadius: Radii.xl,
      borderWidth: 1,
      borderColor: Colors.border,
      overflow: "hidden",
    },
    menuItem: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: Spacing.lg,
      paddingHorizontal: Spacing.lg,
      borderBottomWidth: 1,
      borderBottomColor: Colors.border,
      gap: Spacing.md,
    },
    menuItemLast: {
      borderBottomWidth: 0,
    },
    menuLabel: {
      flex: 1,
      fontSize: Typography.sizes.sm,
      fontWeight: Typography.weights.medium,
      color: Colors.foreground,
    },
    itemBadge: {
      backgroundColor: Colors.secondary,
      paddingHorizontal: Spacing.sm,
      paddingVertical: Spacing.xs,
      borderRadius: Radii.full,
    },
    itemBadgeText: {
      fontSize: Typography.sizes.xs,
      color: Colors.primary,
      fontWeight: Typography.weights.bold,
    },
  });
