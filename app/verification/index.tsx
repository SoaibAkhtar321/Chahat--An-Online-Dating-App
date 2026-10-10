import React, { useState } from "react";
import { View, Text, StyleSheet, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { BadgeCheck, Camera, Clock } from "lucide-react-native";
import { Colors, Radii, Typography } from "../../src/constants/theme";
import { Header } from "../../src/components/ui/Header";
import { Button } from "../../src/components/ui/Button";
import { useAuth } from "../../src/context/AuthContext";
import { saveProfile } from "../../src/services/profile";

export default function VerificationScreen() {
  const { user, profile, refreshProfile } = useAuth();
  const [selfieUri, setSelfieUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const status = profile?.verificationStatus || "none";

  const handleTakeSelfie = async () => {
    const { status: perm } = await ImagePicker.requestCameraPermissionsAsync();
    if (perm !== "granted") {
      Alert.alert("Camera permission", "Milo requires camera access for identity verification.");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setSelfieUri(result.assets[0].uri);
    }
  };

  const handleSubmit = async () => {
    if (!selfieUri || !user) return;
    setSubmitting(true);
    await saveProfile(
      {
        verificationStatus: "pending",
      },
      user.id,
    );
    setSubmitting(false);
    await refreshProfile();
    Alert.alert("Verification Submitted", "Your selfie has been submitted for review.");
  };

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Photo Verification" />

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
            <Text style={styles.title}>Get Verified on Milo</Text>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: 24,
    flex: 1,
    justifyContent: "center",
  },
  statusBox: {
    alignItems: "center",
    backgroundColor: Colors.card,
    padding: 32,
    borderRadius: Radii.xxl,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statusTitle: {
    fontSize: Typography.sizes.xl,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
    marginTop: 16,
  },
  statusDesc: {
    fontSize: Typography.sizes.sm,
    color: Colors.mutedForeground,
    textAlign: "center",
    marginTop: 8,
    lineHeight: 20,
  },
  box: {
    alignItems: "center",
    backgroundColor: Colors.card,
    padding: 24,
    borderRadius: Radii.xxl,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  title: {
    fontSize: Typography.sizes.xl,
    fontWeight: Typography.weights.bold,
    fontFamily: Typography.fontDisplay,
    color: Colors.foreground,
    marginTop: 12,
  },
  subtitle: {
    fontSize: Typography.sizes.sm,
    color: Colors.mutedForeground,
    textAlign: "center",
    marginTop: 8,
    lineHeight: 20,
    marginBottom: 20,
  },
  selfieWrapper: {
    width: 140,
    height: 140,
    borderRadius: Radii.full,
    overflow: "hidden",
    borderWidth: 3,
    borderColor: Colors.primary,
    marginBottom: 20,
  },
  selfie: {
    width: "100%",
    height: "100%",
  },
  actionBtn: {
    width: "100%",
  },
});
