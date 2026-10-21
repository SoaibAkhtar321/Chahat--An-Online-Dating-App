import React, { useMemo } from "react";
import { View, Text, Switch, StyleSheet, ViewStyle } from "react-native";
import { Layout, Spacing, Typography, ThemeColors } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";

interface ToggleProps {
  label: string;
  hint?: string;
  value: boolean;
  onValueChange: (val: boolean) => void;
  style?: ViewStyle;
}

export const Toggle: React.FC<ToggleProps> = ({ label, hint, value, onValueChange, style }) => {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);

  return (
    <View style={[styles.container, style]}>
      <View style={styles.textContainer}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        accessibilityLabel={label}
        trackColor={{ false: Colors.muted, true: Colors.primary }}
        thumbColor={Colors.card}
      />
    </View>
  );
};

const createStyles = (Colors: ThemeColors) => StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: Layout.minTap + Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  textContainer: {
    flex: 1,
    paddingRight: Spacing.lg,
  },
  label: {
    fontSize: Typography.sizes.base,
    fontWeight: Typography.weights.semibold,
    color: Colors.foreground,
  },
  hint: {
    fontSize: Typography.sizes.xs,
    color: Colors.mutedForeground,
    marginTop: Spacing.xs,
  },
});
