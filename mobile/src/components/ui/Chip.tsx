import React, { useMemo } from "react";
import { TouchableOpacity, Text, StyleSheet, ViewStyle, TextStyle } from "react-native";
import { Layout, Radii, Spacing, Typography, ThemeColors } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";

interface ChipProps {
  label: string;
  active?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
  textStyle?: TextStyle;
  icon?: React.ReactNode;
}

export const Chip: React.FC<ChipProps> = ({
  label,
  active = false,
  onPress,
  style,
  textStyle,
  icon,
}) => {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
      style={[styles.chip, active ? styles.activeChip : styles.inactiveChip, style]}
    >
      {icon}
      <Text style={[styles.text, active ? styles.activeText : styles.inactiveText, textStyle]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
};

const createStyles = (Colors: ThemeColors) => StyleSheet.create({
  chip: {
    minHeight: Layout.minTap - Spacing.sm,
    borderRadius: Radii.full,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.sm,
    marginBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  activeChip: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
    borderWidth: 1,
  },
  inactiveChip: {
    backgroundColor: Colors.card,
    borderColor: Colors.border,
    borderWidth: 1,
  },
  text: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.medium,
  },
  activeText: {
    color: Colors.primaryForeground,
    fontWeight: Typography.weights.bold,
  },
  inactiveText: {
    color: Colors.foreground,
  },
});
