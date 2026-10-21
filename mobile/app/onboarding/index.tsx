import React, { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { useHardwareBack } from "../../src/hooks/useHardwareBack";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Alert } from "../../src/utils/alert";
import { LocationPicker } from "../../src/components/location/LocationPicker";
import type { LocationSelection } from "../../src/services/locationSelectionPolicy";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { Radii, Typography, ThemeColors } from "../../src/constants/theme";
import { useTheme } from "../../src/context/ThemeContext";
import { Input } from "../../src/components/ui/Input";
import { DatePicker } from "../../src/components/ui/DatePicker";
import { Button } from "../../src/components/ui/Button";
import { Chip } from "../../src/components/ui/Chip";
import { PhotoUploader } from "../../src/components/profile/PhotoUploader";
import {
  VoiceIntroRecorder,
  type VoiceIntroValue,
} from "../../src/components/profile/VoiceIntroRecorder";
import {
  prepareVoiceIntroSave,
  removeVoiceIntroFiles,
  type VoiceIntroRef,
} from "../../src/services/voiceIntro";
import { useAuth } from "../../src/context/AuthContext";
import {
  validateDob,
  saveProfile,
  removeUnreferencedProfilePhotos,
  uploadProfilePhoto,
  requestPhotoModeration,
} from "../../src/services/profile";
import { PhotoItem } from "../../src/types";

// Streamlined essential onboarding: Name, DOB (18+), Gender/Seeking, Location, and Primary Photo.
// Optional details (Bio, Prompts, Interests, Work, Education, Languages, Lifestyle) are moved to
// the dedicated "Complete Profile" section accessible post-onboarding.
const STEPS = [
  "name",
  "dob",
  "gender",
  "location",
  "photos",
] as const;

export default function OnboardingScreen() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const router = useRouter();
  const { user, profile, refreshProfile } = useAuth();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Form states for essential onboarding
  const [name, setName] = useState(profile?.name || "");
  const [dob, setDob] = useState(profile?.dob || ""); // YYYY-MM-DD
  const [gender, setGender] = useState<"man" | "woman" | "">(profile?.gender || "");
  const [seeking, setSeeking] = useState<"man" | "woman" | "">(profile?.seeking || "");
  // The authoritative location selection comes from the server via LocationPicker. There is deliberately no default
  // city: until the member picks one (or uses their current location) this stays null and the step cannot continue.
  const [selection, setSelection] = useState<LocationSelection | null>(null);
  const city = selection?.city ?? "";
  const [photos, setPhotos] = useState<PhotoItem[]>(profile?.photos || []);
  const uploadedPhotoCache = useRef(new Map<string, PhotoItem>());
  // Optional voice intro, recorded under the photo step and uploaded with the profile.
  const [voiceIntro, setVoiceIntro] = useState<VoiceIntroValue>({ kind: "none" });
  const voiceUploadCache = useRef<{ uri: string; ref: VoiceIntroRef } | null>(null);

  const totalSteps = STEPS.length;
  const currentKey = STEPS[step];

  // If already onboarded, redirect smoothly to the Complete Profile screen
  useEffect(() => {
    if (profile?.onboarded) {
      router.replace("/profile/complete");
    }
  }, [profile?.onboarded, router]);

  const validateStep = (): boolean => {
    setError("");
    switch (currentKey) {
      case "name":
        if (name.trim().length < 2) {
          setError("Enter your first name (at least 2 letters)");
          return false;
        }
        return true;
      case "dob": {
        const val = validateDob(dob);
        if (!val.valid) {
          setError(val.error || "Please enter a valid date of birth (YYYY-MM-DD)");
          return false;
        }
        return true;
      }
      case "gender":
        if (!gender) {
          setError("Please select your gender");
          return false;
        }
        return true;
      case "location":
        if (!selection?.city) {
          setError("Please choose your city or use your current location");
          return false;
        }
        return true;
      case "photos":
        if (photos.length === 0) {
          setError("Please add at least one photo");
          return false;
        }
        return true;
      default:
        return true;
    }
  };

  const handleNext = () => {
    if (!validateStep()) return;
    if (step < totalSteps - 1) {
      setStep(step + 1);
    }
  };

  const handleBack = () => {
    if (step > 0) {
      setStep(step - 1);
      setError("");
    }
  };

  // Hardware/gesture back steps back through onboarding exactly like the on-screen arrow, and is
  // ignored while saving. On the first step it falls through to normal navigation.
  const onHardwareBack = useCallback((): boolean => {
    if (saving) return true;
    if (step > 0) {
      setStep((prev) => Math.max(0, prev - 1));
      setError("");
      return true;
    }
    return false;
  }, [saving, step]);
  useHardwareBack(onHardwareBack);

  const handleFinish = async () => {
    if (!validateStep()) return;
    if (!user) {
      Alert.alert("Not signed in", "Please log in again to finish setting up your profile.");
      return;
    }
    setSaving(true);
    try {
      // Process and upload any new/local photos through the sanitized upload service
      const processedPhotos: PhotoItem[] = [];
      for (const p of photos) {
        if (
          p.uri &&
          (p.uri.startsWith("file:") ||
            p.uri.startsWith("blob:") ||
            p.uri.startsWith("data:") ||
            p.uri.startsWith("ph:"))
        ) {
          try {
            const cacheKey = `${p.id}:${p.uri}`;
            const cached = uploadedPhotoCache.current.get(cacheKey);
            if (cached) {
              processedPhotos.push(cached);
            } else {
              const { path, thumbPath } = await uploadProfilePhoto(user.id, p.id, p.uri);
              const uploaded = {
                ...p,
                path,
                thumbPath,
                status: "pending" as const,
              };
              uploadedPhotoCache.current.set(cacheKey, uploaded);
              processedPhotos.push(uploaded);
            }
          } catch (uploadErr: any) {
            console.error("Failed to upload photo:", p.id, uploadErr);
            Alert.alert(
              "Photo upload failed",
              `Could not upload photo: ${uploadErr?.message || "Please check your connection and retry."}`,
            );
            return;
          }
        } else {
          processedPhotos.push(p);
        }
      }

      let voicePlan;
      try {
        voicePlan = await prepareVoiceIntroSave(user.id, voiceIntro, profile?.voiceIntroPath, voiceUploadCache);
      } catch (voiceErr: any) {
        Alert.alert(
          "Voice intro upload failed",
          `${voiceErr?.message || "Please check your connection and retry."} You can also skip the voice intro and add it later in Complete Profile.`,
        );
        return;
      }

      const res = await saveProfile(
        {
          name: name.trim(),
          dob,
          gender,
          seeking: seeking || (gender === "man" ? "woman" : "man"),
          city: city.trim(),
          photos: processedPhotos,
          ...voicePlan.fields,
          onboarded: true,
        },
        user.id,
      );

      if (!res.success) {
        Alert.alert("Error saving profile", res.error || "Unknown error");
        return;
      }

      const retainedPaths = new Set(
        processedPhotos.flatMap((photo) => [photo.path, photo.thumbPath]).filter(Boolean),
      );
      const oldPaths = (profile?.photos || []).flatMap((photo) => [photo.path, photo.thumbPath]);
      const uploadedPaths = [...uploadedPhotoCache.current.values()].flatMap((photo) => [
        photo.path,
        photo.thumbPath,
      ]);
      const stalePaths = [...oldPaths, ...uploadedPaths].filter(
        (path): path is string => !!path && !retainedPaths.has(path),
      );
      try {
        await removeUnreferencedProfilePhotos(user.id, stalePaths);
      } catch (cleanupErr) {
        console.warn("handleFinish: unused photo cleanup deferred", cleanupErr);
      }
      uploadedPhotoCache.current.clear();
      voiceUploadCache.current = null;
      void removeVoiceIntroFiles(user.id, voicePlan.staleAfterSave);

      // Ask the server to check the new photos
      await Promise.race([
        requestPhotoModeration(),
        new Promise((resolve) => setTimeout(resolve, 15000)),
      ]);

      try {
        await Promise.race([
          refreshProfile(),
          new Promise((resolve) => setTimeout(resolve, 8000)),
        ]);
      } catch (refreshErr) {
        console.warn("handleFinish: refreshProfile failed", refreshErr);
      }

      router.replace("/(tabs)/discover");
    } catch (err: any) {
      console.error("handleFinish failed", err);
      Alert.alert("Something went wrong", err?.message || "Could not finish setup.");
    } finally {
      setSaving(false);
    }
  };

  const renderContent = () => {
    switch (currentKey) {
      case "name":
        return (
          <View>
            <Text style={styles.stepTitle}>What's your first name?</Text>
            <Text style={styles.stepSubtitle}>This is how you'll appear on Chahat.</Text>
            <Input
              placeholder="First name"
              value={name}
              onChangeText={setName}
              maxLength={30}
              autoFocus
            />
          </View>
        );

      case "dob": {
        const isExistingDobSaved = !!profile?.dob;
        return (
          <View>
            <Text style={styles.stepTitle}>When's your birthday?</Text>
            <Text style={styles.stepSubtitle}>
              {isExistingDobSaved
                ? "Your date of birth is verified and saved on your account. To request an update, contact Chahat Support."
                : "Only your age is shown. Chahat is strictly 18+. Date of birth cannot be changed once saved."}
            </Text>
            <DatePicker
              value={dob}
              onChange={(newDob) => {
                if (!isExistingDobSaved) {
                  setDob(newDob);
                  setError("");
                }
              }}
              error={error}
            />
          </View>
        );
      }

      case "gender":
        return (
          <View>
            <Text style={styles.stepTitle}>I am a…</Text>
            <Text style={styles.stepSubtitle}>
              Chahat connects genuine people looking for meaningful friendship and relationships.
            </Text>
            <View style={styles.chipRow}>
              <Chip
                label="Man"
                active={gender === "man"}
                onPress={() => {
                  setGender("man");
                  if (!seeking) setSeeking("woman");
                }}
              />
              <Chip
                label="Woman"
                active={gender === "woman"}
                onPress={() => {
                  setGender("woman");
                  if (!seeking) setSeeking("man");
                }}
              />
            </View>

            <Text style={[styles.stepTitle, { fontSize: 16, marginTop: 24 }]}>Looking to meet…</Text>
            <View style={styles.chipRow}>
              <Chip
                label="Women"
                active={seeking === "woman"}
                onPress={() => setSeeking("woman")}
              />
              <Chip
                label="Men"
                active={seeking === "man"}
                onPress={() => setSeeking("man")}
              />
            </View>

            {seeking ? (
              <View style={styles.seekingBox}>
                <Text style={styles.seekingText}>
                  You'll be shown{" "}
                  <Text style={{ fontWeight: "bold" }}>
                    {seeking === "woman" ? "women" : "men"}
                  </Text>
                  .
                </Text>
              </View>
            ) : null}
          </View>
        );

      case "location":
        return (
          <View>
            <Text style={styles.stepSubtitle}>
              People are shown nearest first. Others only ever see an approximate distance, never your exact location.
            </Text>
            <LocationPicker onSelectionChange={setSelection} />
          </View>
        );

      case "photos":
        return (
          <View>
            <Text style={styles.stepTitle}>Add your profile photo</Text>
            <Text style={styles.stepSubtitle}>
              Profiles with genuine photos receive far more responses. You can add more photos anytime in Complete Profile.
            </Text>
            <PhotoUploader photos={photos} onChange={setPhotos} maxPhotos={6} />

            <Text style={[styles.stepTitle, { fontSize: 16, marginTop: 24 }]}>Add a voice intro (optional)</Text>
            <Text style={styles.stepSubtitle}>
              A few seconds of your voice helps people get a feel for you. Others can listen on Discover and on your profile. You can skip this and add it later in Complete Profile.
            </Text>
            <VoiceIntroRecorder value={voiceIntro} onChange={setVoiceIntro} disabled={saving} />
          </View>
        );

      default:
        return null;
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          {step > 0 ? (
            <TouchableOpacity onPress={handleBack} style={styles.backBtn} accessibilityLabel="Back">
              <ArrowLeft size={20} color={Colors.foreground} />
            </TouchableOpacity>
          ) : (
            <View style={{ width: 38 }} />
          )}

          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.min(100, ((step + 1) / totalSteps) * 100)}%` },
              ]}
            />
          </View>

          <Text style={styles.stepCounter}>
            {`${step + 1}/${totalSteps}`}
          </Text>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {renderContent()}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </ScrollView>

        <View style={styles.footer}>
          {step < totalSteps - 1 ? (
            <Button title="Continue" onPress={handleNext} size="lg" />
          ) : (
            <Button
              title={saving ? "Saving…" : "Finish & Start Exploring"}
              onPress={handleFinish}
              loading={saving}
              size="lg"
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (Colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: Colors.background,
    },
    keyboardView: {
      flex: 1,
    },
    header: {
      height: 56,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 20,
      gap: 12,
    },
    backBtn: {
      width: 38,
      height: 38,
      borderRadius: Radii.full,
      backgroundColor: Colors.card,
      borderWidth: 1,
      borderColor: Colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    progressBar: {
      flex: 1,
      height: 6,
      borderRadius: 3,
      backgroundColor: Colors.muted,
      overflow: "hidden",
    },
    progressFill: {
      height: "100%",
      backgroundColor: Colors.primary,
    },
    stepCounter: {
      fontSize: Typography.sizes.xs,
      fontWeight: Typography.weights.semibold,
      color: Colors.mutedForeground,
      width: 36,
      textAlign: "right",
    },
    content: {
      padding: 24,
      paddingBottom: 40,
    },
    stepTitle: {
      fontSize: Typography.sizes.xxl,
      fontWeight: Typography.weights.bold,
      fontFamily: Typography.fontDisplay,
      color: Colors.foreground,
      marginBottom: 8,
    },
    stepSubtitle: {
      fontSize: Typography.sizes.sm,
      color: Colors.mutedForeground,
      marginBottom: 24,
      lineHeight: 20,
    },
    chipRow: {
      flexDirection: "row",
      gap: 12,
    },
    chipWrap: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    seekingBox: {
      backgroundColor: Colors.secondary,
      padding: 14,
      borderRadius: Radii.md,
      marginTop: 20,
    },
    seekingText: {
      fontSize: Typography.sizes.sm,
      color: Colors.foreground,
    },
    locationPermissionCard: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: Colors.card,
      padding: 16,
      borderRadius: Radii.lg,
      borderWidth: 1,
      borderColor: Colors.border,
      marginBottom: 12,
      gap: 12,
    },
    locationIconWrap: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: Colors.secondary,
      alignItems: "center",
      justifyContent: "center",
    },
    locationCardTitle: {
      fontSize: Typography.sizes.base,
      fontWeight: Typography.weights.bold,
      color: Colors.foreground,
    },
    locationCardDesc: {
      fontSize: Typography.sizes.xs,
      color: Colors.mutedForeground,
      marginTop: 2,
      lineHeight: 16,
    },
    locDetectBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: Colors.primary,
      paddingVertical: 12,
      paddingHorizontal: 20,
      borderRadius: Radii.md,
      marginBottom: 12,
    },
    locDetectBtnDisabled: {
      opacity: 0.6,
    },
    locDetectBtnText: {
      color: Colors.primaryForeground,
      fontSize: Typography.sizes.base,
      fontWeight: Typography.weights.semibold,
    },
    locMessageBadge: {
      flexDirection: "row",
      alignItems: "center",
      padding: 10,
      borderRadius: Radii.md,
      marginBottom: 12,
    },
    locMessageBadgeSuccess: {
      backgroundColor: Colors.primary + "1A",
      borderWidth: 1,
      borderColor: Colors.primary,
    },
    locMessageBadgeWarn: {
      backgroundColor: Colors.secondary,
    },
    locMessageText: {
      fontSize: Typography.sizes.xs,
      color: Colors.mutedForeground,
      flex: 1,
    },
    selectedCityRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: Colors.card,
      padding: 12,
      borderRadius: Radii.md,
      borderWidth: 1,
      borderColor: Colors.border,
      marginBottom: 16,
    },
    selectedCityLabel: {
      fontSize: Typography.sizes.sm,
      color: Colors.mutedForeground,
    },
    selectedCityBadge: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: Colors.secondary,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: Radii.full,
    },
    selectedCityText: {
      fontSize: Typography.sizes.sm,
      fontWeight: Typography.weights.bold,
      color: Colors.foreground,
    },
    locationSubheading: {
      fontSize: Typography.sizes.sm,
      fontWeight: Typography.weights.semibold,
      color: Colors.foreground,
      marginBottom: 8,
    },
    customRow: {
      flexDirection: "row",
      gap: 8,
      alignItems: "center",
    },
    addBtn: {
      width: 50,
      height: 50,
      borderRadius: Radii.md,
      backgroundColor: Colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    errorText: {
      color: Colors.destructive,
      fontSize: Typography.sizes.sm,
      marginTop: 12,
      textAlign: "center",
      fontWeight: Typography.weights.medium,
    },
    footer: {
      padding: 24,
      borderTopWidth: 1,
      borderTopColor: Colors.border,
      backgroundColor: Colors.card,
    },
  });
