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
} from "lucide-react-native";
import { Colors, Radii, Shadows, Typography } from "../../src/constants/theme";
import { Header } from "../../src/components/ui/Header";
import { Button } from "../../src/components/ui/Button";
import { Dialog } from "../../src/components/ui/Dialog";
import { Alert } from "../../src/utils/alert";
import {
  PLANS,
  BILLING_DURATIONS,
  getUserSubscription,
  activateSubscription,
  type PlanTier,
  type UserSubscription,
} from "../../src/services/subscription";

export default function PremiumScreen() {
  const [selectedTier, setSelectedTier] = useState<PlanTier>("premium");
  const [selectedDuration, setSelectedDuration] = useState<"1m" | "3m" | "6m" | "12m">("1m");
  const [currentSub, setCurrentSub] = useState<UserSubscription | null>(null);
  const [confirmDialogVisible, setConfirmDialogVisible] = useState(false);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    getUserSubscription().then((sub) => {
      setCurrentSub(sub);
      if (sub.tier !== "free") {
        setSelectedTier(sub.tier);
        setSelectedDuration(sub.duration);
      }
    });
  }, []);

  const handleActivate = async () => {
    setProcessing(true);
    try {
      const updated = await activateSubscription(selectedTier, selectedDuration);
      setCurrentSub(updated);
      setConfirmDialogVisible(false);
      Alert.alert(
        "🎉 Upgrade Successful!",
        `Welcome to ${PLANS[selectedTier].name}! Your premium benefits are now active.`,
      );
    } catch {
      Alert.alert("Subscription error", "Could not complete activation. Please try again.");
    } finally {
      setProcessing(false);
    }
  };

  const activeDurationObj =
    BILLING_DURATIONS.find((d) => d.id === selectedDuration) || BILLING_DURATIONS[0]!;

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
                Active: {PLANS[currentSub.tier].name} ({currentSub.duration})
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
              Selfie verification, privacy controls, blocking, and reporting are free for every single user.
            </Text>
          </View>
        </View>

        {/* Billing Duration Selector */}
        <Text style={styles.sectionHeading}>1. SELECT DURATION / अवधि चुनें</Text>
        <View style={styles.durationGrid}>
          {BILLING_DURATIONS.map((dur) => {
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
                  <Text style={[styles.durationSavings, isSelected && styles.durationSavingsSelected]}>
                    {dur.savings}
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

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
                  <View>
                    <View style={styles.planTitleRow}>
                      <Text style={styles.planName}>{plan.name}</Text>
                      {tierKey === "vip" && <Gem size={16} color={Colors.accent} />}
                      {tierKey === "premium" && <Zap size={16} color={Colors.primary} />}
                    </View>
                    <Text style={styles.planHindi}>{plan.hindiName}</Text>
                  </View>

                  <View style={styles.planPriceWrapper}>
                    <Text style={styles.planPriceNumber}>
                      {plan.monthlyPrice === 0 ? "₹0" : `₹${plan.monthlyPrice}`}
                    </Text>
                    <Text style={styles.planPricePeriod}>
                      {plan.monthlyPrice === 0 ? "/ forever" : "/ महीना"}
                    </Text>
                  </View>
                </View>

                <Text style={styles.planTagline}>{plan.tagline}</Text>

                <View style={styles.featureDivider} />

                <View style={styles.featureList}>
                  {plan.features.map((feat, idx) => (
                    <View key={idx} style={styles.featureItemRow}>
                      <Check
                        size={16}
                        color={isSelected ? Colors.primary : Colors.mutedForeground}
                        strokeWidth={2.5}
                      />
                      <Text style={styles.featureItemText}>{feat}</Text>
                    </View>
                  ))}
                </View>

                <View style={styles.selectRadioRow}>
                  <View style={[styles.radioCircle, isSelected && styles.radioCircleSelected]}>
                    {isSelected && <View style={styles.radioInnerDot} />}
                  </View>
                  <Text style={[styles.selectText, isSelected && styles.selectTextSelected]}>
                    {isCurrent ? "Current Plan" : isSelected ? "Selected Plan" : "Choose this plan"}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Action Button */}
        <View style={styles.ctaCard}>
          <View style={styles.ctaSummaryRow}>
            <Text style={styles.ctaPlanSummary}>
              {PLANS[selectedTier].name} · {activeDurationObj.label}
            </Text>
            <Text style={styles.ctaTotalAmount}>
              ₹
              {selectedTier === "free"
                ? 0
                : selectedTier === "premium"
                  ? activeDurationObj.totalPrice
                  : selectedTier === "plus"
                    ? Math.round(activeDurationObj.totalPrice * 2)
                    : Math.round(activeDurationObj.totalPrice * 4)}
            </Text>
          </View>

          <Button
            title={
              selectedTier === "free"
                ? "Continue with Free Plan"
                : `Upgrade to ${PLANS[selectedTier].name}`
            }
            onPress={() => {
              if (selectedTier === "free") {
                Alert.alert("Free Plan Active", "You are enjoying free matching and chatting!");
              } else {
                setConfirmDialogVisible(true);
              }
            }}
          />

          <Text style={styles.legalNotice}>
            Payment processed securely via Google Play Billing. Auto-renews unless cancelled at least 24 hours before the end of the current period in Play Store Subscriptions.
          </Text>
        </View>
      </ScrollView>

      {/* Confirmation Dialog */}
      <Dialog
        visible={confirmDialogVisible}
        title={`Activate ${PLANS[selectedTier].name}?`}
        body={`You are subscribing for ${activeDurationObj.label}. You will unlock all premium entitlements immediately.`}
        confirmText={processing ? "Activating…" : "Confirm Subscription"}
        cancelText="Cancel"
        onConfirm={handleActivate}
        onCancel={() => setConfirmDialogVisible(false)}
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
    marginBottom: 6,
  },
  heroSubtitle: {
    fontSize: Typography.sizes.xs,
    color: Colors.mutedForeground,
    textAlign: "center",
    lineHeight: 18,
  },
  currentActiveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.success,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: Radii.full,
    marginTop: 12,
  },
  currentActiveBadgeText: {
    fontSize: 11,
    fontWeight: Typography.weights.bold,
    color: Colors.primaryForeground,
  },
  safetyGuaranteeBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.secondary,
    padding: 14,
    borderRadius: Radii.xl,
    gap: 12,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  safetyGuaranteeContent: {
    flex: 1,
  },
  safetyGuaranteeTitle: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
  },
  safetyGuaranteeText: {
    fontSize: Typography.sizes.xs,
    color: Colors.mutedForeground,
    marginTop: 2,
    lineHeight: 16,
  },
  sectionHeading: {
    fontSize: 12,
    fontWeight: Typography.weights.bold,
    color: Colors.mutedForeground,
    letterSpacing: 0.5,
    marginBottom: 10,
    marginTop: 6,
  },
  durationGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 20,
  },
  durationCard: {
    width: "48%",
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    padding: 12,
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
    right: 8,
    backgroundColor: Colors.accent,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radii.full,
  },
  durationBadgeText: {
    fontSize: 9,
    fontWeight: Typography.weights.bold,
    color: Colors.accentForeground,
  },
  durationLabel: {
    fontSize: 11,
    fontWeight: Typography.weights.medium,
    color: Colors.mutedForeground,
  },
  durationLabelSelected: {
    color: Colors.foreground,
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
  plansContainer: {
    gap: 14,
    marginBottom: 20,
  },
  planCard: {
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    padding: 16,
    borderWidth: 1.5,
    borderColor: Colors.border,
    ...Shadows.card,
  },
  planCardSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.card,
  },
  planCardPopular: {
    position: "relative",
  },
  planBadge: {
    position: "absolute",
    top: -10,
    right: 14,
    backgroundColor: Colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: Radii.full,
  },
  planBadgeText: {
    fontSize: 10,
    fontWeight: Typography.weights.bold,
    color: Colors.primaryForeground,
  },
  planHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  planTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  planName: {
    fontSize: Typography.sizes.base,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
  },
  planHindi: {
    fontSize: 11,
    color: Colors.mutedForeground,
    marginTop: 2,
  },
  planPriceWrapper: {
    alignItems: "flex-end",
  },
  planPriceNumber: {
    fontSize: Typography.sizes.xl,
    fontWeight: Typography.weights.bold,
    color: Colors.primary,
  },
  planPricePeriod: {
    fontSize: 10,
    color: Colors.mutedForeground,
  },
  planTagline: {
    fontSize: Typography.sizes.xs,
    color: Colors.mutedForeground,
    marginTop: 4,
  },
  featureDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 12,
  },
  featureList: {
    gap: 8,
  },
  featureItemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  featureItemText: {
    fontSize: Typography.sizes.xs,
    color: Colors.foreground,
    flex: 1,
    lineHeight: 16,
  },
  selectRadioRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  radioCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: Colors.mutedForeground,
    alignItems: "center",
    justifyContent: "center",
  },
  radioCircleSelected: {
    borderColor: Colors.primary,
  },
  radioInnerDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.primary,
  },
  selectText: {
    fontSize: Typography.sizes.xs,
    color: Colors.mutedForeground,
    fontWeight: Typography.weights.medium,
  },
  selectTextSelected: {
    color: Colors.primary,
    fontWeight: Typography.weights.bold,
  },
  ctaCard: {
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  ctaSummaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  ctaPlanSummary: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.semibold,
    color: Colors.foreground,
  },
  ctaTotalAmount: {
    fontSize: Typography.sizes.xl,
    fontWeight: Typography.weights.bold,
    color: Colors.primary,
  },
  legalNotice: {
    fontSize: 10,
    color: Colors.mutedForeground,
    textAlign: "center",
    marginTop: 10,
    lineHeight: 14,
  },
});
