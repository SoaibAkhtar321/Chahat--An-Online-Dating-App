import React, { useMemo, useState } from "react";
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
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ArrowLeft, Plus, X, MapPin, Navigation, Compass } from "lucide-react-native";
import { Radii, Typography, ThemeColors } from "../../src/constants/theme";
import { useTheme } from "../../src/context/ThemeContext";
import { Input } from "../../src/components/ui/Input";
import { DatePicker } from "../../src/components/ui/DatePicker";
import { Slider, RangeSlider } from "../../src/components/ui/Slider";
import { Button } from "../../src/components/ui/Button";
import { Chip } from "../../src/components/ui/Chip";
import { PhotoUploader } from "../../src/components/profile/PhotoUploader";
import { useAuth } from "../../src/context/AuthContext";
import {
  validateDob,
  calculateAge,
  saveProfile,
  uploadProfilePhoto,
  requestPhotoModeration,
} from "../../src/services/profile";
import { INTERESTS, CITIES, PROMPTS, LANGUAGES, LIFESTYLE, PhotoItem } from "../../src/types";

const STEPS = [
  "name",
  "dob",
  "gender",
  "intents",
  "location",
  "work",
  "languages",
  "bio",
  "interests",
  "lifestyle",
  "photos",
  "prefs",
] as const;

export default function OnboardingScreen() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const router = useRouter();
  const { user, profile, refreshProfile } = useAuth();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Form states
  const [name, setName] = useState(profile?.name || "");
  const [dob, setDob] = useState(profile?.dob || ""); // YYYY-MM-DD
  const [gender, setGender] = useState<"man" | "woman" | "">(profile?.gender || "");
  const [seeking, setSeeking] = useState<"man" | "woman" | "">(profile?.seeking || "");
  const [intents, setIntents] = useState<string[]>(profile?.intents || []);
  const [city, setCity] = useState(profile?.city || "Mumbai");
  const [customCity, setCustomCity] = useState("");
  const [locStatus, setLocStatus] = useState<"idle" | "requesting" | "granted" | "denied">("idle");
  const [locMessage, setLocMessage] = useState("");
  const [work, setWork] = useState(profile?.work || "");
  const [education, setEducation] = useState(profile?.education || "");
  const [languages, setLanguages] = useState<string[]>(profile?.languages || ["English", "Hindi"]);
  const [bio, setBio] = useState(profile?.bio || "");
  const [promptQ, setPromptQ] = useState(profile?.prompt?.q || PROMPTS[0]!);
  const [promptA, setPromptA] = useState(profile?.prompt?.a || "");
  const [selectedInterests, setSelectedInterests] = useState<string[]>(
    profile?.interests || ["Travel", "Coffee", "Music"],
  );
  const [customInterest, setCustomInterest] = useState("");
  const [lifestyle, setLifestyle] = useState<Record<string, string>>(profile?.lifestyle || {});
  const [photos, setPhotos] = useState<PhotoItem[]>(profile?.photos || []);
  const [ageMin, setAgeMin] = useState(profile?.ageMin || 21);
  const [ageMax, setAgeMax] = useState(profile?.ageMax || 35);
  const [distance, setDistance] = useState(profile?.distance || 50);

  const totalSteps = STEPS.length;
  const currentKey = STEPS[step];

  const toggleArrayItem = (list: string[], item: string) => {
    return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
  };

  const handleAddCustomInterest = () => {
    const val = customInterest.trim();
    if (!val) return;
    if (selectedInterests.includes(val)) {
      setError("Already added");
      return;
    }
    setSelectedInterests([...selectedInterests, val]);
    setCustomInterest("");
    setError("");
  };

  const handleRequestCurrentLocation = async () => {
    setLocStatus("requesting");
    setLocMessage("Detecting your location…");

    if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          try {
            const { latitude, longitude } = position.coords;
            // Reverse geocode with OpenStreetMap Nominatim for real city name
            const res = await fetch(
              `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`
            );
            const data = await res.json();
            const detected =
              data.address?.city ||
              data.address?.town ||
              data.address?.village ||
              data.address?.suburb ||
              data.address?.county ||
              "Current Location";
            setCity(detected);
            setLocStatus("granted");
            setLocMessage(`Location detected: ${detected}`);
            setError("");
          } catch {
            setCity("Mumbai");
            setLocStatus("granted");
            setLocMessage("Location enabled. Defaulted to closest metro.");
          }
        },
        (err) => {
          setLocStatus("denied");
          setLocMessage("Location permission not granted. You can select or enter your city below.");
        },
        { timeout: 10000 }
      );
    } else {
      // Mobile native fallback or simulated permission
      setTimeout(() => {
        setLocStatus("granted");
        setLocMessage("Location permission granted.");
      }, 500);
    }
  };

  const handleAddCustomCity = () => {
    const trimmed = customCity.trim();
    if (!trimmed) return;
    setCity(trimmed);
    setCustomCity("");
    setError("");
  };

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
      case "intents":
        if (intents.length === 0) {
          setError("Please pick at least one intention");
          return false;
        }
        return true;
      case "location":
        if (!city) {
          setError("Please choose your city");
          return false;
        }
        return true;
      case "bio":
        if (bio.trim().length < 15) {
          setError("Write at least 15 characters about yourself");
          return false;
        }
        return true;
      case "interests":
        if (selectedInterests.length < 3) {
          setError("Pick at least 3 interests");
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
    if (step < totalSteps) {
      setStep(step + 1);
    }
  };

  const handleBack = () => {
    if (step > 0) {
      setStep(step - 1);
      setError("");
    }
  };

  const handleFinish = async () => {
    if (!user) {
      Alert.alert("Not signed in", "Please log in again to finish setting up your profile.");
      return;
    }
    setSaving(true);
    try {
      // Process and upload any new/local photos through the sanitized upload service
      const processedPhotos: PhotoItem[] = [];
      for (const p of photos) {
        if (p.uri && (p.uri.startsWith("file:") || p.uri.startsWith("blob:") || p.uri.startsWith("data:") || p.uri.startsWith("ph:"))) {
          try {
            const { path, thumbPath } = await uploadProfilePhoto(user.id, p.id, p.uri);
            processedPhotos.push({
              ...p,
              path,
              thumbPath,
              status: "approved",
            });
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

      const res = await saveProfile(
        {
          name,
          dob,
          gender,
          seeking,
          intents,
          city,
          work,
          education,
          languages,
          bio,
          prompt: { q: promptQ, a: promptA },
          interests: selectedInterests,
          lifestyle,
          photos: processedPhotos,
          ageMin,
          ageMax,
          distance,
          onboarded: true,
        },
        user.id,
      );

      if (!res.success) {
        Alert.alert("Error saving profile", res.error || "Unknown error");
        return;
      }

      // Ask the server to check the new photos (best effort; they stay hidden until approved).
      await Promise.race([
        requestPhotoModeration(),
        new Promise((resolve) => setTimeout(resolve, 15000)),
      ]);

      console.log("handleFinish: profile saved, refreshing");
      // Never let a slow/failed refresh trap the user on this screen: the profile is already saved.
      try {
        await Promise.race([
          refreshProfile(),
          new Promise((resolve) => setTimeout(resolve, 8000)),
        ]);
      } catch (refreshErr) {
        console.warn("handleFinish: refreshProfile failed", refreshErr);
      }
      console.log("handleFinish: navigating to discover");
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
            <Text style={styles.stepSubtitle}>Chahat connects genuine people looking for meaningful friendship and relationships.</Text>
            <View style={styles.chipRow}>
              <Chip
                label="Man"
                active={gender === "man"}
                onPress={() => {
                  setGender("man");
                  setSeeking("woman");
                }}
              />
              <Chip
                label="Woman"
                active={gender === "woman"}
                onPress={() => {
                  setGender("woman");
                  setSeeking("man");
                }}
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

      case "intents":
        return (
          <View>
            <Text style={styles.stepTitle}>What are you looking for?</Text>
            <Text style={styles.stepSubtitle}>
              People with matching intentions are prioritized in your discovery.
            </Text>
            <View style={styles.chipWrap}>
              {[
                "Serious relationship",
                "Long-term relationship",
                "Marriage-oriented",
                "Casual dating",
                "Don't know yet",
              ].map((intent) => (
                <Chip
                  key={intent}
                  label={intent}
                  active={intents.includes(intent)}
                  onPress={() => setIntents(toggleArrayItem(intents, intent))}
                />
              ))}
            </View>
          </View>
        );

      case "location":
        return (
          <View>
            <Text style={styles.stepTitle}>Where are you located?</Text>
            <Text style={styles.stepSubtitle}>
              Discovery is organized by city. Others only see approximate distance.
            </Text>

            {/* Current Location Permission Card */}
            <View style={styles.locationPermissionCard}>
              <View style={styles.locationIconWrap}>
                <Compass size={24} color={Colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.locationCardTitle}>Use Current Location</Text>
                <Text style={styles.locationCardDesc}>
                  We'll automatically detect your approximate area. Your exact address is never shared.
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={[
                styles.locDetectBtn,
                locStatus === "requesting" && styles.locDetectBtnDisabled,
              ]}
              onPress={handleRequestCurrentLocation}
              disabled={locStatus === "requesting"}
              activeOpacity={0.8}
            >
              <Navigation size={18} color={Colors.primaryForeground} style={{ marginRight: 8 }} />
              <Text style={styles.locDetectBtnText}>
                {locStatus === "requesting"
                  ? "Detecting location…"
                  : locStatus === "granted"
                  ? "Update Current Location"
                  : "Allow Current Location"}
              </Text>
            </TouchableOpacity>

            {locMessage ? (
              <View
                style={[
                  styles.locMessageBadge,
                  locStatus === "granted"
                    ? styles.locMessageBadgeSuccess
                    : styles.locMessageBadgeWarn,
                ]}
              >
                <MapPin
                  size={15}
                  color={locStatus === "granted" ? Colors.primary : Colors.mutedForeground}
                  style={{ marginRight: 6 }}
                />
                <Text
                  style={[
                    styles.locMessageText,
                    locStatus === "granted" && { color: Colors.primary, fontWeight: "600" },
                  ]}
                >
                  {locMessage}
                </Text>
              </View>
            ) : null}

            {/* Current Selected City display */}
            <View style={styles.selectedCityRow}>
              <Text style={styles.selectedCityLabel}>Selected location:</Text>
              <View style={styles.selectedCityBadge}>
                <MapPin size={14} color={Colors.primary} style={{ marginRight: 4 }} />
                <Text style={styles.selectedCityText}>{city || "None selected"}</Text>
              </View>
            </View>

            {/* Custom City Input */}
            <Text style={styles.locationSubheading}>Or enter your city / town</Text>
            <View style={styles.customRow}>
              <Input
                placeholder="e.g. Gurugram, Chandigarh, Goa…"
                value={customCity}
                onChangeText={setCustomCity}
                containerStyle={{ flex: 1, marginBottom: 0 }}
              />
              <TouchableOpacity onPress={handleAddCustomCity} style={styles.addBtn}>
                <Plus size={20} color={Colors.primaryForeground} />
              </TouchableOpacity>
            </View>

            {/* Popular Cities Grid */}
            <Text style={[styles.locationSubheading, { marginTop: 16 }]}>Popular cities</Text>
            <View style={styles.chipWrap}>
              {CITIES.map((c) => (
                <Chip key={c} label={c} active={city === c} onPress={() => setCity(c)} />
              ))}
            </View>
          </View>
        );

      case "work":
        return (
          <View>
            <Text style={styles.stepTitle}>Work & Education</Text>
            <Text style={styles.stepSubtitle}>
              Optional. Skip anything you prefer not to share.
            </Text>
            <Input
              label="Job title / Profession"
              placeholder="e.g. Architect, Software Engineer"
              value={work}
              onChangeText={setWork}
              maxLength={60}
            />
            <Input
              label="College / Education"
              placeholder="e.g. Delhi University, IIT Bombay"
              value={education}
              onChangeText={setEducation}
              maxLength={60}
            />
          </View>
        );

      case "languages":
        return (
          <View>
            <Text style={styles.stepTitle}>Languages you speak</Text>
            <Text style={styles.stepSubtitle}>
              Shown on your profile so matches can find common ground.
            </Text>
            <View style={styles.chipWrap}>
              {LANGUAGES.map((l) => (
                <Chip
                  key={l}
                  label={l}
                  active={languages.includes(l)}
                  onPress={() => setLanguages(toggleArrayItem(languages, l))}
                />
              ))}
            </View>
          </View>
        );

      case "bio":
        return (
          <View>
            <Text style={styles.stepTitle}>About you</Text>
            <Text style={styles.stepSubtitle}>
              A short bio and one prompt to start conversations.
            </Text>
            <Input
              placeholder="Weekend chai, treks in Sahyadris, laughing at bad jokes…"
              multiline
              numberOfLines={4}
              style={styles.bioInput}
              value={bio}
              onChangeText={setBio}
              maxLength={300}
            />
            <Text style={styles.charCount}>{bio.length}/300</Text>

            <Text style={styles.promptHeader}>Choose a prompt</Text>
            <View style={styles.chipWrap}>
              {PROMPTS.map((p) => (
                <Chip key={p} label={p} active={promptQ === p} onPress={() => setPromptQ(p)} />
              ))}
            </View>
            <Input
              placeholder="Your answer"
              value={promptA}
              onChangeText={setPromptA}
              maxLength={120}
              style={{ marginTop: 8 }}
            />
          </View>
        );

      case "interests":
        return (
          <View>
            <Text style={styles.stepTitle}>Your interests</Text>
            <Text style={styles.stepSubtitle}>Pick at least 3, or add a custom hobby.</Text>
            <View style={styles.chipWrap}>
              {INTERESTS.map((item) => (
                <Chip
                  key={item}
                  label={item}
                  active={selectedInterests.includes(item)}
                  onPress={() => setSelectedInterests(toggleArrayItem(selectedInterests, item))}
                />
              ))}
            </View>

            <Text style={styles.customHobbyHeader}>Add custom hobby</Text>
            <View style={styles.customRow}>
              <Input
                placeholder="e.g. Kathak, Chess, Gardening"
                value={customInterest}
                onChangeText={setCustomInterest}
                containerStyle={{ flex: 1, marginBottom: 0 }}
              />
              <TouchableOpacity onPress={handleAddCustomInterest} style={styles.addBtn}>
                <Plus size={20} color={Colors.primaryForeground} />
              </TouchableOpacity>
            </View>

            {selectedInterests.filter((i) => !INTERESTS.includes(i)).length > 0 && (
              <View style={styles.customChipsWrap}>
                {selectedInterests
                  .filter((i) => !INTERESTS.includes(i))
                  .map((custom) => (
                    <View key={custom} style={styles.customBadge}>
                      <Text style={styles.customBadgeText}>{custom}</Text>
                      <TouchableOpacity
                        onPress={() =>
                          setSelectedInterests(selectedInterests.filter((x) => x !== custom))
                        }
                      >
                        <X size={14} color={Colors.highlightForeground} />
                      </TouchableOpacity>
                    </View>
                  ))}
              </View>
            )}
          </View>
        );

      case "lifestyle":
        return (
          <View>
            <Text style={styles.stepTitle}>Lifestyle habits</Text>
            <Text style={styles.stepSubtitle}>Optional details about your day-to-day.</Text>
            {Object.entries(LIFESTYLE).map(([key, options]) => (
              <View key={key} style={styles.lifestyleGroup}>
                <Text style={styles.lifestyleLabel}>{key}</Text>
                <View style={styles.chipWrap}>
                  {options.map((opt) => (
                    <Chip
                      key={opt}
                      label={opt}
                      active={lifestyle[key] === opt}
                      onPress={() => {
                        setLifestyle((prev) => {
                          const copy = { ...prev };
                          if (copy[key] === opt) delete copy[key];
                          else copy[key] = opt;
                          return copy;
                        });
                      }}
                    />
                  ))}
                </View>
              </View>
            ))}
          </View>
        );

      case "photos":
        return (
          <View>
            <Text style={styles.stepTitle}>Add your photos</Text>
            <Text style={styles.stepSubtitle}>
              1 to 4 photos. Clear, recent photos work best. The star photo is your main one.
            </Text>
            <PhotoUploader photos={photos} onChange={setPhotos} />
          </View>
        );

      case "prefs":
        return (
          <View>
            <Text style={styles.stepTitle}>Discovery preferences</Text>
            <Text style={styles.stepSubtitle}>
              Adjust your preferred age and maximum distance filters using the sliders below.
            </Text>

            {/* Age Range Slider */}
            <View style={styles.sliderCard}>
              <RangeSlider
                label="Age Range"
                minVal={ageMin}
                maxVal={ageMax}
                min={18}
                max={60}
                unit="years"
                onChange={(newMin, newMax) => {
                  setAgeMin(newMin);
                  setAgeMax(newMax);
                }}
              />
            </View>

            {/* Distance Slider */}
            <View style={styles.sliderCard}>
              <Slider
                label="Maximum Distance"
                value={distance}
                min={5}
                max={150}
                step={5}
                unit="km"
                prefix="Up to "
                onChange={(newDistance) => {
                  setDistance(newDistance);
                }}
              />
            </View>
          </View>
        );

      default:
        return (
          <View>
            <Text style={styles.stepTitle}>Looking good, {name}!</Text>
            <Text style={styles.stepSubtitle}>Your Chahat profile is ready.</Text>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryName}>
                {name}, {calculateAge(dob)}
              </Text>
              <Text style={styles.summaryLocation}>
                {city} · {intents.join(", ")}
              </Text>
              {bio ? <Text style={styles.summaryBio}>{bio}</Text> : null}
              {promptA ? (
                <View style={styles.promptSummary}>
                  <Text style={styles.promptQText}>{promptQ}</Text>
                  <Text style={styles.promptAText}>{promptA}</Text>
                </View>
              ) : null}
            </View>
          </View>
        );
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardView}
      >
        <View style={styles.header}>
          <TouchableOpacity
            onPress={handleBack}
            disabled={step === 0}
            style={[styles.backBtn, step === 0 && { opacity: 0.3 }]}
          >
            <ArrowLeft size={20} color={Colors.foreground} />
          </TouchableOpacity>

          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.min(100, ((step + 1) / totalSteps) * 100)}%` },
              ]}
            />
          </View>

          <Text style={styles.stepCounter}>
            {step < totalSteps ? `${step + 1}/${totalSteps}` : "Done"}
          </Text>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {renderContent()}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </ScrollView>

        <View style={styles.footer}>
          {step < totalSteps ? (
            <Button title="Continue" onPress={handleNext} />
          ) : (
            <Button
              title={saving ? "Saving…" : "Start discovering"}
              onPress={handleFinish}
              loading={saving}
            />
          )}

          {["work", "languages", "lifestyle"].includes(currentKey) && step < totalSteps && (
            <TouchableOpacity onPress={() => setStep(step + 1)} style={styles.skipBtn}>
              <Text style={styles.skipText}>Skip</Text>
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (Colors: ThemeColors) => StyleSheet.create({
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
    fontWeight: Typography.weights.bold,
    color: Colors.mutedForeground,
  },
  content: {
    padding: 24,
    flexGrow: 1,
  },
  stepTitle: {
    fontSize: Typography.sizes.title,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
    fontFamily: Typography.fontDisplay,
    marginBottom: 8,
  },
  stepSubtitle: {
    fontSize: Typography.sizes.base,
    color: Colors.mutedForeground,
    lineHeight: 22,
    marginBottom: 24,
  },
  chipRow: {
    flexDirection: "row",
    gap: 8,
  },
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  seekingBox: {
    backgroundColor: Colors.secondary,
    padding: 16,
    borderRadius: Radii.lg,
    marginTop: 16,
  },
  seekingText: {
    fontSize: Typography.sizes.base,
    color: Colors.secondaryForeground,
  },
  ageBadge: {
    backgroundColor: Colors.secondary,
    padding: 12,
    borderRadius: Radii.md,
    marginTop: 8,
  },
  ageBadgeText: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.semibold,
    color: Colors.foreground,
  },
  bioInput: {
    height: 100,
    paddingTop: 12,
    textAlignVertical: "top",
  },
  charCount: {
    textAlign: "right",
    fontSize: Typography.sizes.xs,
    color: Colors.mutedForeground,
    marginTop: 4,
    marginBottom: 16,
  },
  promptHeader: {
    fontSize: Typography.sizes.base,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
    marginBottom: 8,
  },
  customHobbyHeader: {
    fontSize: Typography.sizes.base,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
    marginTop: 20,
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
  customChipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  customBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.highlight,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radii.full,
    gap: 6,
  },
  customBadgeText: {
    fontSize: Typography.sizes.sm,
    color: Colors.highlightForeground,
    fontWeight: Typography.weights.medium,
  },
  lifestyleGroup: {
    marginBottom: 16,
  },
  lifestyleLabel: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
    marginBottom: 6,
  },
  prefLabel: {
    fontSize: Typography.sizes.base,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
    marginBottom: 8,
  },
  sliderCard: {
    backgroundColor: Colors.card,
    borderRadius: Radii.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 16,
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
  summaryCard: {
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    marginTop: 12,
  },
  summaryName: {
    fontSize: Typography.sizes.xxl,
    fontWeight: Typography.weights.bold,
    fontFamily: Typography.fontDisplay,
    color: Colors.foreground,
  },
  summaryLocation: {
    fontSize: Typography.sizes.sm,
    color: Colors.mutedForeground,
    marginTop: 4,
  },
  summaryBio: {
    fontSize: Typography.sizes.base,
    color: Colors.foreground,
    marginTop: 12,
    lineHeight: 22,
  },
  promptSummary: {
    backgroundColor: Colors.secondary,
    padding: 12,
    borderRadius: Radii.md,
    marginTop: 12,
  },
  promptQText: {
    fontSize: Typography.sizes.xs,
    color: Colors.primary,
    fontWeight: Typography.weights.bold,
  },
  promptAText: {
    fontSize: Typography.sizes.base,
    fontFamily: Typography.fontDisplay,
    color: Colors.foreground,
    marginTop: 4,
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
  skipBtn: {
    alignItems: "center",
    marginTop: 12,
  },
  skipText: {
    fontSize: Typography.sizes.base,
    color: Colors.mutedForeground,
    fontWeight: Typography.weights.semibold,
  },
});
