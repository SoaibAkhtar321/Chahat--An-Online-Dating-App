import React from "react";
import { Tabs } from "expo-router";
import { Compass, Heart, MessageCircle, User } from "lucide-react-native";
import { Typography } from "../../src/constants/theme";
import { useTheme } from "../../src/context/ThemeContext";
import { useMilo } from "../../src/context/MiloContext";
import { PushSetup } from "../../src/components/notifications/PushSetup";

export default function TabsLayout() {
  const { totalUnreadCount } = useMilo();
  const { colors: Colors } = useTheme();

  return (
    <>
    <PushSetup />
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.mutedForeground,
        tabBarStyle: {
          backgroundColor: Colors.card,
          borderTopColor: Colors.border,
          borderTopWidth: 1,
          height: 64,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontSize: Typography.sizes.xs,
          fontWeight: Typography.weights.semibold,
        },
      }}
    >
      <Tabs.Screen
        name="discover"
        options={{
          title: "Discover",
          tabBarIcon: ({ color, size }) => <Compass size={size} color={color} strokeWidth={2.2} />,
        }}
      />
      <Tabs.Screen
        name="likes"
        options={{
          title: "Likes",
          tabBarIcon: ({ color, size }) => <Heart size={size} color={color} strokeWidth={2.2} />,
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: "Chats",
          tabBarBadge: totalUnreadCount > 0 ? totalUnreadCount : undefined,
          tabBarBadgeStyle: {
            backgroundColor: Colors.primary,
            color: Colors.primaryForeground,
            fontSize: 10,
          },
          tabBarIcon: ({ color, size }) => (
            <MessageCircle size={size} color={color} strokeWidth={2.2} />
          ),
        }}
      />
      <Tabs.Screen
        name="me"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }) => <User size={size} color={color} strokeWidth={2.2} />,
        }}
      />
    </Tabs>
    </>
  );
}
