import React from "react";
import { View, Text, Switch, StyleSheet, ViewStyle } from "react-native";
import { Colors, Typography } from "../../constants/theme";

interface ToggleProps {
  label: string;
  hint?: string;
  value: boolean;
  onValueChange: (val: boolean) => void;
  style?: ViewStyle;
}

export const Toggle: React.FC<ToggleProps> = ({ label, hint, value, onValueChange, style }) => {
  return (
    <View style={[styles.container, style]}>
      <View style={styles.textContainer}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: Colors.muted, true: Colors.primary }}
        thumbColor={Colors.card}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  textContainer: {
    flex: 1,
    paddingRight: 16,
  },
  label: {
    fontSize: Typography.sizes.base,
    fontWeight: Typography.weights.semibold,
    color: Colors.foreground,
  },
  hint: {
    fontSize: Typography.sizes.xs,
    color: Colors.mutedForeground,
    marginTop: 2,
  },
});
