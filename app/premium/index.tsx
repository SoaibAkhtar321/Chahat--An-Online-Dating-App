import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Crown, Check, Sparkles } from "lucide-react-native";
import { Colors, Radii, Shadows, Typography } from "../../src/constants/theme";
import { Header } from "../../src/components/ui/Header";
import { Button } from "../../src/components/ui/Button";

export default function PremiumScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <Header title="Milo Premium" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.heroBox}>
          <Crown size={40} color={Colors.accent} />
          <Text style={styles.heroTitle}>Upgrade Your Experience</Text>
          <Text style={styles.heroSubtitle}>
            Get more visibility, priority likes, and see who liked your profile.
          </Text>
        </View>

        {/* Free for all MVP notice */}
        <View style={styles.noticeBox}>
          <Sparkles size={20} color={Colors.primary} />
          <Text style={styles.noticeText}>
            Initial MVP Release: Swiping, matching, and unlimited messaging stay 100% free for
            everyone!
          </Text>
        </View>

        {/* Feature comparison cards */}
        <View style={styles.planCard}>
          <Text style={styles.planName}>Free Member</Text>
          <Text style={styles.planPrice}>₹0 / forever</Text>
          <View style={styles.featureList}>
            <Text style={styles.featureItem}>✓ 10 daily likes (resets at midnight IST)</Text>
            <Text style={styles.featureItem}>✓ Unlimited real-time 1-on-1 chats</Text>
            <Text style={styles.featureItem}>✓ Real-time mutual matching</Text>
            <Text style={styles.featureItem}>✓ City-based discovery</Text>
          </View>
        </View>

        <View style={[styles.planCard, styles.planCardFeatured]}>
          <View style={styles.featuredBadge}>
            <Text style={styles.featuredBadgeText}>PREVIEW</Text>
          </View>
          <Text style={styles.planName}>Premium Plus</Text>
          <Text style={styles.planPrice}>Planned for Google Play release</Text>
          <View style={styles.featureList}>
            <Text style={styles.featureItem}>✓ Unlimited daily likes</Text>
            <Text style={styles.featureItem}>✓ See full incoming-likes list</Text>
            <Text style={styles.featureItem}>✓ Undo accidental passes</Text>
            <Text style={styles.featureItem}>✓ 1 Free Profile Boost per week</Text>
            <Text style={styles.featureItem}>✓ 3 Priority Likes per day</Text>
          </View>
        </View>
      </ScrollView>
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
  heroBox: {
    alignItems: "center",
    backgroundColor: Colors.card,
    padding: 24,
    borderRadius: Radii.xxl,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 16,
  },
  heroTitle: {
    fontSize: Typography.sizes.xl,
    fontWeight: Typography.weights.bold,
    fontFamily: Typography.fontDisplay,
    color: Colors.foreground,
    marginTop: 10,
  },
  heroSubtitle: {
    fontSize: Typography.sizes.sm,
    color: Colors.mutedForeground,
    textAlign: "center",
    marginTop: 6,
    lineHeight: 20,
  },
  noticeBox: {
    flexDirection: "row",
    backgroundColor: Colors.secondary,
    padding: 16,
    borderRadius: Radii.lg,
    alignItems: "center",
    gap: 12,
    marginBottom: 20,
  },
  noticeText: {
    flex: 1,
    fontSize: Typography.sizes.sm,
    color: Colors.secondaryForeground,
    lineHeight: 18,
    fontWeight: Typography.weights.medium,
  },
  planCard: {
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 16,
    ...Shadows.card,
  },
  planCardFeatured: {
    borderColor: Colors.primary,
    borderWidth: 2,
    position: "relative",
  },
  featuredBadge: {
    position: "absolute",
    top: 14,
    right: 14,
    backgroundColor: Colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radii.full,
  },
  featuredBadgeText: {
    fontSize: 10,
    fontWeight: Typography.weights.bold,
    color: Colors.primaryForeground,
  },
  planName: {
    fontSize: Typography.sizes.lg,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
  },
  planPrice: {
    fontSize: Typography.sizes.sm,
    color: Colors.mutedForeground,
    marginTop: 2,
    marginBottom: 16,
  },
  featureList: {
    gap: 8,
  },
  featureItem: {
    fontSize: Typography.sizes.sm,
    color: Colors.foreground,
  },
});
