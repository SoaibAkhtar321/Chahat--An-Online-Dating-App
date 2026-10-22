import React, { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Button } from "../ui/Button";
import { useTheme } from "../../context/ThemeContext";
import { useAuth } from "../../context/AuthContext";
import { signInWithGoogle } from "../../services/auth";
import { Spacing, Typography } from "../../constants/theme";

/** "or" divider + Continue with Google. Shows its own error text; cancelling the browser is silent. */
export function GoogleSignInButton() {
  const { colors } = useTheme();
  const router = useRouter();
  const { refreshProfile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const styles = useMemo(() => createStyles(colors.mutedForeground, colors.border, colors.destructive), [colors]);

  const onPress = async () => {
    setError("");
    setLoading(true);
    const res = await signInWithGoogle();
    if (res.success) {
      await refreshProfile();
      setLoading(false);
      router.replace("/");
      return;
    }
    setLoading(false);
    if (!res.cancelled) setError(res.error || "Could not sign in with Google.");
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.dividerRow}>
        <View style={styles.line} />
        <Text style={styles.or}>or</Text>
        <View style={styles.line} />
      </View>
      <Button title="Continue with Google" variant="outline" size="lg" onPress={onPress} loading={loading} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const createStyles = (muted: string, border: string, danger: string) =>
  StyleSheet.create({
    wrap: { marginTop: Spacing.xl },
    dividerRow: { flexDirection: "row", alignItems: "center", gap: Spacing.md, marginBottom: Spacing.lg },
    line: { flex: 1, height: 1, backgroundColor: border },
    or: { color: muted, fontSize: Typography.sizes.sm },
    error: { color: danger, fontSize: Typography.sizes.sm, marginTop: Spacing.sm, textAlign: "center" },
  });
