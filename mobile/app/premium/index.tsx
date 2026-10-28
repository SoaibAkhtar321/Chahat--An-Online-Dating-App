import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Crown, ShieldCheck, CheckCircle2, Award, RefreshCw } from "lucide-react-native";
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
  type BillingDuration,
  type PlanTier,
  type PlayBillingProduct,
  type UserSubscription,
} from "../../src/services/subscription";

export default function PremiumScreen() {
  const { colors } = useTheme();
  const { dailyLikeLimit, refreshSubscription } = useMilo();
  const [selectedTier, setSelectedTier] = useState<PlanTier>("premium");
  const [selectedDuration, setSelectedDuration] = useState<BillingDuration["id"]>("1m");
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
          if (active) setSubscriptionError("Plans are unavailable right now.");
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

  // Returns the store price when we have it, otherwise null (nothing is shown).
  const productPrice = (productId: string | null): string | null =>
    productId
      ? (billingProducts.find((product) => product.productId === productId)?.localizedPrice ??
        null)
      : null;

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

  const ctaPrice =
    selectedTier === "free"
      ? null
      : selectedTier === "premium"
        ? productPrice(PLAY_PRODUCT_IDS.premium[selectedDuration])
        : productPrice(tierProductId);

  const handleSelectOrPurchase = async () => {
    if (selectedTier === "free") {
      Alert.alert(
        "Free Plan Active",
        `Your server-configured limit is ${dailyLikeLimit ?? "currently unavailable"} likes per IST day, with basic chat and free identity verification.`,
      );
      return;
    }

    // Prepaid plans do not stack across tiers (the server keeps the new plan's own end date when the tier changes,
    // and refuses a lower tier while a higher one is active). Tell the member before Google Play charges them.
    const rank: Record<PlanTier, number> = { free: 0, premium: 1, plus: 2, vip: 3 };
    const activePaid =
      currentSub && currentSub.tier !== "free" && currentSub.status === "active" ? currentSub : null;
    if (activePaid && rank[selectedTier] < rank[activePaid.tier]) {
      Alert.alert(
        "You already have a higher plan",
        `${PLANS[activePaid.tier].name} is active. You can buy ${PLANS[selectedTier].name} after it ends.`,
      );
      return;
    }
    if (activePaid && rank[selectedTier] > rank[activePaid.tier]) {
      const proceed = await new Promise<boolean>((resolve) =>
        Alert.alert(
          `Switch to ${PLANS[selectedTier].name}?`,
          `Your remaining ${PLANS[activePaid.tier].name} time is replaced by the new plan, which starts now.`,
          [
            { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
            { text: "Continue", onPress: () => resolve(true) },
          ],
        ),
      );
      if (!proceed) return;
    }

    setProcessing(true);
    // Plus and VIP are sold for 1 month only; the duration picker applies to Premium.
    const result = await purchaseSubscription(selectedTier, selectedTier === "premium" ? selectedDuration : "1m");
    setProcessing(false);

    if (result.success) {
      Alert.alert("Success", "Your subscription is active!");
      const updated = await getUserSubscription();
      setCurrentSub(updated);
      void refreshSubscription();
    } else {
      if (result.status === "pending") {
        Alert.alert("Payment pending", result.error || "Waiting for your payment to complete.");
        return;
      }
      Alert.alert("Purchase", result.error || "Could not start the payment. Please try again.");
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

  const buttonTitle = processing
    ? "Connecting..."
    : selectedTier === "free"
      ? `Free Plan Active (${dailyLikeLimit ?? "—"} Likes/Day)`
      : BILLING_ENABLED
        ? "Continue to payment"
        : "Coming soon";

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <Header title="CHAHAT Premium" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
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
            Unlock unlimited likes, 5 minutes of video calling a day, see who liked you, and rewind passes.
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

        {/* Plans */}
        <Text style={[styles.sectionHeading, { color: colors.mutedForeground }]}>
          CHOOSE YOUR PLAN
        </Text>
        <View style={styles.plansContainer}>
          {(["premium", "plus", "vip", "free"] as PlanTier[]).map((tierKey) => {
            const plan = PLANS[tierKey];
            const isSelected = selectedTier === tierKey;
            const isCurrent = currentSub?.tier === tierKey;
            const cardPrice =
              tierKey === "free"
                ? "Free"
                : productPrice(
                    tierKey === "premium"
                      ? PLAY_PRODUCT_IDS.premium["1m"]
                      : tierKey === "plus"
                        ? PLAY_PRODUCT_IDS.plus["1m"]
                        : PLAY_PRODUCT_IDS.vip["1m"],
                  );

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

                  {cardPrice ? (
                    <View style={styles.planPriceCol}>
                      <Text style={[styles.planPrice, { color: colors.foreground }]}>
                        {cardPrice}
                      </Text>
                    </View>
                  ) : null}
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

        {/* Duration (Premium only) */}
        {selectedTier === "premium" && (
          <>
            <Text style={[styles.sectionHeading, { color: colors.mutedForeground }]}>
              CHOOSE DURATION
            </Text>
            <View style={styles.durationGrid}>
              {PREMIUM_BILLING_DURATIONS.map((dur) => {
                const isSelected = selectedDuration === dur.id;
                const price = productPrice(PLAY_PRODUCT_IDS.premium[dur.id]);
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
                        <Text style={styles.durationBadgeText}>POPULAR</Text>
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
                    {price ? (
                      <Text
                        style={[
                          styles.durationPrice,
                          { color: isSelected ? colors.primary : colors.foreground },
                        ]}
                      >
                        {price}
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

        {/* Action Button Card */}
        <View
          style={[styles.ctaCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <View style={styles.ctaSummaryRow}>
            <Text style={[styles.ctaPlanSummary, { color: colors.foreground }]}>
              {PLANS[selectedTier].name}
              {selectedTier === "premium" ? ` · ${activeDurationObj.label}` : ""}
            </Text>
            {selectedTier === "free" || ctaPrice ? (
              <Text style={[styles.ctaTotalAmount, { color: colors.primary }]}>
                {selectedTier === "free" ? "₹0" : ctaPrice}
              </Text>
            ) : null}
          </View>

          <Button
            title={buttonTitle}
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
              View purchases in Google Play
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
