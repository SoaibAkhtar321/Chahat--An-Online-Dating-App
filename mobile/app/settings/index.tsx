import React, { useRef, useState, useMemo } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { Alert } from "../../src/utils/alert";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { Radii, Shadows, Typography, ThemeColors } from "../../src/constants/theme";
import { useTheme } from "../../src/context/ThemeContext";
import { Header } from "../../src/components/ui/Header";
import { Toggle } from "../../src/components/ui/Toggle";
import { Dialog } from "../../src/components/ui/Dialog";
import { Input } from "../../src/components/ui/Input";
import { Button } from "../../src/components/ui/Button";
import { useAuth } from "../../src/context/AuthContext";
import { deleteUserAccount } from "../../src/services/auth";
import { runAccountDeletion } from "../../src/utils/deletionFlow";
import {
  getNotificationPreferences,
  openNotificationSettings,
  registerPushNotificationToken,
  saveNotificationPreferences,
  type NotificationPreferences,
} from "../../src/services/notifications";

export default function SettingsScreen() {
  const router = useRouter();
  const { profile, user, signOut } = useAuth();
  const { mode, colors, setMode } = useTheme();
  const Colors = colors;
  const styles = useMemo(() => createStyles(Colors), [Colors]);

  // Settings state
  const [showInDiscover, setShowInDiscover] = useState(true);
  const [showDistance, setShowDistance] = useState(true);
  const [showOnline, setShowOnline] = useState(true);
  const [readReceipts, setReadReceipts] = useState(true);

  // Notifications state
  const [notifMatches, setNotifMatches] = useState(true);
  const [notifMessages, setNotifMessages] = useState(true);
  const [notifLikes, setNotifLikes] = useState(true);

  React.useEffect(() => {
    if (!user?.id) return;
    getNotificationPreferences(user.id)
      .then((prefs) => {
        setNotifMatches(prefs.matches);
        setNotifMessages(prefs.messages);
        setNotifLikes(prefs.likes);
      })
      .catch((error) => Alert.alert("Notifications unavailable", error.message));
  }, [user?.id]);

  const updateNotificationPreferences = async (next: NotificationPreferences) => {
    if (!user?.id) {
      Alert.alert("Sign in required", "Sign in to update notification preferences.");
      return false;
    }
    const result = await saveNotificationPreferences(user.id, next);
    if (!result.success) {
      Alert.alert("Could not save setting", result.error || "Please try again.");
      return false;
    }
    return true;
  };

  const registerAfterEnable = async (enabled: boolean) => {
    if (!enabled || !user) return;
    const result = await registerPushNotificationToken(user.id);
    if (result.status === "permission_denied") {
      Alert.alert(
        "Notifications are off",
        "Enable notifications for Chahat in your device settings to receive new matches and messages.",
        [
          { text: "Not now", style: "cancel" },
          { text: "Open settings", onPress: () => openNotificationSettings() },
        ],
      );
    } else if (result.status === "error") {
      Alert.alert("Could not enable notifications", result.error);
    }
  };

  const handleToggleNotifMatches = async (val: boolean) => {
    if (
      await updateNotificationPreferences({
        matches: val,
        messages: notifMessages,
        likes: notifLikes,
      })
    ) {
      setNotifMatches(val);
      if (val) await registerAfterEnable(true);
    }
  };

  const handleToggleNotifMessages = async (val: boolean) => {
    if (
      await updateNotificationPreferences({
        matches: notifMatches,
        messages: val,
        likes: notifLikes,
      })
    ) {
      setNotifMessages(val);
      if (val) await registerAfterEnable(true);
    }
  };

  const handleToggleNotifLikes = async (val: boolean) => {
    if (
      await updateNotificationPreferences({
        matches: notifMatches,
        messages: notifMessages,
        likes: val,
      })
    ) {
      setNotifLikes(val);
      if (val) await registerAfterEnable(true);
    }
  };

  // Dialogs
  const [logoutVisible, setLogoutVisible] = useState(false);
  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const deletingRef = useRef(false);

  const handleDeleteAccount = () =>
    runAccountDeletion({
      confirmationText: deleteConfirmationText,
      inFlight: deletingRef,
      deleteAccount: deleteUserAccount,
      onUnconfirmed: () =>
        Alert.alert("Error", "Please type DELETE in all capital letters to confirm."),
      onStart: () => setIsDeleting(true),
      onSettled: () => setIsDeleting(false),
      onSuccess: (res) => {
        setDeleteStep(0);
        setDeleteConfirmationText("");
        Alert.alert(
          "Account deleted",
          "Your account and data have been removed." + (res.warning ? `\n\n${res.warning}` : ""),
        );
        router.replace("/(auth)/welcome");
      },
      onFailure: (message) => Alert.alert("Could not delete account", message),
    });

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Settings & Privacy" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Account Section */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>ACCOUNT</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Email</Text>
              <Text style={styles.rowValue}>{user?.email || "—"}</Text>
            </View>

            <TouchableOpacity
              style={styles.navRow}
              onPress={() => router.push("/onboarding")}
              activeOpacity={0.7}
            >
              <Text style={styles.rowLabel}>Discovery Preferences</Text>
              <ChevronRight size={18} color={Colors.mutedForeground} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.navRow}
              onPress={() => router.push("/onboarding")}
              activeOpacity={0.7}
            >
              <Text style={styles.rowLabel}>Edit Profile & Photos</Text>
              <ChevronRight size={18} color={Colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Appearance & Theme Section */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>APPEARANCE / थीम</Text>
          <View style={styles.card}>
            <View style={styles.themeRow}>
              {(["system", "light", "dark"] as const).map((tMode) => {
                const isActive = mode === tMode;
                const label = tMode === "system" ? "System" : tMode === "light" ? "Light" : "Dark";
                return (
                  <TouchableOpacity
                    key={tMode}
                    style={[
                      styles.themeOptionBtn,
                      isActive && { backgroundColor: colors.primary, borderColor: colors.primary },
                    ]}
                    onPress={() => setMode(tMode)}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.themeOptionText,
                        isActive && {
                          color: colors.primaryForeground,
                          fontWeight: Typography.weights.bold,
                        },
                      ]}
                    >
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        {/* Discovery & Privacy */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>DISCOVERY & PRIVACY</Text>
          <View style={styles.card}>
            <Toggle
              label="Show me in Discover"
              hint="When turned off, new people won't see your card."
              value={showInDiscover}
              onValueChange={setShowInDiscover}
            />
            <Toggle
              label="Show my distance"
              hint="Others only ever see approximate distance, never coordinates."
              value={showDistance}
              onValueChange={setShowDistance}
            />
            <Toggle
              label="Show online status"
              hint="Others won't see when you were last active."
              value={showOnline}
              onValueChange={setShowOnline}
            />
            <Toggle
              label="Read receipts"
              hint="Matches won't see when you've read messages."
              value={readReceipts}
              onValueChange={setReadReceipts}
            />
          </View>
        </View>

        {/* Notifications */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>NOTIFICATIONS</Text>
          <View style={styles.card}>
            <Toggle
              label="New matches"
              value={notifMatches}
              onValueChange={handleToggleNotifMatches}
            />
            <Toggle
              label="New messages"
              value={notifMessages}
              onValueChange={handleToggleNotifMessages}
            />
            <Toggle
              label="Likes received"
              value={notifLikes}
              onValueChange={handleToggleNotifLikes}
            />
            <TouchableOpacity
              style={styles.navRow}
              onPress={() => openNotificationSettings()}
              activeOpacity={0.7}
            >
              <Text style={styles.rowLabel}>Manage device notification permission</Text>
              <ChevronRight size={18} color={Colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Safety & Verification */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>SAFETY & VERIFICATION</Text>
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.navRow}
              onPress={() => router.push("/safety")}
              activeOpacity={0.7}
            >
              <Text style={styles.rowLabel}>Safety Centre & Guidelines</Text>
              <ChevronRight size={18} color={Colors.mutedForeground} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.navRow}
              onPress={() => router.push("/verification")}
              activeOpacity={0.7}
            >
              <Text style={styles.rowLabel}>Photo Verification Status</Text>
              <ChevronRight size={18} color={Colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Legal */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>LEGAL</Text>
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.navRow}
              onPress={() => router.push("/legal/terms")}
              activeOpacity={0.7}
            >
              <Text style={styles.rowLabel}>Terms of Service</Text>
              <ChevronRight size={18} color={Colors.mutedForeground} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.navRow}
              onPress={() => router.push("/legal/privacy")}
              activeOpacity={0.7}
            >
              <Text style={styles.rowLabel}>Privacy Policy</Text>
              <ChevronRight size={18} color={Colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Danger zone actions */}
        <View style={styles.actionSection}>
          <Button title="Log out" variant="ghost" onPress={() => setLogoutVisible(true)} />

          <TouchableOpacity style={styles.deleteBtn} onPress={() => setDeleteStep(1)}>
            <Text style={styles.deleteText}>Delete account</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Logout dialog */}
      <Dialog
        visible={logoutVisible}
        title="Log out?"
        body="Your profile and chats will stay saved to your account. You can log in on any device to continue."
        confirmText="Log out"
        danger
        onConfirm={async () => {
          setLogoutVisible(false);
          try {
            await signOut();
            router.replace("/(auth)/welcome");
          } catch (error) {
            Alert.alert(
              "Could not sign out securely",
              error instanceof Error
                ? error.message
                : "The device notification token could not be removed. Retry when connected.",
            );
          }
        }}
        onCancel={() => setLogoutVisible(false)}
      />

      {/* Step 1 Delete Dialog */}
      <Dialog
        visible={deleteStep === 1}
        title="Delete your account?"
        body="Your profile, photos, matches and messages will be permanently deleted, along with your sign-in. Some moderation records may be retained. This action cannot be reversed."
        confirmText="Continue"
        danger
        onConfirm={() => setDeleteStep(2)}
        onCancel={() => setDeleteStep(0)}
      />

      {/* Step 2 Type DELETE Dialog */}
      <Dialog
        visible={deleteStep === 2}
        title="Type DELETE to confirm"
        body="This will permanently delete your account."
        confirmText={isDeleting ? "Deleting…" : "Delete permanently"}
        danger
        onConfirm={handleDeleteAccount}
        onCancel={() => {
          if (isDeleting) return;
          setDeleteStep(0);
          setDeleteConfirmationText("");
        }}
      >
        <Input
          placeholder="DELETE"
          autoCapitalize="characters"
          value={deleteConfirmationText}
          onChangeText={setDeleteConfirmationText}
          containerStyle={{ marginVertical: 12 }}
        />
      </Dialog>
    </SafeAreaView>
  );
}

const createStyles = (Colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: Colors.background,
    },
    content: {
      padding: 20,
      paddingBottom: 40,
    },
    section: {
      marginBottom: 24,
    },
    sectionHeader: {
      fontSize: Typography.sizes.xs,
      fontWeight: Typography.weights.bold,
      color: Colors.mutedForeground,
      letterSpacing: 1,
      marginBottom: 8,
      paddingLeft: 4,
    },
    card: {
      backgroundColor: Colors.card,
      borderRadius: Radii.xl,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: Colors.border,
      ...Shadows.card,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderBottomWidth: 1,
      borderBottomColor: Colors.border,
    },
    navRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 15,
      paddingHorizontal: 16,
      borderBottomWidth: 1,
      borderBottomColor: Colors.border,
    },
    rowLabel: {
      fontSize: Typography.sizes.base,
      fontWeight: Typography.weights.medium,
      color: Colors.foreground,
    },
    rowValue: {
      fontSize: Typography.sizes.sm,
      color: Colors.mutedForeground,
    },
    actionSection: {
      marginTop: 8,
      gap: 16,
    },
    deleteBtn: {
      alignItems: "center",
      paddingVertical: 12,
    },
    deleteText: {
      fontSize: Typography.sizes.sm,
      fontWeight: Typography.weights.bold,
      color: Colors.destructive,
    },
    themeRow: {
      flexDirection: "row",
      padding: 12,
      gap: 8,
    },
    themeOptionBtn: {
      flex: 1,
      paddingVertical: 10,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: Radii.lg,
      borderWidth: 1,
      borderColor: Colors.border,
      backgroundColor: Colors.secondary,
    },
    themeOptionText: {
      fontSize: Typography.sizes.sm,
      fontWeight: Typography.weights.medium,
      color: Colors.foreground,
    },
  });
