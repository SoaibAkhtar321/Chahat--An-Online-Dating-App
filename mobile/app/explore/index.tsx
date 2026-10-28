import React, { useState, useMemo } from "react";
import { VERIFICATION_ENABLED } from "../../src/constants/features";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  Compass,
  Coffee,
  Mountain,
  BookOpen,
  Music,
  Camera,
  Film,
  Dumbbell,
  Sparkles,
  Trophy,
  Flame,
  BadgeCheck,
  ChevronRight,
} from "lucide-react-native";
import { Radii, Shadows, Typography, ThemeColors, Spacing } from "../../src/constants/theme";
import { useTheme } from "../../src/context/ThemeContext";
import { ProfilePhoto } from "../../src/components/profile/ProfilePhoto";
import { Header } from "../../src/components/ui/Header";
import { useMilo } from "../../src/context/MiloContext";

const COMMUNITIES = [
  {
    id: "bollywood",
    title: "Bollywood & Cinema 🎬",
    desc: "Late-night movies, classic 90s dialogues & popcorn dates",
    icon: Film,
    interests: ["Bollywood", "Movies", "Music"],
    members: "14.2k active",
  },
  {
    id: "chai",
    title: "Chai & Deep Talks ☕",
    desc: "Tapri chai lovers, cafe hoppers & thoughtful conversations",
    icon: Coffee,
    interests: ["Coffee", "Foodie"],
    members: "28.5k active",
  },
  {
    id: "trekkers",
    title: "Weekend Trekkers 🏔️",
    desc: "Monsoon treks, road trips & mountain sunrises",
    icon: Mountain,
    interests: ["Hiking", "Travel", "Yoga"],
    members: "19.8k active",
  },
  {
    id: "music",
    title: "Concerts & Indie Gigs 🎶",
    desc: "Arijit Singh, Prateek Kuhad & live acoustic rooftop sessions",
    icon: Music,
    interests: ["Music", "Bollywood"],
    members: "22.1k active",
  },
  {
    id: "fitness",
    title: "Gym & Active Living 💪",
    desc: "Morning runs, workout partners & healthy living",
    icon: Dumbbell,
    interests: ["Fitness", "Yoga"],
    members: "11.3k active",
  },
  {
    id: "readers",
    title: "Book Nooks & Poetry 📖",
    desc: "Fiction, Urdu poetry, cozy bookstores & rainy day reads",
    icon: BookOpen,
    interests: ["Books", "Art"],
    members: "9.7k active",
  },
  {
    id: "photo",
    title: "Visual Creators & Art 📷",
    desc: "Street photography, art exhibits & aesthetics",
    icon: Camera,
    interests: ["Photography", "Art"],
    members: "8.4k active",
  },
];

export default function ExploreScreen() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const router = useRouter();
  const { setFilters, deck } = useMilo();

  // Daily pick from real deck
  const dailyPick = deck && deck.length > 0 ? deck[0] : null;

  const handleSelectTopic = (interests: string[]) => {
    setFilters((prev: any) => ({
      ...prev,
      interests,
    }));
    router.push("/(tabs)/discover");
  };

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Explore & Vibes" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Daily Match & Daily Surprise Highlight */}
        <View style={styles.dailySection}>
          <View style={styles.sectionTitleRow}>
            <Sparkles size={18} color={Colors.accent} />
            <Text style={styles.sectionHeading}>Daily Recommended Match</Text>
          </View>
          <Text style={styles.sectionSubtitle}>
            Hand-picked profile matching your lifestyle & relationship intention for today.
          </Text>

          {dailyPick ? (
            <TouchableOpacity
              style={styles.dailyCard}
              onPress={() =>
                router.push({
                  pathname: "/profile/[id]",
                  params: { id: dailyPick.id },
                })
              }
              activeOpacity={0.85}
            >
              <ProfilePhoto
                uri={dailyPick.photos?.[0]}
                name={dailyPick.name}
                style={styles.dailyPhoto}
                placeholderSize={90}
              />
              <View style={styles.dailyCardOverlay}>
                <View style={styles.dailyBadge}>
                  <Flame size={12} color="#fff" />
                  <Text style={styles.dailyBadgeText}>Today's Featured Match</Text>
                </View>
                <View style={styles.dailyNameRow}>
                  <Text style={styles.dailyName}>
                    {dailyPick.name}, {dailyPick.age}
                  </Text>
                  {VERIFICATION_ENABLED && (dailyPick.isVerified || dailyPick.verificationStatus === "approved") && (
                    <BadgeCheck size={18} color={Colors.accent} fill={Colors.accent} />
                  )}
                </View>
                <Text style={styles.dailyCity}>
                  {dailyPick.city ? `${dailyPick.city} · ` : ""}Looking for {dailyPick.intent || "meaningful connection"}
                </Text>
              </View>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.dailyCard, { backgroundColor: Colors.card, justifyContent: "center", alignItems: "center", padding: 24 }]}
              onPress={() => router.push("/(tabs)/discover")}
              activeOpacity={0.8}
            >
              <Compass size={32} color={Colors.primary} />
              <Text style={[styles.dailyName, { color: Colors.foreground, marginTop: 12, textAlign: "center" }]}>
                Discover New Profiles
              </Text>
              <Text style={{ fontSize: Typography.sizes.sm, color: Colors.mutedForeground, marginTop: 4, textAlign: "center" }}>
                Keep exploring your discovery feed to find new people near you.
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Daily Icebreaker Challenge */}
        <View style={styles.challengeCard}>
          <View style={styles.challengeHeader}>
            <View style={styles.challengeIconCircle}>
              <Trophy size={18} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.challengeTitle}>Today's Icebreaker Prompt</Text>
              <Text style={styles.challengeSub}>Answer to unlock curated recommendations</Text>
            </View>
          </View>
          <Text style={styles.challengePrompt}>
            “Aapki favorite monsoon memory ya favorite road-trip soundtrack kaunsi hai?”
          </Text>
          <TouchableOpacity
            style={styles.challengeBtn}
            onPress={() => router.push("/(tabs)/discover")}
            activeOpacity={0.8}
          >
            <Text style={styles.challengeBtnText}>Explore Matches Who Answered</Text>
            <ChevronRight size={16} color={Colors.primaryForeground} />
          </TouchableOpacity>
        </View>

        {/* Interest Communities */}
        <View style={styles.communitiesSection}>
          <View style={styles.sectionTitleRow}>
            <Compass size={18} color={Colors.primary} />
            <Text style={styles.sectionHeading}>Interest Communities</Text>
          </View>
          <Text style={styles.sectionSubtitle}>
            Connect with people who share your exact hobbies, taste, and lifestyle.
          </Text>

          <View style={styles.communityGrid}>
            {COMMUNITIES.map((item) => {
              const Icon = item.icon;
              return (
                <TouchableOpacity
                  key={item.id}
                  style={styles.communityCard}
                  onPress={() => handleSelectTopic(item.interests)}
                  activeOpacity={0.7}
                >
                  <View style={styles.communityTop}>
                    <View style={styles.iconCircle}>
                      <Icon size={22} color={Colors.primary} />
                    </View>
                    <Text style={styles.membersCount}>{item.members}</Text>
                  </View>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  <Text style={styles.cardDesc}>{item.desc}</Text>
                  <View style={styles.filterChipRow}>
                    {item.interests.map((tag) => (
                      <View key={tag} style={styles.tagPill}>
                        <Text style={styles.tagText}>#{tag}</Text>
                      </View>
                    ))}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (Colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
    gap: Spacing.lg,
  },
  dailySection: {
    gap: Spacing.sm,
  },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  sectionHeading: {
    fontSize: Typography.sizes.lg,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
  },
  sectionSubtitle: {
    fontSize: Typography.sizes.xs,
    color: Colors.mutedForeground,
    lineHeight: 18,
  },
  dailyCard: {
    height: 240,
    borderRadius: Radii.xxl,
    overflow: "hidden",
    position: "relative",
    marginTop: Spacing.sm,
    ...Shadows.card,
  },
  dailyPhoto: {
    width: "100%",
    height: "100%",
  },
  dailyCardOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.65)",
    padding: Spacing.lg,
    gap: Spacing.xs,
  },
  dailyBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Radii.full,
    alignSelf: "flex-start",
    marginBottom: Spacing.xs,
  },
  dailyBadgeText: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
    color: "#fff",
  },
  dailyNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  dailyName: {
    fontSize: Typography.sizes.lg,
    fontWeight: Typography.weights.bold,
    color: "#fff",
  },
  dailyCity: {
    fontSize: Typography.sizes.xs,
    color: "rgba(255,255,255,0.85)",
  },
  challengeCard: {
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: Spacing.md,
  },
  challengeHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  challengeIconCircle: {
    width: 38,
    height: 38,
    borderRadius: Radii.full,
    backgroundColor: Colors.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  challengeTitle: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
  },
  challengeSub: {
    fontSize: Typography.sizes.xs,
    color: Colors.mutedForeground,
  },
  challengePrompt: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.medium,
    fontStyle: "italic",
    color: Colors.foreground,
    backgroundColor: Colors.secondary,
    padding: Spacing.md,
    borderRadius: Radii.md,
    lineHeight: 20,
  },
  challengeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radii.full,
  },
  challengeBtnText: {
    color: Colors.primaryForeground,
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.semibold,
  },
  communitiesSection: {
    gap: Spacing.sm,
  },
  communityGrid: {
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  communityCard: {
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: Spacing.sm,
  },
  communityTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: Radii.full,
    backgroundColor: Colors.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  membersCount: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.medium,
    color: Colors.mutedForeground,
  },
  cardTitle: {
    fontSize: Typography.sizes.base,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
  },
  cardDesc: {
    fontSize: Typography.sizes.xs,
    color: Colors.mutedForeground,
    lineHeight: 18,
  },
  filterChipRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  tagPill: {
    backgroundColor: Colors.secondary,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Radii.sm,
  },
  tagText: {
    fontSize: Typography.sizes.xs,
    color: Colors.primary,
    fontWeight: Typography.weights.medium,
  },
});
