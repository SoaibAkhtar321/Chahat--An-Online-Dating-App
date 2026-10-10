import React, { useState, useEffect } from "react";
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
import { Colors, Radii, Shadows, Typography } from "../../src/constants/theme";
import { Button } from "../../src/components/ui/Button";

const { height: screenHeight } = Dimensions.get("window");

const SLIDES = [
  {
    title: "Match only when it's mutual",
    desc: "A match happens only when you both like each other. No surprises.",
  },
  {
    title: "Safety, built right in",
    desc: "Strictly 18+, verified members, and full control over your privacy and chats.",
  },
];

export default function WelcomeScreen() {
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
                mi<Text style={styles.logoAccent}>l</Text>o
              </Text>
              <View style={styles.badgePill}>
                <Text style={styles.badgeText}>Dating in India</Text>
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
              style={styles.primaryButton}
            />

            <Button
              title="I already have an account"
              variant="ghost"
              onPress={() => router.push("/(auth)/login")}
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

const styles = StyleSheet.create({
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
    borderBottomWidth: 1.5,
    borderBottomColor: Colors.border,
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
    paddingTop: 14,
    paddingHorizontal: 20,
    paddingBottom: 22,
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
    paddingHorizontal: 10,
    paddingVertical: 4,
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
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 16,
  },
  copySection: {
    paddingVertical: 8,
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
    marginTop: 8,
  },
  dotsRow: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    marginTop: 16,
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
    gap: 12,
    marginTop: 16,
  },
  primaryButton: {
    width: "100%",
  },
  secondaryButton: {
    width: "100%",
  },
  legalSection: {
    marginTop: 4,
    paddingHorizontal: 12,
  },
  legalText: {
    fontSize: Typography.sizes.xs,
    color: Colors.mutedForeground,
    textAlign: "center",
    lineHeight: 18,
  },
  legalLink: {
    color: Colors.primary,
    fontWeight: Typography.weights.semibold,
  },
});
