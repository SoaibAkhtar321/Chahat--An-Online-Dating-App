import React from "react";
import { View, Text, StyleSheet, Dimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Colors, Radii, Shadows, Typography } from "../../src/constants/theme";
import { Button } from "../../src/components/ui/Button";

const { width } = Dimensions.get("window");

export default function WelcomeScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.heroSection}>
        {/* Splash photo card */}
        <View style={styles.cardContainer}>
          <Image
            source={{
              uri: "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=800&auto=format&fit=crop&q=80",
            }}
            style={styles.heroImage}
            contentFit="cover"
          />
          <LinearGradient
            colors={["transparent", "rgba(35, 20, 30, 0.4)", "rgba(35, 20, 30, 0.95)"]}
            style={styles.heroGradient}
          >
            <Text style={styles.logoText}>
              mi<Text style={styles.logoAccent}>l</Text>o
            </Text>
            <Text style={styles.tagline}>Meet someone who matches your intention.</Text>
          </LinearGradient>
        </View>
      </View>

      <View style={styles.actionSection}>
        <Text style={styles.legalDisclaimer}>
          Milo is designed for genuine connections in India. Strictly 18+.
        </Text>

        <Button
          title="Create an account"
          onPress={() => router.push("/(auth)/signup")}
          style={styles.button}
        />

        <Button
          title="Log in"
          variant="ghost"
          onPress={() => router.push("/(auth)/login")}
          style={styles.button}
        />

        <View style={styles.termsContainer}>
          <Text style={styles.termsText}>
            By signing up, you agree to our{" "}
            <Text style={styles.termsLink} onPress={() => router.push("/legal/terms")}>
              Terms
            </Text>{" "}
            and{" "}
            <Text style={styles.termsLink} onPress={() => router.push("/legal/privacy")}>
              Privacy Policy
            </Text>
            .
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  heroSection: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 16,
  },
  cardContainer: {
    width: width - 48,
    height: (width - 48) * 1.3,
    borderRadius: Radii.xxl,
    overflow: "hidden",
    position: "relative",
    ...Shadows.card,
  },
  heroImage: {
    width: "100%",
    height: "100%",
  },
  heroGradient: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "60%",
    justifyContent: "flex-end",
    padding: 24,
  },
  logoText: {
    fontFamily: Typography.fontDisplay,
    fontSize: 48,
    fontWeight: Typography.weights.bold,
    color: Colors.primaryForeground,
    fontStyle: "italic",
    letterSpacing: -1,
  },
  logoAccent: {
    color: Colors.accent,
  },
  tagline: {
    fontSize: Typography.sizes.base,
    color: Colors.primaryForeground,
    opacity: 0.9,
    marginTop: 6,
    lineHeight: 22,
  },
  actionSection: {
    width: "100%",
    gap: 12,
    marginTop: 24,
  },
  legalDisclaimer: {
    fontSize: Typography.sizes.xs,
    color: Colors.mutedForeground,
    textAlign: "center",
    marginBottom: 4,
  },
  button: {
    width: "100%",
  },
  termsContainer: {
    paddingHorizontal: 16,
    marginTop: 4,
  },
  termsText: {
    fontSize: Typography.sizes.xs,
    color: Colors.mutedForeground,
    textAlign: "center",
    lineHeight: 18,
  },
  termsLink: {
    color: Colors.primary,
    fontWeight: Typography.weights.semibold,
  },
});
