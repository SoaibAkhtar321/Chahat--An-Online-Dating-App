import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { safeBack, hasUnsavedChanges } from "../../src/utils/navigation";
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
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { loadLocationSelection } from "../../src/services/locationSelection";
import {
  ArrowLeft,
  Check,
  Sparkles,
  Plus,
  Briefcase,
  GraduationCap,
  Globe,
  HeartHandshake,
  Heart,
  Smile,
  Zap,
  User,
  MapPin,
} from "lucide-react-native";
import { Radii, Shadows, Typography, ThemeColors } from "../../src/constants/theme";
import { useTheme } from "../../src/context/ThemeContext";
import { useAuth } from "../../src/context/AuthContext";
import { Input } from "../../src/components/ui/Input";
import { Button } from "../../src/components/ui/Button";
import { Chip } from "../../src/components/ui/Chip";
import { PhotoUploader } from "../../src/components/profile/PhotoUploader";
import { Alert } from "../../src/utils/alert";
import {
  saveProfile,
  removeUnreferencedProfilePhotos,
  uploadProfilePhoto,
  requestPhotoModeration,
} from "../../src/services/profile";
import { calculateProfileCompleteness } from "../../src/services/profilePolicy";
import { INTERESTS, PROMPTS, LANGUAGES, LIFESTYLE, PhotoItem } from "../../src/types";

const INTENTIONS = [
  "Long-term relationship",
  "Dating & Romance",
  "Casual dating",
  "Friendship",
  "Marriage / Matrimony",
];

export default function CompleteProfileScreen() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const router = useRouter();
  const { user, profile, refreshProfile } = useAuth();

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Editable profile state initialized from current profile
  const [name, setName] = useState(profile?.name || "");
  // Display only: the location is changed on the Location screen (server-authoritative), never edited as free text here.
  const [locationLabel, setLocationLabel] = useState(profile?.city || "");
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void loadLocationSelection().then((selection) => {
        if (active && selection?.city) setLocationLabel(selection.city);
      });
      return () => {
        active = false;
      };
    }, []),
  );
  const [bio, setBio] = useState(profile?.bio || "");
  const [promptQ, setPromptQ] = useState(profile?.prompt?.q || PROMPTS[0]!);
  const [promptA, setPromptA] = useState(profile?.prompt?.a || "");
  const [intents, setIntents] = useState<string[]>(profile?.intents || []);
  const [selectedInterests, setSelectedInterests] = useState<string[]>(profile?.interests || []);
  const [customInterest, setCustomInterest] = useState("");
  const [work, setWork] = useState(profile?.work || "");
  const [education, setEducation] = useState(profile?.education || "");
  const [languages, setLanguages] = useState<string[]>(profile?.languages || ["English", "Hindi"]);
  const [lifestyle, setLifestyle] = useState<Record<string, string>>(profile?.lifestyle || {});
  const [photos, setPhotos] = useState<PhotoItem[]>(profile?.photos || []);

  // Unsaved-changes guard shared by the header arrow and Android hardware/gesture back.
  const initialSnapshot = useRef<string | null>(null);
  const currentSnapshot = () => ({
    name, bio, promptQ, promptA, intents, selectedInterests, work, education, languages, lifestyle,
    photos: photos.map((ph) => ph.id || ph.uri),
  });
  useEffect(() => {
    initialSnapshot.current = JSON.stringify(currentSnapshot());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const requestExit = useCallback((): boolean => {
    if (saving) return true; // never leave mid-save
    const dirty =
      initialSnapshot.current !== null &&
      hasUnsavedChanges(initialSnapshot.current, JSON.stringify(currentSnapshot()));
    if (!dirty) {
      safeBack(router, "/(tabs)/me");
      return true;
    }
    Alert.alert("Discard changes?", "Your profile changes haven't been saved.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => safeBack(router, "/(tabs)/me") },
    ]);
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saving, router, name, bio, promptQ, promptA, intents, selectedInterests, work, education, languages, lifestyle, photos]);
  useHardwareBack(requestExit);
  const uploadedPhotoCache = useRef(new Map<string, PhotoItem>());

  // Calculate live completeness
  const previewProfile = useMemo(
    () => ({
      ...profile,
      name,
      bio,
      intents,
      interests: selectedInterests,
      work,
      education,
      lifestyle,
      languages,
      photos,
    }),
    [profile, name, bio, intents, selectedInterests, work, education, lifestyle, languages, photos],
  );

  const completeness = useMemo(
    () => calculateProfileCompleteness(previewProfile),
    [previewProfile],
  );

  const toggleArrayItem = (list: string[], item: string, max?: number) => {
    if (list.includes(item)) {
      return list.filter((x) => x !== item);
    }
    if (max && list.length >= max) {
      setError(`You can select up to ${max} options.`);
      return list;
    }
    setError("");
    return [...list, item];
  };

  const handleAddCustomInterest = () => {
    const val = customInterest.trim();
    if (!val) return;
    if (selectedInterests.includes(val)) {
      setError("Already added to your interests");
      return;
    }
    if (selectedInterests.length >= 15) {
      setError("Maximum 15 interests allowed");
      return;
    }
    setSelectedInterests([...selectedInterests, val]);
    setCustomInterest("");
    setError("");
  };

  const handleSave = async () => {
    if (!user) {
      Alert.alert("Not signed in", "Please log in again to save your profile changes.");
      return;
    }

    if (photos.length === 0) {
      Alert.alert("Photo required", "Your profile must have at least one photo.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      // Process any newly added local photos
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
            setSaving(false);
            return;
          }
        } else {
          processedPhotos.push(p);
        }
      }

      const res = await saveProfile(
        {
          name: name.trim() || profile?.name,
          dob: profile?.dob,
          gender: profile?.gender,
          seeking: profile?.seeking,
          // Authoritative city from the server, so a stale cached profile can never overwrite a newer location choice.
          city: (await loadLocationSelection().catch(() => null))?.city ?? profile?.city,
          bio: bio.trim(),
          prompt: { q: promptQ, a: promptA.trim() },
          intents,
          interests: selectedInterests,
          work: work.trim(),
          education: education.trim(),
          languages,
          lifestyle,
          photos: processedPhotos,
          onboarded: true,
        },
        user.id,
      );

      if (!res.success) {
        setError(res.error || "Could not save profile changes.");
        Alert.alert("Error saving profile", res.error || "Could not save profile.");
        setSaving(false);
        return;
      }

      // Cleanup stale photo objects
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
        console.warn("CompleteProfile: unused photo cleanup deferred", cleanupErr);
      }
      uploadedPhotoCache.current.clear();

      // Trigger moderation check for new photos
      void requestPhotoModeration().catch(() => {});

      // Refresh in-memory profile and notify user
      try {
        await refreshProfile();
      } catch (refreshErr) {
        console.warn("CompleteProfile: refreshProfile failed", refreshErr);
      }

      Alert.alert(
        "Profile updated! 🎉",
        "Your profile details have been saved successfully.",
        [{ text: "OK", onPress: () => safeBack(router) }],
      );
    } catch (err: any) {
      console.error("CompleteProfile save failed:", err);
      setError(err?.message || "An unexpected error occurred while saving.");
      Alert.alert("Something went wrong", err?.message || "Could not save your profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Top Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => requestExit()}
          style={styles.backButton}
          accessibilityLabel="Go back"
        >
          <ArrowLeft size={22} color={Colors.foreground} />
        </TouchableOpacity>
        <View style={styles.headerTitleCol}>
          <Text style={styles.headerTitle}>Complete Profile</Text>
          <Text style={styles.headerSubtitle}>Tell us more about yourself</Text>
        </View>
        <TouchableOpacity
          onPress={handleSave}
          disabled={saving}
          style={[styles.saveHeaderButton, saving && styles.buttonDisabled]}
        >
          <Text style={styles.saveHeaderText}>{saving ? "Saving…" : "Save"}</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Progress / Completeness Banner */}
          <View style={styles.progressCard}>
            <View style={styles.progressTopRow}>
              <View style={styles.progressIconWrap}>
                <Sparkles size={20} color={Colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.progressTitle}>
                  Profile {completeness.percentage}% Complete
                </Text>
                <Text style={styles.progressSubtitle}>
                  {completeness.percentage >= 90
                    ? "Your profile is in top shape! 🌟"
                    : "Complete your profile to receive up to 3x more matches!"}
                </Text>
              </View>
              <Text style={styles.progressPercent}>{completeness.percentage}%</Text>
            </View>

            <View style={styles.progressBarTrack}>
              <View
                style={[styles.progressBarFill, { width: `${completeness.percentage}%` }]}
              />
            </View>

            {completeness.missingItems.length > 0 && (
              <View style={styles.missingList}>
                <Text style={styles.missingHeader}>Add next:</Text>
                <View style={styles.missingChips}>
                  {completeness.missingItems.slice(0, 3).map((item) => (
                    <View key={item.key} style={styles.missingChip}>
                      <Text style={styles.missingChipText}>+ {item.label}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          {/* Section: Photos */}
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Smile size={18} color={Colors.primary} />
              <Text style={styles.sectionTitle}>Profile Photos</Text>
            </View>
            <Text style={styles.sectionDescription}>
              Add up to 6 photos. The first photo will be your main profile photo shown on Discovery.
            </Text>
            <PhotoUploader photos={photos} onChange={setPhotos} maxPhotos={6} />
          </View>

          {/* Section: Basic Details */}
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <User size={18} color={Colors.primary} />
              <Text style={styles.sectionTitle}>Basic Details</Text>
            </View>
            <Text style={styles.sectionDescription}>
              Your display name and city shown on your profile card. (Date of birth is verified for safety).
            </Text>
            <View style={styles.basicFieldGroup}>
              <Text style={styles.fieldLabel}>Display Name</Text>
              <Input
                value={name}
                onChangeText={setName}
                placeholder="First name"
                maxLength={40}
              />
            </View>
            <View style={[styles.basicFieldGroup, { marginTop: 12 }]}>
              <Text style={styles.fieldLabel}>City / Location</Text>
              <TouchableOpacity
                onPress={() => router.push("/settings/location")}
                accessibilityRole="button"
                accessibilityLabel="Change your location"
                activeOpacity={0.7}
              >
                <Text style={{ color: Colors.foreground, fontSize: Typography.sizes.base, paddingVertical: 12 }}>
                  {locationLabel || "Not set"}  ·  <Text style={{ color: Colors.primary }}>Change</Text>
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Section: About Me (Bio) */}
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Heart size={18} color={Colors.primary} />
              <Text style={styles.sectionTitle}>About Me (Bio)</Text>
            </View>
            <Text style={styles.sectionDescription}>
              Share a quick intro about your personality, passions, and what brings you to Chahat.
            </Text>
            <Input
              value={bio}
              onChangeText={setBio}
              placeholder="e.g. Chai lover, weekend trekker, and tech enthusiast looking for genuine connections..."
              multiline
              numberOfLines={4}
              maxLength={500}
              style={styles.bioInput}
            />
            <Text style={styles.charCount}>{bio.length}/500</Text>
          </View>

          {/* Section: Conversation Prompt */}
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Sparkles size={18} color={Colors.primary} />
              <Text style={styles.sectionTitle}>Profile Prompt</Text>
            </View>
            <Text style={styles.sectionDescription}>
              Pick a conversation starter question that others can answer when chatting with you.
            </Text>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.promptScroll}>
              {PROMPTS.map((q) => (
                <TouchableOpacity
                  key={q}
                  style={[styles.promptChip, promptQ === q && styles.promptChipActive]}
                  onPress={() => setPromptQ(q)}
                >
                  <Text
                    style={[
                      styles.promptChipText,
                      promptQ === q && styles.promptChipTextActive,
                    ]}
                  >
                    {q}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Input
              value={promptA}
              onChangeText={setPromptA}
              placeholder="Your answer to the prompt..."
              multiline
              numberOfLines={2}
              maxLength={500}
              style={{ marginTop: 8 }}
            />
          </View>

          {/* Section: Relationship Intentions */}
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <HeartHandshake size={18} color={Colors.primary} />
              <Text style={styles.sectionTitle}>What are you looking for?</Text>
            </View>
            <Text style={styles.sectionDescription}>
              Select your relationship intentions so we match you with like-minded members.
            </Text>
            <View style={styles.chipRow}>
              {INTENTIONS.map((intent) => {
                const active = intents.includes(intent);
                return (
                  <Chip
                    key={intent}
                    label={intent}
                    active={active}
                    onPress={() => setIntents(toggleArrayItem(intents, intent, 6))}
                  />
                );
              })}
            </View>
          </View>

          {/* Section: Interests & Hobbies */}
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Zap size={18} color={Colors.primary} />
              <Text style={styles.sectionTitle}>Interests & Hobbies</Text>
            </View>
            <Text style={styles.sectionDescription}>
              Pick what you enjoy doing in your free time (select up to 15).
            </Text>
            <View style={styles.chipRow}>
              {INTERESTS.map((item) => {
                const active = selectedInterests.includes(item);
                return (
                  <Chip
                    key={item}
                    label={item}
                    active={active}
                    onPress={() =>
                      setSelectedInterests(toggleArrayItem(selectedInterests, item, 15))
                    }
                  />
                );
              })}
            </View>

            {/* Custom Interest Input */}
            <View style={styles.customInterestRow}>
              <Input
                value={customInterest}
                onChangeText={setCustomInterest}
                placeholder="Add custom interest…"
                maxLength={40}
                style={{ flex: 1 }}
              />
              <Button
                title="Add"
                variant="outline"
                size="sm"
                onPress={handleAddCustomInterest}
                style={{ marginLeft: 8 }}
              />
            </View>
          </View>

          {/* Section: Work & Education */}
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Briefcase size={18} color={Colors.primary} />
              <Text style={styles.sectionTitle}>Work & Education</Text>
            </View>
            <Text style={styles.sectionDescription}>
              Help others understand your career and educational background.
            </Text>

            <View style={styles.inputWithIcon}>
              <Briefcase size={18} color={Colors.mutedForeground} style={{ marginRight: 8 }} />
              <Input
                value={work}
                onChangeText={setWork}
                placeholder="Job title or company (optional)"
                maxLength={80}
                style={{ flex: 1 }}
              />
            </View>

            <View style={[styles.inputWithIcon, { marginTop: 10 }]}>
              <GraduationCap size={18} color={Colors.mutedForeground} style={{ marginRight: 8 }} />
              <Input
                value={education}
                onChangeText={setEducation}
                placeholder="College or university (optional)"
                maxLength={80}
                style={{ flex: 1 }}
              />
            </View>
          </View>

          {/* Section: Languages */}
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Globe size={18} color={Colors.primary} />
              <Text style={styles.sectionTitle}>Languages You Speak</Text>
            </View>
            <Text style={styles.sectionDescription}>
              Select the languages you are comfortable chatting in.
            </Text>
            <View style={styles.chipRow}>
              {LANGUAGES.map((lang) => {
                const active = languages.includes(lang);
                return (
                  <Chip
                    key={lang}
                    label={lang}
                    active={active}
                    onPress={() => setLanguages(toggleArrayItem(languages, lang, 16))}
                  />
                );
              })}
            </View>
          </View>

          {/* Section: Lifestyle Habits */}
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Smile size={18} color={Colors.primary} />
              <Text style={styles.sectionTitle}>Lifestyle Habits</Text>
            </View>
            <Text style={styles.sectionDescription}>
              Share daily habits to discover people who match your lifestyle.
            </Text>

            {Object.entries(LIFESTYLE).map(([key, options]) => {
              const currentVal = lifestyle[key];
              const formatKey = key.charAt(0).toUpperCase() + key.slice(1);
              return (
                <View key={key} style={styles.lifestyleGroup}>
                  <Text style={styles.lifestyleLabel}>{formatKey}</Text>
                  <View style={styles.chipRow}>
                    {options.map((opt) => (
                      <Chip
                        key={opt}
                        label={opt}
                        active={currentVal === opt}
                        onPress={() =>
                          setLifestyle({
                            ...lifestyle,
                            [key]: currentVal === opt ? "" : opt,
                          })
                        }
                      />
                    ))}
                  </View>
                </View>
              );
            })}
          </View>

          {/* Bottom Save Action */}
          <View style={styles.bottomBar}>
            <Button
              title={saving ? "Saving Changes…" : "Save & Update Profile"}
              onPress={handleSave}
              loading={saving}
              size="lg"
            />
          </View>
        </ScrollView>
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
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: Colors.border,
      backgroundColor: Colors.background,
    },
    backButton: {
      padding: 6,
    },
    headerTitleCol: {
      flex: 1,
      marginLeft: 8,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: Colors.foreground,
    },
    headerSubtitle: {
      fontSize: 12,
      color: Colors.mutedForeground,
    },
    saveHeaderButton: {
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderRadius: Radii.full,
      backgroundColor: Colors.primary,
    },
    saveHeaderText: {
      fontSize: 14,
      fontWeight: "600",
      color: Colors.primaryForeground,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    scrollContent: {
      padding: 16,
      paddingBottom: 40,
    },
    progressCard: {
      backgroundColor: Colors.card,
      borderRadius: Radii.lg,
      padding: 16,
      marginBottom: 20,
      borderWidth: 1,
      borderColor: Colors.border,
      ...Shadows.card,
    },
    progressTopRow: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 10,
    },
    progressIconWrap: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: Colors.secondary,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 10,
    },
    progressTitle: {
      fontSize: 15,
      fontWeight: "700",
      color: Colors.foreground,
    },
    progressSubtitle: {
      fontSize: 12,
      color: Colors.mutedForeground,
      marginTop: 2,
    },
    progressPercent: {
      fontSize: 18,
      fontWeight: "800",
      color: Colors.primary,
      marginLeft: 8,
    },
    progressBarTrack: {
      height: 8,
      backgroundColor: Colors.secondary,
      borderRadius: 4,
      overflow: "hidden",
      marginVertical: 8,
    },
    progressBarFill: {
      height: "100%",
      backgroundColor: Colors.primary,
      borderRadius: 4,
    },
    missingList: {
      marginTop: 8,
    },
    missingHeader: {
      fontSize: 11,
      fontWeight: "600",
      color: Colors.mutedForeground,
      textTransform: "uppercase",
      marginBottom: 6,
    },
    missingChips: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
    },
    missingChip: {
      backgroundColor: Colors.secondary,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: Radii.full,
    },
    missingChipText: {
      fontSize: 11,
      fontWeight: "500",
      color: Colors.foreground,
    },
    errorText: {
      color: Colors.destructive,
      fontSize: 13,
      marginBottom: 12,
      textAlign: "center",
    },
    section: {
      backgroundColor: Colors.card,
      borderRadius: Radii.lg,
      padding: 16,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: Colors.border,
      ...Shadows.card,
    },
    sectionHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 4,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: Colors.foreground,
    },
    sectionDescription: {
      fontSize: 13,
      color: Colors.mutedForeground,
      marginBottom: 12,
      lineHeight: 18,
    },
    bioInput: {
      height: 90,
      textAlignVertical: "top",
    },
    charCount: {
      fontSize: 11,
      color: Colors.mutedForeground,
      textAlign: "right",
      marginTop: 4,
    },
    promptScroll: {
      marginBottom: 8,
    },
    promptChip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: Radii.full,
      backgroundColor: Colors.secondary,
      marginRight: 8,
    },
    promptChipActive: {
      backgroundColor: Colors.primary,
    },
    promptChipText: {
      fontSize: 12,
      fontWeight: "500",
      color: Colors.foreground,
    },
    promptChipTextActive: {
      color: Colors.primaryForeground,
    },
    chipRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    customInterestRow: {
      flexDirection: "row",
      alignItems: "center",
      marginTop: 10,
    },
    inputWithIcon: {
      flexDirection: "row",
      alignItems: "center",
    },
    lifestyleGroup: {
      marginBottom: 12,
    },
    lifestyleLabel: {
      fontSize: 13,
      fontWeight: "600",
      color: Colors.foreground,
      marginBottom: 6,
    },
    basicFieldGroup: {
      marginBottom: 4,
    },
    fieldLabel: {
      fontSize: 13,
      fontWeight: "600",
      color: Colors.foreground,
      marginBottom: 6,
    },
    bottomBar: {
      marginTop: 12,
      marginBottom: 20,
    },
  });
