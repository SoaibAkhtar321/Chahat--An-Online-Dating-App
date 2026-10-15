import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
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
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {error ? (
        <>
          <Text style={[styles.message, { color: colors.foreground }]}>{error}</Text>
          <Button title="Back to sign in" onPress={() => router.replace("/(auth)/login")} />
        </>
      ) : (
        <>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.message, { color: colors.mutedForeground }]}>
            Verifying your secure account link…
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 20 },
  message: { fontSize: 16, lineHeight: 24, textAlign: "center" },
});
