import React, { useMemo, useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Layout, Radii, Shadows, Spacing, ThemeColors, Typography } from "../../src/constants/theme";
import { useTheme } from "../../src/context/ThemeContext";
import { Button } from "../../src/components/ui/Button";

const { height: screenHeight } = Dimensions.get("window");

const SLIDES = [
  {
    title: "Match only when it's mutual",
    desc: "A match happens only when you both like each other. No surprises.",
  },
  {
    title: "Safety, built right in",
    desc: "Strictly 18+ members, and full control over your privacy and chats.",
  },
];

export default function WelcomeScreen() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const router = useRouter();
  const [slideIndex, setSlideIndex] = useState(0);

  // Auto-advance slides every 3.8s
  useEffect(() => {
    const timer = setInterval(() => {
      setSlideIndex((prev) => (prev + 1) % SLIDES.length);
    }, 3800);
    return () => clearInterval(timer);
  }, []);

  const activeSlide = SLIDES[slideIndex];

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <View style={styles.outerWrapper}>
        {/* Top Half: Dedicated Hero Image Container (~42-45% height) */}
        <View style={styles.heroHalf}>
          <Image
            source={require("../../assets/p1.jpg")}
            style={styles.heroImage}
            contentFit="cover"
            contentPosition="top center"
            priority="high"
          />

          {/* Top Brand Logo Overlay */}
          <LinearGradient
            colors={["rgba(35, 20, 30, 0.45)", "transparent"]}
            style={styles.topGradient}
          >
            <View style={styles.logoRow}>
              <Text style={styles.logoText}>
                cha<Text style={styles.logoAccent}>h</Text>at
              </Text>
              <View style={styles.badgePill}>
                <Text style={styles.badgeText}>Online Friendship App</Text>
              </View>
            </View>
          </LinearGradient>

        </View>

        {/* Bottom Half: Clean, high-contrast readable content */}
        <ScrollView
          style={styles.bottomScroll}
          contentContainerStyle={styles.bottomContent}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* Headline & Value Proposition Text */}
          <View style={styles.copySection}>
            <Text style={styles.headingText}>{activeSlide.title}</Text>
            <Text style={styles.bodyText}>{activeSlide.desc}</Text>

            {/* Slide indicator dots */}
            <View style={styles.dotsRow}>
              {SLIDES.map((_, i) => (
                <TouchableOpacity
                  key={i}
                  onPress={() => setSlideIndex(i)}
                  activeOpacity={0.7}
                  hitSlop={{ top: 19, bottom: 19, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Show slide ${i + 1} of ${SLIDES.length}`}
                  style={[
                    styles.dot,
                    i === slideIndex ? styles.dotActive : styles.dotInactive,
                  ]}
                />
              ))}
            </View>
          </View>

          {/* Action CTAs */}
          <View style={styles.actionsSection}>
            <Button
              title="Create account"
              onPress={() => router.push("/(auth)/signup")}
              size="lg"
              style={styles.primaryButton}
            />

            <Button
              title="I already have an account"
              variant="ghost"
              onPress={() => router.push("/(auth)/login")}
              size="lg"
              style={styles.secondaryButton}
            />

            <View style={styles.legalSection}>
              <Text style={styles.legalText}>
                Strictly 18+. By continuing you agree to our{" "}
                <Text
                  style={styles.legalLink}
                  onPress={() => router.push("/legal/terms")}
                >
                  Terms
                </Text>{" "}
                and{" "}
                <Text
                  style={styles.legalLink}
                  onPress={() => router.push("/legal/privacy")}
                >
                  Privacy Policy
                </Text>
                .
              </Text>
            </View>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const createStyles = (Colors: ThemeColors) => StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  outerWrapper: {
    flex: 1,
    width: "100%",
    maxWidth: 500,
    alignSelf: "center",
    backgroundColor: Colors.background,
  },
  // Top half: Dedicated hero image container (~52% height) with crisp clean border
  heroHalf: {
    height: Math.max(340, Math.min(screenHeight * 0.52, 480)),
    width: "100%",
    position: "relative",
    backgroundColor: Colors.ink,
    borderBottomLeftRadius: Radii.xxl,
    borderBottomRightRadius: Radii.xxl,
    overflow: "hidden",
    ...Shadows.card,
  },
  heroImage: {
    width: "100%",
    height: "100%",
  },
  topGradient: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingTop: Spacing.lg,
    paddingHorizontal: Layout.screenPadding,
    paddingBottom: Spacing.xl,
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  logoText: {
    fontFamily: Typography.fontDisplay,
    fontSize: 34,
    fontWeight: Typography.weights.bold,
    color: "#FFFFFF",
    fontStyle: "italic",
    letterSpacing: -0.5,
  },
  logoAccent: {
    color: Colors.accent,
  },
  badgePill: {
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radii.full,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.35)",
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.semibold,
    letterSpacing: 0.3,
  },
  // Bottom half: Content area
  bottomScroll: {
    flex: 1,
  },
  bottomContent: {
    flexGrow: 1,
    justifyContent: "space-between",
    paddingHorizontal: Layout.screenPadding,
    paddingTop: Layout.sectionGap,
    paddingBottom: Spacing.lg,
  },
  copySection: {
    paddingVertical: Spacing.sm,
  },
  headingText: {
    fontSize: Typography.sizes.title,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
    lineHeight: 36,
    letterSpacing: -0.5,
  },
  bodyText: {
    fontSize: Typography.sizes.base,
    color: Colors.mutedForeground,
    lineHeight: 22,
    marginTop: Spacing.sm,
  },
  dotsRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    alignItems: "center",
    marginTop: Spacing.lg,
  },
  dot: {
    height: 6,
    borderRadius: Radii.full,
  },
  dotActive: {
    width: 24,
    backgroundColor: Colors.primary,
  },
  dotInactive: {
    width: 6,
    backgroundColor: Colors.border,
  },
  actionsSection: {
    width: "100%",
    gap: Spacing.md,
    marginTop: Spacing.lg,
  },
  primaryButton: {
    width: "100%",
  },
  secondaryButton: {
    width: "100%",
  },
  legalSection: {
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  legalText: {
    fontSize: Typography.sizes.sm,
    color: Colors.mutedForeground,
    textAlign: "center",
    lineHeight: 20,
  },
  legalLink: {
    color: Colors.primary,
    fontWeight: Typography.weights.semibold,
  },
});
