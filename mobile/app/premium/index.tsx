import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Crown,
  Check,
  Sparkles,
  Zap,
  ShieldCheck,
  CheckCircle2,
  Gem,
  Award,
  Clock,
  Lock,
} from "lucide-react-native";
import { Colors, Radii, Shadows, Typography } from "../../src/constants/theme";
import { Header } from "../../src/components/ui/Header";
import { Button } from "../../src/components/ui/Button";
import { Dialog } from "../../src/components/ui/Dialog";
import { Alert } from "../../src/utils/alert";
import {
  PLANS,
  PREMIUM_BILLING_DURATIONS,
  getUserSubscription,
  type PlanTier,
  type UserSubscription,
} from "../../src/services/subscription";

export default function PremiumScreen() {
  const [selectedTier, setSelectedTier] = useState<PlanTier>("premium");
  const [selectedDuration, setSelectedDuration] = useState<"1m" | "3m" | "6m" | "12m">("1m");
  const [currentSub, setCurrentSub] = useState<UserSubscription | null>(null);
  const [comingSoonVisible, setComingSoonVisible] = useState(false);

  useEffect(() => {
    getUserSubscription().then((sub) => {
      setCurrentSub(sub);
      if (sub.tier !== "free") {
        setSelectedTier(sub.tier);
      }
    });
  }, []);

  const activeDurationObj =
    PREMIUM_BILLING_DURATIONS.find((d) => d.id === selectedDuration) ||
    PREMIUM_BILLING_DURATIONS[0]!;

  return (
    <SafeAreaView style={styles.container}>
      <Header title="CHAHAT Premium" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Hero Branding */}
        <View style={styles.heroBox}>
          <View style={styles.crownCircle}>
            <Crown size={32} color={Colors.accent} />
          </View>
          <Text style={styles.heroTitle}>Milo CHAHAT Club</Text>
          <Text style={styles.heroTagline}>Chaahat · Online Friendship & Meaningful Connections</Text>
          <Text style={styles.heroSubtitle}>
            Unlock unlimited likes, see who liked you, rewind passes, and priority recommendations.
          </Text>

          {currentSub && currentSub.tier !== "free" && (
            <View style={styles.currentActiveBadge}>
              <Award size={14} color={Colors.primaryForeground} />
              <Text style={styles.currentActiveBadgeText}>
                Active: {PLANS[currentSub.tier].name}
              </Text>
            </View>
          )}
        </View>

        {/* Free Plan Safety Guarantee Banner */}
        <View style={styles.safetyGuaranteeBox}>
          <ShieldCheck size={20} color={Colors.success} />
          <View style={styles.safetyGuaranteeContent}>
            <Text style={styles.safetyGuaranteeTitle}>Safety is Always Free</Text>
            <Text style={styles.safetyGuaranteeText}>
              Selfie verification, privacy controls, blocking, and reporting are 100% free for all users.
            </Text>
          </View>
        </View>

        {/* Billing Duration Selector (Approved for Premium only) */}
        {selectedTier === "premium" ? (
          <>
            <Text style={styles.sectionHeading}>1. SELECT PREMIUM DURATION / अवधि चुनें</Text>
            <View style={styles.durationGrid}>
              {PREMIUM_BILLING_DURATIONS.map((dur) => {
                const isSelected = selectedDuration === dur.id;
                return (
                  <TouchableOpacity
                    key={dur.id}
                    style={[styles.durationCard, isSelected && styles.durationCardSelected]}
                    onPress={() => setSelectedDuration(dur.id)}
                    activeOpacity={0.8}
                  >
                    {dur.popular && (
                      <View style={styles.durationBadge}>
                        <Text style={styles.durationBadgeText}>BEST VALUE</Text>
                      </View>
                    )}
                    <Text style={[styles.durationLabel, isSelected && styles.durationLabelSelected]}>
                      {dur.label}
                    </Text>
                    <Text style={[styles.durationPrice, isSelected && styles.durationPriceSelected]}>
                      ₹{dur.totalPrice}
                    </Text>
                    {dur.savings && (
                      <Text
                        style={[
                          styles.durationSavings,
                          isSelected && styles.durationSavingsSelected,
                        ]}
                      >
                        {dur.savings}
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        ) : selectedTier === "plus" || selectedTier === "vip" ? (
          <View style={styles.singleMonthNoteBox}>
            <Text style={styles.singleMonthNoteTitle}>Monthly Plan Pricing</Text>
            <Text style={styles.singleMonthNoteText}>
              {selectedTier === "plus" ? "CHAHAT Plus: ₹199/month" : "CHAHAT VIP: ₹399/month"} (Multi-month packages currently unapproved).
            </Text>
          </View>
        ) : null}

        {/* Plan Tiers Selection */}
        <Text style={styles.sectionHeading}>2. CHOOSE YOUR PLAN / प्लान चुनें</Text>
        <View style={styles.plansContainer}>
          {(["premium", "plus", "vip", "free"] as PlanTier[]).map((tierKey) => {
            const plan = PLANS[tierKey];
            const isSelected = selectedTier === tierKey;
            const isCurrent = currentSub?.tier === tierKey;

            return (
              <TouchableOpacity
                key={tierKey}
                style={[
                  styles.planCard,
                  isSelected && styles.planCardSelected,
                  plan.popular && styles.planCardPopular,
                ]}
                onPress={() => setSelectedTier(tierKey)}
                activeOpacity={0.85}
              >
                {plan.badge && (
                  <View style={styles.planBadge}>
                    <Text style={styles.planBadgeText}>{plan.badge}</Text>
                  </View>
                )}

                <View style={styles.planHeader}>
                  <View style={styles.planTitleCol}>
                    <View style={styles.planNameRow}>
                      <Text style={styles.planName}>{plan.name}</Text>
                      {isCurrent && (
                        <View style={styles.currentPill}>
                          <Text style={styles.currentPillText}>Current</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.planHindi}>{plan.hindiName}</Text>
                    <Text style={styles.planTagline}>{plan.tagline}</Text>
                  </View>

                  <View style={styles.planPriceCol}>
                    <Text style={styles.planPrice}>
                      {plan.monthlyPrice === 0 ? "Free" : `₹${plan.monthlyPrice}`}
                    </Text>
                    {plan.monthlyPrice > 0 && <Text style={styles.planPeriod}>/month</Text>}
                  </View>
                </View>

                {/* Features List */}
                <View style={styles.featuresList}>
                  {plan.features.map((feat, idx) => (
                    <View key={idx} style={styles.featureItem}>
                      <CheckCircle2 size={16} color={Colors.primary} />
                      <Text style={styles.featureText}>{feat}</Text>
                    </View>
                  ))}
                </View>

                {/* Bottom select button */}
                <View style={[styles.selectBtn, isSelected && styles.selectBtnSelected]}>
                  <View
                    style={[
                      styles.radioCircle,
                      isSelected && styles.radioCircleSelected,
                    ]}
                  >
                    {isSelected && <View style={styles.radioDot} />}
                  </View>
                  <Text style={[styles.selectText, isSelected && styles.selectTextSelected]}>
                    {isCurrent ? "Current Plan" : isSelected ? "Selected Plan" : "Choose this plan"}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Action Button Card */}
        <View style={styles.ctaCard}>
          <View style={styles.ctaSummaryRow}>
            <Text style={styles.ctaPlanSummary}>
              {PLANS[selectedTier].name}
              {selectedTier === "premium" ? ` · ${activeDurationObj.label}` : ""}
            </Text>
            <Text style={styles.ctaTotalAmount}>
              ₹
              {selectedTier === "free"
                ? 0
                : selectedTier === "premium"
                  ? activeDurationObj.totalPrice
                  : selectedTier === "plus"
                    ? 199
                    : 399}
            </Text>
          </View>

          {/* T6 Strict Requirement: Say "Coming soon" until server verification exists */}
          {selectedTier === "free" ? (
            <Button
              title="Free Plan Active (10 Likes/Day)"
              onPress={() => {
                Alert.alert(
                  "Free Plan Active",
                  "You have 10 free likes daily, resetting at midnight IST.",
                );
              }}
            />
          ) : (
            <TouchableOpacity
              style={styles.comingSoonCtaBtn}
              onPress={() => setComingSoonVisible(true)}
              activeOpacity={0.8}
            >
              <Lock size={18} color={Colors.primaryForeground} />
              <Text style={styles.comingSoonCtaText}>Coming soon</Text>
            </TouchableOpacity>
          )}

          <View style={styles.comingSoonNoticeBox}>
            <Clock size={14} color={Colors.mutedForeground} />
            <Text style={styles.comingSoonNoticeText}>
              In-app purchases via Google Play Billing are coming soon. Paid tiers require server-side purchase token verification and cannot be granted client-side.
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Coming Soon Dialog */}
      <Dialog
        visible={comingSoonVisible}
        title="Coming Soon"
        body={`Paid subscriptions for ${PLANS[selectedTier].name} are coming soon with Google Play Billing integration and server-side token verification.\n\nAll basic safety, verification, and discovery features remain 100% free.`}
        confirmText="Got it"
        onConfirm={() => setComingSoonVisible(false)}
        onCancel={() => setComingSoonVisible(false)}
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
    padding: 16,
    paddingBottom: 40,
  },
  heroBox: {
    alignItems: "center",
    backgroundColor: Colors.card,
    padding: 20,
    borderRadius: Radii.xxl,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 16,
    ...Shadows.card,
  },
  crownCircle: {
    width: 60,
    height: 60,
    borderRadius: Radii.full,
    backgroundColor: Colors.secondary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  heroTitle: {
    fontSize: Typography.sizes.xl,
    fontWeight: Typography.weights.bold,
    fontFamily: Typography.fontDisplay,
    color: Colors.foreground,
  },
  heroTagline: {
    fontSize: Typography.sizes.xs,
    color: Colors.primary,
    fontWeight: Typography.weights.semibold,
    marginTop: 2,
  },
  heroSubtitle: {
    fontSize: Typography.sizes.xs,
    color: Colors.mutedForeground,
    textAlign: "center",
    marginTop: 6,
    lineHeight: 18,
  },
  currentActiveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: Radii.full,
    marginTop: 10,
  },
  currentActiveBadgeText: {
    color: Colors.primaryForeground,
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
  },
  safetyGuaranteeBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: Colors.secondary,
    padding: 14,
    borderRadius: Radii.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 20,
  },
  safetyGuaranteeContent: {
    flex: 1,
  },
  safetyGuaranteeTitle: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
  },
  safetyGuaranteeText: {
    fontSize: 11,
    color: Colors.mutedForeground,
    marginTop: 2,
    lineHeight: 16,
  },
  sectionHeading: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
    color: Colors.mutedForeground,
    letterSpacing: 0.5,
    marginBottom: 10,
    marginLeft: 4,
  },
  durationGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 24,
  },
  durationCard: {
    flexBasis: "48%",
    flexGrow: 1,
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    padding: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
    position: "relative",
  },
  durationCardSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.card,
  },
  durationBadge: {
    position: "absolute",
    top: -8,
    right: 12,
    backgroundColor: Colors.accent,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radii.full,
  },
  durationBadgeText: {
    fontSize: 9,
    fontWeight: Typography.weights.bold,
    color: "#fff",
  },
  durationLabel: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.medium,
    color: Colors.foreground,
  },
  durationLabelSelected: {
    color: Colors.primary,
    fontWeight: Typography.weights.bold,
  },
  durationPrice: {
    fontSize: Typography.sizes.lg,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
    marginTop: 4,
  },
  durationPriceSelected: {
    color: Colors.primary,
  },
  durationSavings: {
    fontSize: 10,
    color: Colors.success,
    fontWeight: Typography.weights.semibold,
    marginTop: 2,
  },
  durationSavingsSelected: {
    color: Colors.success,
  },
  singleMonthNoteBox: {
    backgroundColor: Colors.card,
    borderRadius: Radii.lg,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 16,
  },
  singleMonthNoteTitle: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
  },
  singleMonthNoteText: {
    fontSize: 11,
    color: Colors.mutedForeground,
    marginTop: 2,
  },
  plansContainer: {
    gap: 16,
    marginBottom: 24,
  },
  planCard: {
    backgroundColor: Colors.card,
    borderRadius: Radii.xxl,
    padding: 18,
    borderWidth: 1.5,
    borderColor: Colors.border,
    position: "relative",
  },
  planCardSelected: {
    borderColor: Colors.primary,
  },
  planCardPopular: {
    borderColor: Colors.accent,
  },
  planBadge: {
    position: "absolute",
    top: -10,
    left: 20,
    backgroundColor: Colors.accent,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: Radii.full,
  },
  planBadgeText: {
    fontSize: 10,
    fontWeight: Typography.weights.bold,
    color: "#fff",
  },
  planHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 14,
  },
  planTitleCol: {
    flex: 1,
  },
  planNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  planName: {
    fontSize: Typography.sizes.lg,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
  },
  currentPill: {
    backgroundColor: Colors.secondary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radii.full,
  },
  currentPillText: {
    fontSize: 9,
    color: Colors.primary,
    fontWeight: Typography.weights.bold,
  },
  planHindi: {
    fontSize: Typography.sizes.xs,
    color: Colors.primary,
    marginTop: 2,
    fontWeight: Typography.weights.medium,
  },
  planTagline: {
    fontSize: Typography.sizes.xs,
    color: Colors.mutedForeground,
    marginTop: 2,
  },
  planPriceCol: {
    alignItems: "flex-end",
  },
  planPrice: {
    fontSize: Typography.sizes.xl,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
  },
  planPeriod: {
    fontSize: Typography.sizes.xs,
    color: Colors.mutedForeground,
  },
  featuresList: {
    gap: 8,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  featureItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  featureText: {
    fontSize: Typography.sizes.xs,
    color: Colors.foreground,
    flex: 1,
    lineHeight: 18,
  },
  selectBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: Radii.lg,
    backgroundColor: Colors.secondary,
  },
  selectBtnSelected: {
    backgroundColor: Colors.primary,
  },
  radioCircle: {
    width: 18,
    height: 18,
    borderRadius: Radii.full,
    borderWidth: 2,
    borderColor: Colors.mutedForeground,
    alignItems: "center",
    justifyContent: "center",
  },
  radioCircleSelected: {
    borderColor: Colors.primaryForeground,
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: Radii.full,
    backgroundColor: Colors.primaryForeground,
  },
  selectText: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.semibold,
    color: Colors.foreground,
  },
  selectTextSelected: {
    color: Colors.primaryForeground,
  },
  ctaCard: {
    backgroundColor: Colors.card,
    borderRadius: Radii.xxl,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12,
    ...Shadows.card,
  },
  ctaSummaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  ctaPlanSummary: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
  },
  ctaTotalAmount: {
    fontSize: Typography.sizes.xl,
    fontWeight: Typography.weights.bold,
    color: Colors.primary,
  },
  comingSoonCtaBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: Radii.full,
  },
  comingSoonCtaText: {
    color: Colors.primaryForeground,
    fontSize: Typography.sizes.base,
    fontWeight: Typography.weights.bold,
  },
  comingSoonNoticeBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginTop: 4,
  },
  comingSoonNoticeText: {
    flex: 1,
    fontSize: 11,
    color: Colors.mutedForeground,
    lineHeight: 16,
  },
});
