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
  Lock,
  ArrowRight,
  RefreshCw,
  Info,
} from "lucide-react-native";
import { Radii, Shadows, Typography } from "../../src/constants/theme";
import { useTheme } from "../../src/context/ThemeContext";
import { Header } from "../../src/components/ui/Header";
import { Button } from "../../src/components/ui/Button";
import { Alert } from "../../src/utils/alert";
import {
  PLANS,
  PREMIUM_BILLING_DURATIONS,
  PLAY_PRODUCT_IDS,
  BILLING_ENABLED,
  getUserSubscription,
  listenForPurchaseUpdates,
  loadPlayBillingCatalog,
  purchaseSubscription,
  restorePurchases,
  type PlanTier,
  type PlayBillingProduct,
  type UserSubscription,
} from "../../src/services/subscription";

export default function PremiumScreen() {
  const { colors, isDark } = useTheme();
  const [selectedTier, setSelectedTier] = useState<PlanTier>("premium");
  const [selectedDuration, setSelectedDuration] = useState<"1m" | "3m" | "6m" | "12m">("1m");
  const [currentSub, setCurrentSub] = useState<UserSubscription | null>(null);
  const [processing, setProcessing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [billingProducts, setBillingProducts] = useState<PlayBillingProduct[]>([]);

  useEffect(() => {
    let active = true;
    let removePurchaseListeners: (() => void) | undefined;
    void getUserSubscription().then((sub) => {
      if (!active) return;
      setCurrentSub(sub);
      if (sub.tier !== "free") setSelectedTier(sub.tier);
    });
    if (BILLING_ENABLED) {
      void loadPlayBillingCatalog()
        .then((products) => {
          if (active) setBillingProducts(products);
        })
        .catch((error) => console.warn("Google Play product catalog unavailable:", error));
      void listenForPurchaseUpdates((event) => {
        if (!active) return;
        setProcessing(false);
        if (event.status === "completed") {
          void getUserSubscription().then(setCurrentSub);
          Alert.alert(
            "Subscription verified",
            event.warning
              ? `${PLANS[event.tier].name} is active. ${event.warning}`
              : `${PLANS[event.tier].name} is active.`,
          );
        } else if (event.status === "pending") {
          Alert.alert("Payment pending", event.message);
        } else if (event.status === "failed") {
          Alert.alert("Purchase not verified", event.error);
        }
      })
        .then((remove) => {
          if (active) removePurchaseListeners = remove;
          else remove();
        })
        .catch((error) => console.warn("Google Play purchase listener unavailable:", error));
    }
    return () => {
      active = false;
      removePurchaseListeners?.();
    };
  }, []);

  const productPrice = (productId: string) =>
    billingProducts.find((product) => product.productId === productId)?.localizedPrice ??
    (BILLING_ENABLED ? "Price unavailable" : "Google Play price");
  const tierProductId =
    selectedTier === "premium"
      ? PLAY_PRODUCT_IDS.premium["1m"]
      : selectedTier === "plus"
        ? PLAY_PRODUCT_IDS.plus["1m"]
        : selectedTier === "vip"
          ? PLAY_PRODUCT_IDS.vip["1m"]
          : null;

  const activeDurationObj =
    PREMIUM_BILLING_DURATIONS.find((d) => d.id === selectedDuration) ||
    PREMIUM_BILLING_DURATIONS[0]!;

  const handleSelectOrPurchase = async () => {
    if (selectedTier === "free") {
      Alert.alert(
        "Free Plan Active / मुफ़्त प्लान सक्रिय",
        "You have 20 free likes daily resetting at midnight IST, with basic chat and free identity verification.",
      );
      return;
    }

    setProcessing(true);
    const result = await purchaseSubscription(selectedTier, selectedDuration);
    setProcessing(false);

    if (result.success) {
      Alert.alert("Success", "Your subscription is active!");
      const updated = await getUserSubscription();
      setCurrentSub(updated);
    } else {
      if (result.status === "pending") {
        Alert.alert("Google Play purchase", result.error || "Waiting for Google Play.");
        return;
      }
      Alert.alert(
        "Google Play Billing",
        result.error ||
          "Google Play payment sheet is connecting. Server verification is mandatory for tier upgrades.",
      );
    }
  };

  const handleRestore = async () => {
    setRestoring(true);
    const res = await restorePurchases();
    setRestoring(false);

    if (res.success && res.tier) {
      Alert.alert("Purchases Restored", `Your ${PLANS[res.tier].name} subscription was restored.`);
      const updated = await getUserSubscription();
      setCurrentSub(updated);
    } else {
      Alert.alert("Restore Purchases", res.error || "No active purchases found to restore.");
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <Header title="CHAHAT Premium" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {!BILLING_ENABLED && (
          <View style={[styles.singleMonthNoteBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.singleMonthNoteText, { color: colors.mutedForeground }]}>
              Google Play checkout is disabled in this build. Displayed reference pricing is not a live price or charge.
            </Text>
          </View>
        )}
        {/* Hero Branding */}
        <View style={[styles.heroBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.crownCircle, { backgroundColor: colors.secondary }]}>
            <Crown size={32} color={colors.accent} />
          </View>
          <Text style={[styles.heroTitle, { color: colors.foreground }]}>Chahat Premium Club</Text>
          <Text style={[styles.heroTagline, { color: colors.primary }]}>
            Chahat · Online Friendship & Meaningful Connections
          </Text>
          <Text style={[styles.heroSubtitle, { color: colors.mutedForeground }]}>
            Unlock unlimited likes, see who liked you, rewind passes, and priority recommendations.
          </Text>

          {currentSub && currentSub.tier !== "free" && (
            <View style={[styles.currentActiveBadge, { backgroundColor: colors.primary }]}>
              <Award size={14} color={colors.primaryForeground} />
              <Text style={[styles.currentActiveBadgeText, { color: colors.primaryForeground }]}>
                Active: {PLANS[currentSub.tier].name}
              </Text>
            </View>
          )}
        </View>

        {/* Free Plan Safety Guarantee Banner */}
        <View style={[styles.safetyGuaranteeBox, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
          <ShieldCheck size={20} color={colors.success} />
          <View style={styles.safetyGuaranteeContent}>
            <Text style={[styles.safetyGuaranteeTitle, { color: colors.foreground }]}>Safety is Always Free</Text>
            <Text style={[styles.safetyGuaranteeText, { color: colors.mutedForeground }]}>
              Selfie verification, privacy controls, blocking, and reporting are 100% free for all users on Chahat.
            </Text>
          </View>
        </View>

        {/* What You Get With Each Plan Section (Preserving Hindi headings & text) */}
        <Text style={[styles.sectionHeading, { color: colors.mutedForeground }]}>
          WHAT YOU GET WITH EACH PLAN / प्रत्येक प्लान में क्या मिलता है
        </Text>

        <View style={[styles.comparisonCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.matrixHeaderRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.matrixColFeature, { color: colors.mutedForeground }]}>Feature / सुविधा</Text>
            <Text style={[styles.matrixColPlan, { color: colors.foreground }]}>Free</Text>
            <Text style={[styles.matrixColPlan, { color: colors.primary, fontWeight: Typography.weights.bold }]}>Prem</Text>
            <Text style={[styles.matrixColPlan, { color: colors.accent, fontWeight: Typography.weights.bold }]}>Plus</Text>
            <Text style={[styles.matrixColPlan, { color: colors.primary, fontWeight: Typography.weights.bold }]}>VIP</Text>
          </View>

          {[
            { name: "Daily Likes (प्रतिदिन लाइक्स)", free: "20 / day", prem: "20 / day", plus: "20 / day", vip: "20 / day" },
            { name: "See Who Liked You (किसने Like किया)", free: "—", prem: "✓", plus: "✓", vip: "✓" },
            { name: "Rewind Pass (अनडू स्वाइप)", free: "—", prem: "✓", plus: "✓", vip: "✓" },
            { name: "Smart Icebreakers (बातचीत की शुरुआत)", free: "—", prem: "✓", plus: "✓", vip: "✓" },
            { name: "Read Receipts (मैसेज सीन)", free: "—", prem: "—", plus: "✓", vip: "✓" },
            { name: "Priority Recommendations (प्राथमिकता)", free: "—", prem: "—", plus: "✓", vip: "✓" },
            { name: "Incognito Mode (पूर्ण गोपनीयता)", free: "—", prem: "—", plus: "—", vip: "✓" },
            { name: "Profile Verification Badge", free: "मुफ़्त (Free)", prem: "मुफ़्त", plus: "मुफ़्त", vip: "मुफ़्त" },
            { name: "Safety, Block & Report", free: "मुफ़्त (Free)", prem: "मुफ़्त", plus: "मुफ़्त", vip: "मुफ़्त" },
          ].map((row, idx) => (
            <View key={idx} style={[styles.matrixRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.matrixRowLabel, { color: colors.foreground }]}>{row.name}</Text>
              <Text style={[styles.matrixRowCell, { color: colors.mutedForeground }]}>{row.free}</Text>
              <Text style={[styles.matrixRowCell, { color: colors.primary, fontWeight: Typography.weights.semibold }]}>{row.prem}</Text>
              <Text style={[styles.matrixRowCell, { color: colors.accent, fontWeight: Typography.weights.semibold }]}>{row.plus}</Text>
              <Text style={[styles.matrixRowCell, { color: colors.foreground, fontWeight: Typography.weights.bold }]}>{row.vip}</Text>
            </View>
          ))}
        </View>

        {/* Billing Duration Selector (Approved for Premium only) */}
        {selectedTier === "premium" ? (
          <>
            <Text style={[styles.sectionHeading, { color: colors.mutedForeground, marginTop: 24 }]}>
              1. SELECT PREMIUM DURATION / अवधि चुनें
            </Text>
            <View style={styles.durationGrid}>
              {PREMIUM_BILLING_DURATIONS.map((dur) => {
                const isSelected = selectedDuration === dur.id;
                const productId = PLAY_PRODUCT_IDS.premium[dur.id];
                return (
                  <TouchableOpacity
                    key={dur.id}
                    style={[
                      styles.durationCard,
                      { backgroundColor: colors.card, borderColor: isSelected ? colors.primary : colors.border },
                    ]}
                    onPress={() => setSelectedDuration(dur.id)}
                    activeOpacity={0.8}
                  >
                    {dur.popular && (
                      <View style={[styles.durationBadge, { backgroundColor: colors.accent }]}>
                        <Text style={styles.durationBadgeText}>BEST VALUE</Text>
                      </View>
                    )}
                    <Text
                      style={[
                        styles.durationLabel,
                        { color: isSelected ? colors.primary : colors.foreground },
                        isSelected && { fontWeight: Typography.weights.bold },
                      ]}
                    >
                      {dur.label}
                    </Text>
                    <Text
                      style={[
                        styles.durationPrice,
                        { color: isSelected ? colors.primary : colors.foreground },
                      ]}
                    >
                      {productPrice(productId)}
                    </Text>
                    {dur.savings && (
                      <Text style={[styles.durationSavings, { color: colors.success }]}>
                        {dur.savings}
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        ) : selectedTier === "plus" || selectedTier === "vip" ? (
          <View style={[styles.singleMonthNoteBox, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 24 }]}>
            <Text style={[styles.singleMonthNoteTitle, { color: colors.foreground }]}>Monthly Plan Pricing</Text>
            <Text style={[styles.singleMonthNoteText, { color: colors.mutedForeground }]}>
              {selectedTier === "plus" ? "CHAHAT Plus: ₹199/month" : "CHAHAT VIP: ₹399/month"}
            </Text>
          </View>
        ) : null}

        {/* Plan Tiers Selection */}
        <Text style={[styles.sectionHeading, { color: colors.mutedForeground, marginTop: selectedTier === "free" ? 24 : 12 }]}>
          2. CHOOSE YOUR PLAN / प्लान चुनें
        </Text>
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
                  {
                    backgroundColor: colors.card,
                    borderColor: isSelected ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => setSelectedTier(tierKey)}
                activeOpacity={0.85}
              >
                {plan.badge && (
                  <View style={[styles.planBadge, { backgroundColor: colors.primary }]}>
                    <Text style={styles.planBadgeText}>{plan.badge}</Text>
                  </View>
                )}

                <View style={styles.planHeader}>
                  <View style={styles.planTitleCol}>
                    <View style={styles.planNameRow}>
                      <Text style={[styles.planName, { color: colors.foreground }]}>{plan.name}</Text>
                      {isCurrent && (
                        <View style={[styles.currentPill, { backgroundColor: colors.secondary }]}>
                          <Text style={[styles.currentPillText, { color: colors.primary }]}>Current</Text>
                        </View>
                      )}
                    </View>
                    <Text style={[styles.planHindi, { color: colors.primary }]}>{plan.hindiName}</Text>
                    <Text style={[styles.planTagline, { color: colors.mutedForeground }]}>{plan.tagline}</Text>
                  </View>

                  <View style={styles.planPriceCol}>
                    <Text style={[styles.planPrice, { color: colors.foreground }]}>
                      {plan.monthlyPrice === 0 ? "Free" : productPrice(tierProductId ?? "")}
                    </Text>
                    {plan.monthlyPrice > 0 && (
                      <Text style={[styles.planPeriod, { color: colors.mutedForeground }]}>/month</Text>
                    )}
                  </View>
                </View>

                {/* Features List */}
                <View style={styles.featuresList}>
                  {plan.features.map((feat, idx) => (
                    <View key={idx} style={styles.featureItem}>
                      <CheckCircle2 size={16} color={colors.primary} />
                      <Text style={[styles.featureText, { color: colors.foreground }]}>{feat}</Text>
                    </View>
                  ))}
                </View>

                {/* Bottom select button */}
                <View
                  style={[
                    styles.selectBtn,
                    {
                      backgroundColor: isSelected ? colors.primary : colors.secondary,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.radioCircle,
                      {
                        borderColor: isSelected ? colors.primaryForeground : colors.border,
                      },
                    ]}
                  >
                    {isSelected && (
                      <View style={[styles.radioDot, { backgroundColor: colors.primaryForeground }]} />
                    )}
                  </View>
                  <Text
                    style={[
                      styles.selectText,
                      {
                        color: isSelected ? colors.primaryForeground : colors.foreground,
                      },
                    ]}
                  >
                    {isCurrent ? "Current Plan" : isSelected ? "Selected Plan" : "Choose this plan"}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Action Button Card */}
        <View style={[styles.ctaCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.ctaSummaryRow}>
            <Text style={[styles.ctaPlanSummary, { color: colors.foreground }]}>
              {PLANS[selectedTier].name}
              {selectedTier === "premium" ? ` · ${activeDurationObj.label}` : ""}
            </Text>
            <Text style={[styles.ctaTotalAmount, { color: colors.primary }]}>
              {selectedTier === "free"
                ? "₹0"
                : selectedTier === "premium"
                  ? productPrice(PLAY_PRODUCT_IDS.premium[selectedDuration])
                  : productPrice(tierProductId ?? "")}
            </Text>
          </View>

          <Button
            title={
              processing
                ? "Connecting..."
                : selectedTier === "free"
                  ? "Free Plan Active (20 Likes/Day)"
                  : `Upgrade to ${PLANS[selectedTier].name}`
            }
            loading={processing}
            disabled={selectedTier !== "free" && !BILLING_ENABLED}
            onPress={handleSelectOrPurchase}
          />

          <TouchableOpacity
            style={styles.restoreBtn}
            onPress={handleRestore}
            disabled={restoring}
            activeOpacity={0.7}
          >
            <RefreshCw size={13} color={colors.mutedForeground} />
            <Text style={[styles.restoreBtnText, { color: colors.mutedForeground }]}>
              {restoring ? "Checking purchases..." : "Restore purchases / पहले से खरीदी गई सदस्यता"}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  heroBox: {
    alignItems: "center",
    padding: 20,
    borderRadius: Radii.xxl,
    borderWidth: 1,
    marginBottom: 16,
    ...Shadows.card,
  },
  crownCircle: {
    width: 60,
    height: 60,
    borderRadius: Radii.full,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  heroTitle: {
    fontSize: Typography.sizes.xl,
    fontWeight: Typography.weights.bold,
    fontFamily: Typography.fontDisplay,
  },
  heroTagline: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.semibold,
    marginTop: 2,
  },
  heroSubtitle: {
    fontSize: Typography.sizes.xs,
    textAlign: "center",
    marginTop: 6,
    lineHeight: 18,
  },
  currentActiveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: Radii.full,
    marginTop: 10,
  },
  currentActiveBadgeText: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
  },
  safetyGuaranteeBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: Radii.xl,
    borderWidth: 1,
    marginBottom: 20,
  },
  safetyGuaranteeContent: {
    flex: 1,
  },
  safetyGuaranteeTitle: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
  },
  safetyGuaranteeText: {
    fontSize: 11,
    marginTop: 2,
    lineHeight: 16,
  },
  sectionHeading: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
    letterSpacing: 0.5,
    marginBottom: 10,
    marginLeft: 4,
  },
  comparisonCard: {
    borderRadius: Radii.xl,
    borderWidth: 1,
    overflow: "hidden",
    ...Shadows.card,
  },
  matrixHeaderRow: {
    flexDirection: "row",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    alignItems: "center",
  },
  matrixColFeature: {
    flex: 2.2,
    fontSize: 11,
    fontWeight: Typography.weights.bold,
  },
  matrixColPlan: {
    flex: 1,
    fontSize: 11,
    textAlign: "center",
  },
  matrixRow: {
    flexDirection: "row",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    alignItems: "center",
  },
  matrixRowLabel: {
    flex: 2.2,
    fontSize: 11,
    fontWeight: Typography.weights.medium,
  },
  matrixRowCell: {
    flex: 1,
    fontSize: 11,
    textAlign: "center",
  },
  durationGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 20,
  },
  durationCard: {
    flexBasis: "48%",
    flexGrow: 1,
    borderRadius: Radii.xl,
    padding: 14,
    borderWidth: 1.5,
    position: "relative",
  },
  durationBadge: {
    position: "absolute",
    top: -8,
    right: 12,
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
  },
  durationPrice: {
    fontSize: Typography.sizes.lg,
    fontWeight: Typography.weights.bold,
    marginTop: 4,
  },
  durationSavings: {
    fontSize: 10,
    fontWeight: Typography.weights.semibold,
    marginTop: 2,
  },
  singleMonthNoteBox: {
    borderRadius: Radii.lg,
    padding: 12,
    borderWidth: 1,
    marginBottom: 16,
  },
  singleMonthNoteTitle: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
  },
  singleMonthNoteText: {
    fontSize: 11,
    marginTop: 2,
  },
  plansContainer: {
    gap: 16,
    marginBottom: 24,
  },
  planCard: {
    borderRadius: Radii.xl,
    padding: 16,
    borderWidth: 1.5,
    position: "relative",
    ...Shadows.card,
  },
  planBadge: {
    position: "absolute",
    top: -10,
    right: 16,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: Radii.full,
  },
  planBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: Typography.weights.bold,
    letterSpacing: 0.5,
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
  },
  currentPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radii.full,
  },
  currentPillText: {
    fontSize: 10,
    fontWeight: Typography.weights.bold,
  },
  planHindi: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.medium,
    marginTop: 2,
  },
  planTagline: {
    fontSize: 11,
    marginTop: 4,
  },
  planPriceCol: {
    alignItems: "flex-end",
  },
  planPrice: {
    fontSize: Typography.sizes.xxl,
    fontWeight: Typography.weights.bold,
  },
  planPeriod: {
    fontSize: 10,
    marginTop: -2,
  },
  featuresList: {
    gap: 8,
    marginBottom: 16,
  },
  featureItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  featureText: {
    fontSize: Typography.sizes.sm,
    flex: 1,
  },
  selectBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 10,
    borderRadius: Radii.lg,
  },
  radioCircle: {
    width: 16,
    height: 16,
    borderRadius: Radii.full,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: Radii.full,
  },
  selectText: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.semibold,
  },
  ctaCard: {
    borderRadius: Radii.xxl,
    padding: 18,
    borderWidth: 1,
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
  },
  ctaTotalAmount: {
    fontSize: Typography.sizes.xl,
    fontWeight: Typography.weights.bold,
  },
  restoreBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    marginTop: 4,
  },
  restoreBtnText: {
    fontSize: 11,
    fontWeight: Typography.weights.medium,
  },
});
