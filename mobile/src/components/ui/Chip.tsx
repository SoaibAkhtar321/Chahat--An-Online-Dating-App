import React from "react";
import { TouchableOpacity, Text, StyleSheet, ViewStyle, TextStyle } from "react-native";
import { Colors, Radii, Typography } from "../../constants/theme";

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
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onPress}
      style={[styles.chip, active ? styles.activeChip : styles.inactiveChip, style]}
    >
      {icon}
      <Text style={[styles.text, active ? styles.activeText : styles.inactiveText, textStyle]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  chip: {
    minHeight: 38,
    borderRadius: Radii.full,
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
    marginBottom: 8,
    gap: 6,
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
