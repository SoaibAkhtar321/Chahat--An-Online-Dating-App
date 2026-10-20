import React, { useMemo } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Header } from "../../src/components/ui/Header";
import { LocationPicker } from "../../src/components/location/LocationPicker";
import { useTheme } from "../../src/context/ThemeContext";
import { safeBack } from "../../src/utils/navigation";
import { ThemeColors } from "../../src/constants/theme";

// Every change on this screen is saved immediately and atomically on the server, so there is no local draft:
// header back and Android hardware/gesture back both simply leave (Stack default), and nothing can be half-saved.
export default function LocationSettingsScreen() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const router = useRouter();
  return (
    <SafeAreaView style={styles.container}>
      <Header title="Location" onBackPress={() => safeBack(router, "/settings")} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <LocationPicker />
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (Colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
    content: { padding: 20, paddingBottom: 48 },
  });
