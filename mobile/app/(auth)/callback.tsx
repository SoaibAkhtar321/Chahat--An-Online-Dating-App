import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Layout, Spacing, Typography } from "../../src/constants/theme";
import { useTheme } from "../../src/context/ThemeContext";
import { Button } from "../../src/components/ui/Button";
import { completeAuthLink } from "../../src/services/auth";

export default function AuthCallbackScreen() {
  const url = Linking.useURL();
  const router = useRouter();
  const { colors } = useTheme();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!url)
      return () => {
        active = false;
      };

    void completeAuthLink(url).then((result) => {
      if (!active) return;
      if (!result.success) {
        setError(result.error || "This link could not be verified.");
        return;
      }
      if (result.flow === "recovery") {
        router.replace("/reset-password?mode=update");
      } else {
        router.replace("/");
      }
    });

    return () => {
      active = false;
    };
  }, [url, router]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {error ? (
        <>
          <Text style={[styles.title, { color: colors.foreground }]}>Link problem</Text>
          <Text style={[styles.message, { color: colors.mutedForeground }]}>{error}</Text>
          <Button
            title="Back to sign in"
            onPress={() => router.replace("/(auth)/login")}
            size="lg"
            style={styles.action}
          />
        </>
      ) : (
        <>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.message, { color: colors.mutedForeground }]}>
            Verifying your secure account link…
          </Text>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Layout.screenPadding,
    gap: Spacing.lg,
  },
  title: {
    fontSize: Typography.sizes.xxl,
    fontWeight: Typography.weights.bold,
    fontFamily: Typography.fontDisplay,
    textAlign: "center",
  },
  message: {
    fontSize: Typography.sizes.base,
    lineHeight: 22,
    textAlign: "center",
  },
  action: {
    alignSelf: "stretch",
    marginTop: Spacing.sm,
  },
});
