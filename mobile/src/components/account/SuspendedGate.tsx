// If staff suspend an account in the admin panel, the member sees this instead of the app (checked on open and
// whenever the app comes back to the foreground). The server already refuses likes, messages and calls.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AppState, Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import { ShieldAlert } from "lucide-react-native";
import { useTheme } from "../../context/ThemeContext";
import { useAuth } from "../../context/AuthContext";
import { Radii, Spacing, ThemeColors, Typography } from "../../constants/theme";
import { fetchAccountStatus } from "../../services/adminContent";
import { OPERATOR_DETAILS } from "../../constants/operatorDetails";

export function SuspendedGate({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [suspended, setSuspended] = useState(false);

  const check = useCallback(async () => {
    if (!user?.id) return;
    setSuspended((await fetchAccountStatus()) === "suspended");
  }, [user?.id]);

  useEffect(() => {
    void check();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void check();
    });
    return () => sub.remove();
  }, [check]);

  if (!suspended) return <>{children}</>;
  return (
    <View style={styles.container} testID="suspended-screen">
      <ShieldAlert size={48} color={colors.destructive} />
      <Text style={styles.title}>Your account is suspended</Text>
      <Text style={styles.body}>
        Our team suspended this account after a review under the Community Guidelines. While it is suspended, other
        members can't see your profile and you can't like, message or call. If you think this is a mistake, contact us.
      </Text>
      <TouchableOpacity
        style={styles.primary}
        onPress={() => void Linking.openURL(`mailto:${OPERATOR_DETAILS.supportEmail}?subject=Account%20suspension`)}
        accessibilityRole="button"
      >
        <Text style={styles.primaryText}>Contact support</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.secondary} onPress={() => router.push("/settings")} accessibilityRole="button">
        <Text style={styles.secondaryText}>Settings (delete account, download my data)</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.secondary} onPress={() => void signOut()} accessibilityRole="button">
        <Text style={styles.secondaryText}>Log out</Text>
      </TouchableOpacity>
    </View>
  );
}

const createStyles = (Colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: Spacing.xl,
      gap: Spacing.md,
      backgroundColor: Colors.background,
    },
    title: { fontSize: Typography.sizes.xl, fontWeight: Typography.weights.bold, color: Colors.foreground, textAlign: "center" },
    body: { fontSize: Typography.sizes.sm, color: Colors.mutedForeground, textAlign: "center", lineHeight: 20 },
    primary: {
      marginTop: Spacing.md,
      backgroundColor: Colors.primary,
      borderRadius: Radii.full,
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.xl,
    },
    primaryText: { color: Colors.primaryForeground, fontWeight: Typography.weights.semibold, fontSize: Typography.sizes.base },
    secondary: { paddingVertical: Spacing.sm },
    secondaryText: { color: Colors.primary, fontSize: Typography.sizes.sm },
  });
