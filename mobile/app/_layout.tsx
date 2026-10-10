import React from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "../src/context/AuthContext";
import { MiloProvider } from "../src/context/MiloContext";
import { Colors } from "../src/constants/theme";

// Show a visible error screen (with retry) instead of a blank screen when a route throws
export { ErrorBoundary } from "expo-router";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <MiloProvider>
          <StatusBar style="dark" backgroundColor={Colors.background} />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: Colors.background },
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
        </MiloProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
