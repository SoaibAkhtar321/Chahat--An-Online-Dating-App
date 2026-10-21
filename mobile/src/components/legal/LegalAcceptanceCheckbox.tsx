import React, { useMemo } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { Check } from "lucide-react-native";
import { Layout, Radii, Spacing, Typography, ThemeColors } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";

interface Props {
  checked: boolean;
  onChange: (next: boolean) => void;
  error?: string;
}

// Unchecked-by-default is the caller's responsibility (useState(false)). "Terms & Conditions" and "Privacy Policy"
// open the documents; the box itself is the only thing that records the user's choice.
export const LegalAcceptanceCheckbox: React.FC<Props> = ({ checked, onChange, error }) => {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const router = useRouter();

  return (
    <View style={styles.wrapper}>
      <View style={styles.row}>
        <TouchableOpacity
          accessibilityRole="checkbox"
          accessibilityState={{ checked }}
          accessibilityLabel="Agree to the Terms and Conditions and acknowledge the Privacy Policy"
          onPress={() => onChange(!checked)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={[styles.box, checked && styles.boxChecked, !!error && !checked && styles.boxError]}
        >
          {checked ? <Check size={16} color={Colors.primaryForeground} strokeWidth={3} /> : null}
        </TouchableOpacity>
        <Text style={styles.label}>
          I have read and agree to the{" "}
          <Text
            accessibilityRole="link"
            style={styles.link}
            onPress={() => router.push("/legal/terms")}
          >
            Terms & Conditions
          </Text>{" "}
          and acknowledge the{" "}
          <Text
            accessibilityRole="link"
            style={styles.link}
            onPress={() => router.push("/legal/privacy")}
          >
            Privacy Policy
          </Text>
          .
        </Text>
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
};

const createStyles = (Colors: ThemeColors) =>
  StyleSheet.create({
    wrapper: { marginBottom: Layout.sectionGap },
    row: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.md },
    box: {
      width: 24,
      height: 24,
      borderRadius: Radii.sm,
      borderWidth: 2,
      borderColor: Colors.border,
      backgroundColor: Colors.card,
      alignItems: "center",
      justifyContent: "center",
      marginTop: Spacing.xs / 2,
    },
    boxChecked: { backgroundColor: Colors.primary, borderColor: Colors.primary },
    boxError: { borderColor: Colors.destructive },
    label: {
      flex: 1,
      fontSize: Typography.sizes.sm,
      color: Colors.foreground,
      lineHeight: 20,
      paddingTop: Spacing.xs,
    },
    link: { color: Colors.primary, fontWeight: Typography.weights.bold, textDecorationLine: "underline" },
    errorText: { marginTop: Spacing.sm, fontSize: Typography.sizes.sm, color: Colors.destructive },
  });
