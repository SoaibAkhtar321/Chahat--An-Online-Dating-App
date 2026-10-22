import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking } from "react-native";
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
import { Radii, Shadows, Typography, Spacing } from "../../src/constants/theme";
import { useTheme } from "../../src/context/ThemeContext";
import { Header } from "../../src/components/ui/Header";
import { Button } from "../../src/components/ui/Button";
import { Alert } from "../../src/utils/alert";
import { useMilo } from "../../src/context/MiloContext";
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
  const { dailyLikeLimit, refreshSubscription } = useMilo();
  const [selectedTier, setSelectedTier] = useState<PlanTier>("premium");
  const [selectedDuration, setSelectedDuration] = useState<"1m" | "3m" | "6m" | "12m">("1m");
  const [currentSub, setCurrentSub] = useState<UserSubscription | null>(null);
  const [processing, setProcessing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [billingProducts, setBillingProducts] = useState<PlayBillingProduct[]>([]);
  const [subscriptionLoading, setSubscriptionLoading] = useState(true);
  const [subscriptionError, setSubscriptionError] = useState("");

  useEffect(() => {
    let active = true;
    let removePurchaseListeners: (() => void) | undefined;
    setSubscriptionLoading(true);
    void getUserSubscription()
      .then((sub) => {
        if (!active) return;
        setCurrentSub(sub);
        setSubscriptionError("");
        if (sub.tier !== "free") setSelectedTier(sub.tier);
      })
      .catch((error) => {
        if (!active) return;
        setCurrentSub(null);
        setSubscriptionError(
          error instanceof Error ? error.message : "Subscription status could not be verified.",
        );
      })
      .finally(() => {
        if (active) setSubscriptionLoading(false);
      });

    if (BILLING_ENABLED) {
      void loadPlayBillingCatalog()
        .then((products) => {
          if (active) setBillingProducts(products);
        })
        .catch((error) => {
          console.warn("Google Play product catalog unavailable:", error);
          if (active) setSubscriptionError("Google Play product catalog is unavailable.");
        });
      void listenForPurchaseUpdates((event) => {
        if (!active) return;
        setProcessing(false);
        if (event.status === "completed") {
          void refreshSubscription();
          void getUserSubscription()
            .then((subscription) => {
              if (active) {
                setCurrentSub(subscription);
                setSubscriptionError("");
              }
            })
            .catch((error) => {
              if (active) {
                setSubscriptionError(
                  error instanceof Error
                    ? error.message
                    : "Subscription status could not be verified.",
                );
              }
            });
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
        "Free Plan Active",
        `Your server-configured limit is ${dailyLikeLimit ?? "currently unavailable"} likes per IST day, with basic chat and free identity verification.`,
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
      void refreshSubscription();
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
      void refreshSubscription();
      try {
        setCurrentSub(await getUserSubscription());
        setSubscriptionError("");
      } catch (error) {
        setSubscriptionError(
          error instanceof Error ? error.message : "Subscription status could not be verified.",
        );
      }
    } else {
      Alert.alert("Restore Purchases", res.error || "No active purchases found to restore.");
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <Header title="CHAHAT Premium" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {!BILLING_ENABLED && (
          <View
            style={[
              styles.singleMonthNoteBox,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.singleMonthNoteText, { color: colors.mutedForeground }]}>
              Google Play checkout is disabled in this build. Displayed reference pricing is not a
              live price or charge.
            </Text>
          </View>
        )}
        {/* Hero Branding */}
        <View
          style={[styles.heroBox, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
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
          {subscriptionLoading ? (
            <Text style={[styles.heroSubtitle, { color: colors.mutedForeground }]}>
              Checking verified subscription status…
            </Text>
          ) : subscriptionError ? (
            <Text style={[styles.heroSubtitle, { color: colors.destructive }]}>
              Subscription status could not be verified. Paid features remain locked until the
              server responds.
            </Text>
          ) : null}
        </View>

        {/* Free Plan Safety Guarantee Banner */}
        <View
          style={[
            styles.safetyGuaranteeBox,
            { backgroundColor: colors.secondary, borderColor: colors.border },
          ]}
        >
          <ShieldCheck size={20} color={colors.success} />
          <View style={styles.safetyGuaranteeContent}>
            <Text style={[styles.safetyGuaranteeTitle, { color: colors.foreground }]}>
              Safety is Always Free
            </Text>
            <Text style={[styles.safetyGuaranteeText, { color: colors.mutedForeground }]}>
              Selfie verification, privacy controls, blocking, and reporting are 100% free for all
              users on Chahat.
            </Text>
          </View>
        </View>

        {/* What You Get With Each Plan Section */}
        <Text style={[styles.sectionHeading, { color: colors.mutedForeground }]}>
          WHAT YOU GET WITH EACH PLAN
        </Text>

        <View
          style={[
            styles.comparisonCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={[styles.matrixHeaderRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.matrixColFeature, { color: colors.mutedForeground }]}>
              Feature
            </Text>
            <Text style={[styles.matrixColPlan, { color: colors.foreground }]}>Free</Text>
            <Text
              style={[
                styles.matrixColPlan,
                { color: colors.primary, fontWeight: Typography.weights.bold },
              ]}
            >
              Prem
            </Text>
            <Text
              style={[
                styles.matrixColPlan,
                { color: colors.accent, fontWeight: Typography.weights.bold },
              ]}
            >
              Plus
            </Text>
            <Text
              style={[
                styles.matrixColPlan,
                { color: colors.primary, fontWeight: Typography.weights.bold },
              ]}
            >
              VIP
            </Text>
          </View>

          {[
            {
              name: "Daily Likes",
              free: dailyLikeLimit === null ? "—" : dailyLikeLimit < 0 ? "50 / day" : `${dailyLikeLimit} / day`,
              prem: "Unlimited",
              plus: "Unlimited",
              vip: "Unlimited",
            },
            {
              name: "See Who Liked You",
              free: "—",
              prem: "✓",
              plus: "✓",
              vip: "✓",
            },
            { name: "Rewind Pass", free: "—", prem: "✓", plus: "✓", vip: "✓" },
            { name: "Read Receipts", free: "—", prem: "—", plus: "✓", vip: "✓" },
            {
              name: "Profile Verification Badge",
              free: "Free",
              prem: "Free",
              plus: "Free",
              vip: "Free",
            },
            {
              name: "Safety, Block & Report",
              free: "Free",
              prem: "Free",
              plus: "Free",
              vip: "Free",
            },
          ].map((row, idx) => (
            <View key={idx} style={[styles.matrixRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.matrixRowLabel, { color: colors.foreground }]}>{row.name}</Text>
              <Text style={[styles.matrixRowCell, { color: colors.mutedForeground }]}>
                {row.free}
              </Text>
              <Text
                style={[
                  styles.matrixRowCell,
                  { color: colors.primary, fontWeight: Typography.weights.semibold },
                ]}
              >
                {row.prem}
              </Text>
              <Text
                style={[
                  styles.matrixRowCell,
                  { color: colors.accent, fontWeight: Typography.weights.semibold },
                ]}
              >
                {row.plus}
              </Text>
              <Text
                style={[
                  styles.matrixRowCell,
                  { color: colors.foreground, fontWeight: Typography.weights.bold },
                ]}
              >
                {row.vip}
              </Text>
            </View>
          ))}
        </View>

        {/* Billing Duration Selector (Approved for Premium only) */}
        {selectedTier === "premium" ? (
          <>
            <Text style={[styles.sectionHeading, { color: colors.mutedForeground, marginTop: 24 }]}>
              1. SELECT PREMIUM DURATION
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
                      {
                        backgroundColor: colors.card,
                        borderColor: isSelected ? colors.primary : colors.border,
                      },
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
          <View
            style={[
              styles.singleMonthNoteBox,
              { backgroundColor: colors.card, borderColor: colors.border, marginTop: 24 },
            ]}
          >
            <Text style={[styles.singleMonthNoteTitle, { color: colors.foreground }]}>
              Monthly Plan Pricing
            </Text>
            <Text style={[styles.singleMonthNoteText, { color: colors.mutedForeground }]}>
              {selectedTier === "plus" ? "CHAHAT Plus: ₹199/month" : "CHAHAT VIP: ₹399/month"}
            </Text>
          </View>
        ) : null}

        {/* Plan Tiers Selection */}
        <Text
          style={[
            styles.sectionHeading,
            { color: colors.mutedForeground, marginTop: selectedTier === "free" ? 24 : 12 },
          ]}
        >
          2. CHOOSE YOUR PLAN
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
                      <Text style={[styles.planName, { color: colors.foreground }]}>
                        {plan.name}
                      </Text>
                      {isCurrent && (
                        <View style={[styles.currentPill, { backgroundColor: colors.secondary }]}>
                          <Text style={[styles.currentPillText, { color: colors.primary }]}>
                            Current
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text style={[styles.planTagline, { color: colors.mutedForeground }]}>
                      {plan.tagline}
                    </Text>
                  </View>

                  <View style={styles.planPriceCol}>
                    <Text style={[styles.planPrice, { color: colors.foreground }]}>
                      {plan.monthlyPrice === 0 ? "Free" : productPrice(tierProductId ?? "")}
                    </Text>
                    {plan.monthlyPrice > 0 && (
                      <Text style={[styles.planPeriod, { color: colors.mutedForeground }]}>
                        /month
                      </Text>
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
                      <View
                        style={[styles.radioDot, { backgroundColor: colors.primaryForeground }]}
                      />
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
        <View
          style={[styles.ctaCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <Text
            style={[
              styles.singleMonthNoteText,
              { color: colors.mutedForeground, marginBottom: 10 },
            ]}
          >
            {BILLING_ENABLED
              ? "Google Play displays the current price and handles payment. Entitlements are enabled only after server verification."
              : "Prices shown are reference prices. Google Play checkout is not configured in this build; no charge can be made here."}
          </Text>
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
                  ? `Free Plan Active (${dailyLikeLimit ?? "—"} Likes/Day)`
                  : `Upgrade to ${PLANS[selectedTier].name}`
            }
            loading={processing}
            disabled={
              selectedTier !== "free" &&
              (!BILLING_ENABLED || subscriptionLoading || !!subscriptionError)
            }
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
              {restoring ? "Checking purchases..." : "Restore purchases"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.restoreBtn}
            onPress={() => void Linking.openURL("https://play.google.com/store/account/subscriptions")}
            activeOpacity={0.7}
            accessibilityRole="link"
          >
            <Text style={[styles.restoreBtnText, { color: colors.mutedForeground }]}>
              Manage or cancel subscription
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
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  heroBox: {
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: Radii.xxl,
    borderWidth: 1,
    marginBottom: Spacing.lg,
    ...Shadows.card,
  },
  crownCircle: {
    width: 60,
    height: 60,
    borderRadius: Radii.full,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.md,
  },
  heroTitle: {
    fontSize: Typography.sizes.xl,
    fontWeight: Typography.weights.bold,
    fontFamily: Typography.fontDisplay,
  },
  heroTagline: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.semibold,
    marginTop: Spacing.xs,
  },
  heroSubtitle: {
    fontSize: Typography.sizes.xs,
    textAlign: "center",
    marginTop: Spacing.sm,
    lineHeight: 18,
  },
  currentActiveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radii.full,
    marginTop: Spacing.md,
  },
  currentActiveBadgeText: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
  },
  safetyGuaranteeBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    padding: Spacing.lg,
    borderRadius: Radii.xl,
    borderWidth: 1,
    marginBottom: Spacing.lg,
  },
  safetyGuaranteeContent: {
    flex: 1,
  },
  safetyGuaranteeTitle: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
  },
  safetyGuaranteeText: {
    fontSize: Typography.sizes.xs,
    marginTop: Spacing.xs,
    lineHeight: 16,
  },
  sectionHeading: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
    letterSpacing: 0.5,
    marginBottom: Spacing.md,
    marginLeft: Spacing.xs,
  },
  comparisonCard: {
    borderRadius: Radii.xl,
    borderWidth: 1,
    overflow: "hidden",
    ...Shadows.card,
  },
  matrixHeaderRow: {
    flexDirection: "row",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: 1,
    alignItems: "center",
  },
  matrixColFeature: {
    flex: 2.2,
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
  },
  matrixColPlan: {
    flex: 1,
    fontSize: Typography.sizes.xs,
    textAlign: "center",
  },
  matrixRow: {
    flexDirection: "row",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: 1,
    alignItems: "center",
  },
  matrixRowLabel: {
    flex: 2.2,
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.medium,
  },
  matrixRowCell: {
    flex: 1,
    fontSize: Typography.sizes.xs,
    textAlign: "center",
  },
  durationGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  durationCard: {
    flexBasis: "48%",
    flexGrow: 1,
    borderRadius: Radii.xl,
    padding: Spacing.lg,
    borderWidth: 1.5,
    position: "relative",
  },
  durationBadge: {
    position: "absolute",
    top: -8,
    right: 12,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Radii.full,
  },
  durationBadgeText: {
    fontSize: Typography.sizes.xs,
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
    marginTop: Spacing.xs,
  },
  durationSavings: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.semibold,
    marginTop: Spacing.xs,
  },
  singleMonthNoteBox: {
    borderRadius: Radii.lg,
    padding: Spacing.md,
    borderWidth: 1,
    marginBottom: Spacing.lg,
  },
  singleMonthNoteTitle: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
  },
  singleMonthNoteText: {
    fontSize: Typography.sizes.xs,
    marginTop: Spacing.xs,
  },
  plansContainer: {
    gap: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  planCard: {
    borderRadius: Radii.xl,
    padding: Spacing.lg,
    borderWidth: 1.5,
    position: "relative",
    ...Shadows.card,
  },
  planBadge: {
    position: "absolute",
    top: -10,
    right: 16,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radii.full,
  },
  planBadgeText: {
    color: "#fff",
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
    letterSpacing: 0.5,
  },
  planHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: Spacing.lg,
  },
  planTitleCol: {
    flex: 1,
  },
  planNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  planName: {
    fontSize: Typography.sizes.lg,
    fontWeight: Typography.weights.bold,
  },
  currentPill: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Radii.full,
  },
  currentPillText: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
  },
  planTagline: {
    fontSize: Typography.sizes.xs,
    marginTop: Spacing.xs,
  },
  planPriceCol: {
    alignItems: "flex-end",
  },
  planPrice: {
    fontSize: Typography.sizes.xxl,
    fontWeight: Typography.weights.bold,
  },
  planPeriod: {
    fontSize: Typography.sizes.xs,
    marginTop: -2,
  },
  featuresList: {
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  featureItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  featureText: {
    fontSize: Typography.sizes.sm,
    flex: 1,
  },
  selectBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
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
    padding: Spacing.lg,
    borderWidth: 1,
    gap: Spacing.md,
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
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    marginTop: Spacing.xs,
  },
  restoreBtnText: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.medium,
  },
});
