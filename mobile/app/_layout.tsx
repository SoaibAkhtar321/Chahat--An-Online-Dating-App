import React, { useEffect } from "react";

// Safe isomorphic fallback to avoid server-side useLayoutEffect warnings
if (typeof window === "undefined") {
  React.useLayoutEffect = React.useEffect;
}
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "../src/context/AuthContext";
import { NotificationResponseHandler } from "../src/components/notifications/NotificationResponseHandler";
import { MiloProvider } from "../src/context/MiloContext";
import { ThemeProvider, useTheme } from "../src/context/ThemeContext";

// Show a visible error screen (with retry) instead of a blank screen when a route throws
export { ErrorBoundary } from "expo-router";

function RootNavigation() {
  const { isDark, colors } = useTheme();

  // Keep the native window background (visible behind screens and during
  // keyboard/resize transitions) in sync with the resolved theme.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.background).catch(() => {});
  }, [colors.background]);

  return (
    <>
      <StatusBar
        style={isDark ? "light" : "dark"}
        backgroundColor={colors.background}
      />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: "fade",
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="onboarding/index" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="(tabs)" options={{ animation: "fade" }} />
        <Stack.Screen name="chat/[id]" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="profile/[id]" options={{ animation: "slide_from_bottom" }} />
        <Stack.Screen
          name="match/[id]"
          options={{ animation: "fade", presentation: "modal" }}
        />
        <Stack.Screen name="settings/index" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="safety/index" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="verification/index" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="notifications/index" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="premium/index" options={{ animation: "slide_from_bottom" }} />
        <Stack.Screen name="calls/index" options={{ animation: "slide_from_right" }} />
        <Stack.Screen
          name="call/[id]"
          options={{ animation: "slide_from_bottom", presentation: "fullScreenModal" }}
        />
        <Stack.Screen name="explore/index" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="legal/terms" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="legal/privacy" options={{ animation: "slide_from_right" }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <MiloProvider>
            <NotificationResponseHandler />
            <RootNavigation />
          </MiloProvider>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
