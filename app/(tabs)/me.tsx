import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
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
} from "lucide-react-native";
import { Colors, Radii, Shadows, Typography } from "../../src/constants/theme";
import { useAuth } from "../../src/context/AuthContext";
import { calculateAge } from "../../src/services/profile";
import { Dialog } from "../../src/components/ui/Dialog";

export default function MeScreen() {
  const router = useRouter();
  const { profile, signOut } = useAuth();
  const [logoutVisible, setLogoutVisible] = useState(false);

  const mainPhotoUri =
    profile?.photos && profile.photos.length > 0
      ? profile.photos[0]!.uri
      : "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800";

  const age = profile?.dob ? calculateAge(profile.dob) : 25;
  const isVerified = profile?.verificationStatus === "approved";

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
      label: "Get Premium",
      onPress: () => router.push("/premium"),
    },
    {
      icon: BadgeCheck,
      label: isVerified ? "Verified profile" : "Verify your profile",
      onPress: () => router.push("/verification"),
    },
    {
      icon: Sparkles,
      label: "Explore (curated previews)",
      onPress: () => router.push("/explore"),
    },
    {
      icon: Bell,
      label: "Notifications",
      onPress: () => router.push("/notifications"),
    },
    {
      icon: PhoneCall,
      label: "Calls & billing",
      onPress: () => router.push("/calls"),
    },
    {
      icon: Settings,
      label: "Settings & privacy",
      onPress: () => router.push("/settings"),
    },
    {
      icon: ShieldCheck,
      label: "Safety centre",
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
            <Image source={{ uri: mainPhotoUri }} style={styles.avatarImage} contentFit="cover" />
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
              <Text style={styles.unverifiedText}>Photo verification recommended</Text>
            )}
          </View>

          <Text style={styles.cityText}>
            {profile?.city || "Mumbai"} · Profile {pct}% complete
          </Text>
        </View>

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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  profileHeader: {
    alignItems: "center",
    marginBottom: 24,
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
    fontSize: 10,
    fontWeight: Typography.weights.bold,
    color: Colors.primaryForeground,
  },
  profileName: {
    fontSize: Typography.sizes.xxl,
    fontWeight: Typography.weights.bold,
    fontFamily: Typography.fontDisplay,
    color: Colors.foreground,
  },
  badgeRow: {
    marginTop: 4,
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
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
    color: Colors.highlightForeground,
  },
  unverifiedText: {
    fontSize: Typography.sizes.xs,
    color: Colors.mutedForeground,
  },
  cityText: {
    fontSize: Typography.sizes.sm,
    color: Colors.mutedForeground,
    marginTop: 4,
  },
  menuCard: {
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.card,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
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
    fontSize: Typography.sizes.base,
    fontWeight: Typography.weights.medium,
    color: Colors.foreground,
  },
});
