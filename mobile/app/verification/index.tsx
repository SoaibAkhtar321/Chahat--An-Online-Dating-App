import React, { useState, useMemo, useCallback } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Alert } from "../../src/utils/alert";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { BadgeCheck, Camera, Clock } from "lucide-react-native";
import { Radii, Typography, ThemeColors, Spacing } from "../../src/constants/theme";
import { useTheme } from "../../src/context/ThemeContext";
import { Header } from "../../src/components/ui/Header";
import { Button } from "../../src/components/ui/Button";
import { useAuth } from "../../src/context/AuthContext";
import { saveProfile, uploadVerificationSelfie } from "../../src/services/profile";
import { pushNotificationToInbox } from "../../src/services/notifications";
import { useHardwareBack } from "../../src/hooks/useHardwareBack";
import { safeBack } from "../../src/utils/navigation";
import { Redirect } from "expo-router";
import { VERIFICATION_ENABLED } from "../../src/constants/features";

// Selfie verification is switched off until there is a reviewer (see src/constants/features.ts); old links land on Me.
export default function VerificationRoute() {
  return VERIFICATION_ENABLED ? <VerificationScreen /> : <Redirect href="/(tabs)/me" />;
}

function VerificationScreen() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const { user, profile, refreshProfile } = useAuth();
  const [selfieUri, setSelfieUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const status = profile?.verificationStatus || "none";
  const router = useRouter();

  // Header back and hardware/gesture back share this: blocked while uploading, and a taken-but-unsent selfie asks first.
  const requestExit = useCallback((): boolean => {
    if (submitting) return true;
    if (selfieUri && status !== "pending" && status !== "approved") {
      Alert.alert("Discard selfie?", "Your selfie has not been submitted for review.", [
        { text: "Keep editing", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: () => safeBack(router, "/(tabs)/me") },
      ]);
      return true;
    }
    safeBack(router, "/(tabs)/me");
    return true;
  }, [submitting, selfieUri, status, router]);
  useHardwareBack(requestExit);

  const handleTakeSelfie = async () => {
    try {
      const { status: perm } = await ImagePicker.requestCameraPermissionsAsync();
      if (perm !== "granted") {
        Alert.alert(
          "Camera permission required",
          "Chahat needs camera access to capture your verification selfie and ensure genuine profiles.",
        );
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        cameraType: ImagePicker.CameraType.front,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        setSelfieUri(result.assets[0].uri);
      }
    } catch (camErr: any) {
      console.warn("Camera launch encountered error, offering gallery fallback:", camErr);
      Alert.alert(
        "Camera Unavailable",
        "Could not open device camera directly. Would you like to select a recent selfie from your photo library instead?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Choose Selfie",
            onPress: async () => {
              const pickRes = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ["images"],
                allowsEditing: true,
                aspect: [1, 1],
                quality: 0.8,
              });
              if (!pickRes.canceled && pickRes.assets[0]) {
                setSelfieUri(pickRes.assets[0].uri);
              }
            },
          },
        ],
      );
    }
  };

  const handleSubmit = async () => {
    if (!selfieUri || !user) return;
    setSubmitting(true);
    try {
      // Upload selfie photo to secure storage under verification directory
      try {
        await uploadVerificationSelfie(user.id, selfieUri);
      } catch (uploadErr) {
        console.error("Selfie upload failed:", uploadErr);
        Alert.alert(
          "Upload failed",
          uploadErr instanceof Error
            ? uploadErr.message
            : "Your selfie could not be uploaded. Check your connection and try again.",
        );
        return;
      }

      const res = await saveProfile(
        {
          verificationStatus: "pending",
        },
        user.id,
      );

      if (!res.success) {
        Alert.alert("Submission error", res.error || "Could not submit verification at this time.");
        return;
      }

      await refreshProfile();
      void pushNotificationToInbox(user.id, {
        kind: "safety",
        title: "Verification Under Review",
        text: "Your selfie photo has been submitted. Our team will review your badge shortly.",
      }).catch((notificationError) => {
        console.warn("Could not add verification notice to the inbox:", notificationError);
      });

      Alert.alert("Verification Submitted", "Your selfie has been submitted for review.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Photo Verification" onBackPress={requestExit} />

      <View style={styles.content}>
        {status === "approved" ? (
          <View style={styles.statusBox}>
            <BadgeCheck size={56} color={Colors.success} />
            <Text style={styles.statusTitle}>Profile Verified</Text>
            <Text style={styles.statusDesc}>
              Your photos have been verified. Other members can see your verified badge.
            </Text>
          </View>
        ) : status === "pending" ? (
          <View style={styles.statusBox}>
            <Clock size={56} color={Colors.accent} />
            <Text style={styles.statusTitle}>Verification in Review</Text>
            <Text style={styles.statusDesc}>
              Your selfie has been submitted and is currently being reviewed. This usually takes
              under 24 hours.
            </Text>
          </View>
        ) : (
          <View style={styles.box}>
            <BadgeCheck size={48} color={Colors.primary} />
            <Text style={styles.title}>Get Verified on Chahat</Text>
            <Text style={styles.subtitle}>
              Take a quick selfie to confirm your identity. Verified profiles receive up to 3x more
              matches.
            </Text>

            {selfieUri ? (
              <View style={styles.selfieWrapper}>
                <Image source={{ uri: selfieUri }} style={styles.selfie} contentFit="cover" />
              </View>
            ) : null}

            <Button
              title={selfieUri ? "Retake selfie" : "Take a selfie"}
              variant={selfieUri ? "ghost" : "primary"}
              icon={
                <Camera
                  size={18}
                  color={selfieUri ? Colors.foreground : Colors.primaryForeground}
                />
              }
              onPress={handleTakeSelfie}
              style={styles.actionBtn}
            />

            {selfieUri ? (
              <Button
                title={submitting ? "Submitting…" : "Submit for review"}
                onPress={handleSubmit}
                loading={submitting}
                style={[styles.actionBtn, { marginTop: 10 }]}
              />
            ) : null}
          </View>
        )}
      </View>
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
      padding: Spacing.xl,
      flex: 1,
      justifyContent: "center",
    },
    statusBox: {
      alignItems: "center",
      backgroundColor: Colors.card,
      padding: Spacing.xxl,
      borderRadius: Radii.xxl,
      borderWidth: 1,
      borderColor: Colors.border,
    },
    statusTitle: {
      fontSize: Typography.sizes.xl,
      fontWeight: Typography.weights.bold,
      color: Colors.foreground,
      marginTop: Spacing.lg,
    },
    statusDesc: {
      fontSize: Typography.sizes.sm,
      color: Colors.mutedForeground,
      textAlign: "center",
      marginTop: Spacing.sm,
      lineHeight: 20,
    },
    box: {
      alignItems: "center",
      backgroundColor: Colors.card,
      padding: Spacing.xl,
      borderRadius: Radii.xxl,
      borderWidth: 1,
      borderColor: Colors.border,
    },
    title: {
      fontSize: Typography.sizes.xl,
      fontWeight: Typography.weights.bold,
      fontFamily: Typography.fontDisplay,
      color: Colors.foreground,
      marginTop: Spacing.md,
    },
    subtitle: {
      fontSize: Typography.sizes.sm,
      color: Colors.mutedForeground,
      textAlign: "center",
      marginTop: Spacing.sm,
      lineHeight: 20,
      marginBottom: Spacing.lg,
    },
    selfieWrapper: {
      width: 140,
      height: 140,
      borderRadius: Radii.full,
      overflow: "hidden",
      borderWidth: 3,
      borderColor: Colors.primary,
      marginBottom: Spacing.lg,
    },
    selfie: {
      width: "100%",
      height: "100%",
    },
    actionBtn: {
      width: "100%",
    },
  });
