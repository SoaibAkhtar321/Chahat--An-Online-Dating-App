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
  PhoneCall,
  Settings,
  ShieldCheck,
  LogOut,
  ChevronRight,
  HeartHandshake,
  Zap,
} from "lucide-react-native";
import { Radii, Shadows, Typography, ThemeColors } from "../../src/constants/theme";
import { useTheme } from "../../src/context/ThemeContext";
import { useAuth } from "../../src/context/AuthContext";
import { useMilo } from "../../src/context/MiloContext";
import { calculateAge } from "../../src/services/profile";
import { Dialog } from "../../src/components/ui/Dialog";
import { ProfilePhoto } from "../../src/components/profile/ProfilePhoto";

export default function MeScreen() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const router = useRouter();
  const { profile, signOut } = useAuth();
  const { subscription, likesRemaining } = useMilo();
  const [logoutVisible, setLogoutVisible] = useState(false);

  const mainPhotoUri =
    profile?.photos && profile.photos.length > 0 ? profile.photos[0]!.uri : undefined;

  const age = profile?.dob ? calculateAge(profile.dob) : 25;
  const isVerified = profile?.verificationStatus === "approved";
  const planTier = subscription?.tier || "free";

  // Completeness check
  const checks = [
    !!profile?.name,
    !!profile?.dob,
    !!profile?.bio,
    !!profile?.city,
    !!profile?.prompt?.a,
    !!profile?.work || !!profile?.education,
    (profile?.photos?.length || 0) >= 3,
    (profile?.interests?.length || 0) >= 3,
  ];
  const pct = Math.round((checks.filter(Boolean).length / checks.length) * 100);

  const menuItems = [
    {
      icon: Pencil,
      label: "Edit profile & photos",
      onPress: () => router.push("/onboarding"),
    },
    {
      icon: Crown,
      label: planTier === "free" ? "Upgrade to CHAHAT Premium" : `CHAHAT ${subscription?.tier ? subscription.tier.toUpperCase() : ""}`,
      onPress: () => router.push("/premium"),
      badge: planTier === "free" ? "From ₹99" : "Active",
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
      icon: PhoneCall,
      label: "Calls & billing ledger",
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
                {planTier === "free" ? "Free Plan · 20 Likes/Day" : `CHAHAT ${subscription?.tier ? subscription.tier.toUpperCase() : ""}`}
              </Text>
              <Text style={styles.planCardSubtitle}>
                {planTier === "free"
                  ? `${likesRemaining} likes left today · Resets midnight`
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
          await signOut();
          router.replace("/(auth)/welcome");
        }}
        onCancel={() => setLogoutVisible(false)}
      />
    </SafeAreaView>
  );
}

const createStyles = (Colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
    gap: 16,
  },
  profileHeader: {
    alignItems: "center",
    marginBottom: 8,
  },
  avatarWrapper: {
    position: "relative",
    marginBottom: 12,
  },
  avatarImage: {
    width: 100,
    height: 100,
    borderRadius: Radii.full,
    borderWidth: 3,
    borderColor: Colors.primary,
  },
  pctBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    backgroundColor: Colors.primary,
    borderRadius: Radii.full,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 2,
    borderColor: Colors.card,
  },
  pctText: {
    color: Colors.primaryForeground,
    fontSize: 10,
    fontWeight: Typography.weights.bold,
  },
  profileName: {
    fontSize: Typography.sizes.xl,
    fontWeight: Typography.weights.bold,
    fontFamily: Typography.fontDisplay,
    color: Colors.foreground,
  },
  badgeRow: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
  },
  verifiedTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.highlight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radii.full,
  },
  verifiedTagText: {
    color: Colors.highlightForeground,
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
  },
  unverifiedButton: {
    backgroundColor: Colors.secondary,
    paddingHorizontal: 10,
    paddingVertical: 4,
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
    gap: 6,
    backgroundColor: Colors.secondary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radii.full,
    marginTop: 6,
  },
  intentTagText: {
    fontSize: 11,
    color: Colors.foreground,
    fontWeight: Typography.weights.medium,
  },
  cityText: {
    fontSize: Typography.sizes.xs,
    color: Colors.mutedForeground,
    marginTop: 6,
  },
  planCard: {
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    padding: 16,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    ...Shadows.card,
  },
  planCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
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
    marginTop: 2,
  },
  planUpgradeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.primary,
    paddingVertical: 6,
    paddingHorizontal: 12,
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
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12,
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
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radii.full,
  },
  itemBadgeText: {
    fontSize: 10,
    color: Colors.primary,
    fontWeight: Typography.weights.bold,
  },
});
