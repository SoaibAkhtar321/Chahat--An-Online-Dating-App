import React from "react";
import { View, Text, StyleSheet, ViewStyle } from "react-native";
import { User } from "lucide-react-native";
import { useTheme } from "../../context/ThemeContext";

interface AvatarPlaceholderProps {
  name?: string;
  size?: number;
  style?: ViewStyle | ViewStyle[];
  showIcon?: boolean;
}

export const AvatarPlaceholder: React.FC<AvatarPlaceholderProps> = ({
  name,
  size = 64,
  style,
  showIcon = false,
}) => {
  const { colors: Colors } = useTheme();

  const getInitials = (n?: string) => {
    if (!n) return "?";
    const parts = n.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return n.slice(0, 2).toUpperCase();
  };

  const initials = getInitials(name);
  const fontSize = Math.max(12, Math.floor(size * 0.38));

  return (
    <View
      style={[
        styles.container,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: Colors.secondary,
          borderColor: Colors.border,
        },
        style,
      ]}
    >
      {showIcon || !name ? (
        <User size={Math.floor(size * 0.5)} color={Colors.mutedForeground} />
      ) : (
        <Text
          style={[
            styles.initials,
            {
              fontSize,
              color: Colors.foreground,
            },
          ]}
        >
          {initials}
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  initials: {
    fontWeight: "700",
    letterSpacing: 0.5,
  },
});
