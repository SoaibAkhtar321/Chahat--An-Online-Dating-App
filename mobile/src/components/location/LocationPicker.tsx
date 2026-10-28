import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Compass, MapPin, Search } from "lucide-react-native";
import { Radii, Typography, ThemeColors, Spacing } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { Input } from "../ui/Input";
import { ensureConsent } from "../../services/consent";
import {
  describeSelectionResult,
  isRetryable,
  loadLocationSelection,
  searchCities,
  selectCityManually,
  selectCurrentLocation,
  type SelectionResult,
} from "../../services/locationSelection";
import {
  describeMode,
  describeSearchResult,
  describeSelection,
  prepareSearchQuery,
  type CitySearchResult,
  type LocationSelection,
} from "../../services/locationSelectionPolicy";

interface Props {
  /** Called with the authoritative server selection after load and after every successful change. */
  onSelectionChange?: (selection: LocationSelection | null) => void;
}

export const SEARCH_DEBOUNCE_MS = 300;

type SearchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "results"; results: CitySearchResult[] }
  | { kind: "error"; message: string };

async function openLocationSettings(): Promise<void> {
  if (Platform.OS === "android") {
    try {
      await Linking.sendIntent("android.settings.LOCATION_SOURCE_SETTINGS");
      return;
    } catch {
      // fall through to the app's settings page
    }
  }
  await Linking.openSettings();
}

/**
 * The single "Your location" control used by onboarding and Settings. Exactly two ways to set a location:
 * "Search City" (server-side search over every Indian city/town) and "Use My Current Location". The server owns
 * the state: this component only renders it and asks for changes through selectCityManually / selectCurrentLocation,
 * so the two modes can never overwrite each other or leave a stale pair. There is no default city.
 */
export function LocationPicker({ onSelectionChange }: Props) {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const [selection, setSelection] = useState<LocationSelection | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ kind: "idle" });
  const [busy, setBusy] = useState<"current" | "manual" | null>(null);
  const [lastResult, setLastResult] = useState<SelectionResult | null>(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const searchSeq = useRef(0);
  const onChange = useRef(onSelectionChange);
  onChange.current = onSelectionChange;

  const refresh = useCallback(async () => {
    const next = await loadLocationSelection();
    if (!mounted.current) return;
    setSelection(next);
    setLoadState(next ? "ready" : "error");
    onChange.current?.(next);
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  // Debounced server search. Only the latest request may update the list (no out-of-order results).
  const runSearch = useCallback((text: string) => {
    const seq = ++searchSeq.current;
    if (!prepareSearchQuery(text)) {
      setSearch({ kind: "idle" });
      return undefined;
    }
    setSearch({ kind: "loading" });
    const timer = setTimeout(async () => {
      const res = await searchCities(text);
      if (!mounted.current || seq !== searchSeq.current) return;
      if (res.status === "ok") setSearch({ kind: "results", results: res.results });
      else if (res.status === "error") setSearch({ kind: "error", message: res.message });
      else setSearch({ kind: "idle" });
    }, SEARCH_DEBOUNCE_MS);
    return timer;
  }, []);

  useEffect(() => {
    const timer = runSearch(query);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [query, runSearch]);

  const run = async (kind: "current" | "manual", action: () => Promise<SelectionResult>) => {
    if (busyRef.current) return; // one change at a time; ignores double taps
    busyRef.current = true;
    setBusy(kind);
    setLastResult(null);
    try {
      const result = await action();
      if (!mounted.current) return;
      setLastResult(result);
      if (result.status === "saved") {
        setQuery("");
        await refresh();
      }
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(null);
    }
  };

  const useCurrent = () =>
    run("current", async () => {
      if (!(await ensureConsent("location_discovery"))) return { status: "consent_required" };
      return selectCurrentLocation();
    });

  const chooseCity = (name: string) => run("manual", () => selectCityManually(name));

  const disabled = busy !== null;
  const current = selection?.city && selection.mode === "current";
  const manual = selection?.city && selection.mode === "manual";
  const trimmed = query.trim();
  const message = lastResult ? describeSelectionResult(lastResult) : "";
  const needsAppSettings = lastResult?.status === "permission_denied" && !lastResult.canAskAgain;
  const needsLocationSettings = lastResult?.status === "services_disabled";
  const canRetry = lastResult !== null && lastResult.status !== "saved" && isRetryable(lastResult);

  return (
    <View>
      <Text style={styles.title}>Your location</Text>
      <View style={styles.selectedRow} accessibilityLiveRegion="polite">
        <MapPin size={16} color={Colors.primary} style={{ marginRight: 6 }} />
        <Text style={styles.selectedText}>
          {loadState === "loading" ? "Loading…" : loadState === "error" ? "Couldn't load your location" : describeSelection(selection)}
        </Text>
      </View>
      {loadState === "ready" ? <Text style={styles.modeText}>{describeMode(selection)}</Text> : null}
      {loadState === "error" ? (
        <TouchableOpacity onPress={() => void refresh()} style={styles.linkBtn} accessibilityRole="button">
          <Text style={styles.linkText}>Try again</Text>
        </TouchableOpacity>
      ) : null}

      {/* Option 1: Search City */}
      <View style={[styles.card, manual ? styles.cardActive : null]}>
        <View style={styles.cardHead}>
          <Search size={22} color={Colors.primary} />
          <Text style={styles.cardTitle}>Search City{manual ? " (active)" : ""}</Text>
        </View>
        <Input
          placeholder="Type your city or town, e.g. Gorakhpur"
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="words"
          containerStyle={{ marginBottom: 8 }}
          editable={!disabled}
          accessibilityLabel="Search City"
        />
        {trimmed.length === 1 ? <Text style={styles.cardDesc}>Keep typing…</Text> : null}
        {search.kind === "loading" ? <ActivityIndicator color={Colors.primary} style={{ marginVertical: 8 }} /> : null}
        {search.kind === "error" ? (
          <View>
            <Text style={styles.cardDesc}>{search.message}</Text>
            <TouchableOpacity onPress={() => runSearch(query)} style={styles.linkBtn} accessibilityRole="button">
              <Text style={styles.linkText}>Retry search</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {search.kind === "results" && search.results.length === 0 ? (
          <Text style={styles.cardDesc}>No city or town in India matches “{trimmed}”. Check the spelling.</Text>
        ) : null}
        {search.kind === "results"
          ? search.results.map((c) => {
              const sub = describeSearchResult(c);
              return (
                <TouchableOpacity
                  key={c.name}
                  style={styles.resultRow}
                  onPress={() => void chooseCity(c.name)}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel={`Select ${c.name}${sub ? `, ${sub}` : ""}`}
                >
                  <MapPin size={16} color={Colors.mutedForeground} style={{ marginRight: 8 }} />
                  <View style={{ flexShrink: 1 }}>
                    <Text style={styles.resultText}>{c.name}</Text>
                    {sub ? <Text style={styles.resultSub}>{sub}</Text> : null}
                  </View>
                </TouchableOpacity>
              );
            })
          : null}
        {busy === "manual" ? <ActivityIndicator color={Colors.primary} style={{ marginTop: 8 }} /> : null}
      </View>

      {/* Option 2: Use My Current Location */}
      <View style={[styles.card, current ? styles.cardActive : null]}>
        <View style={styles.cardHead}>
          <Compass size={22} color={Colors.primary} />
          <Text style={styles.cardTitle}>Use My Current Location{current ? " (active)" : ""}</Text>
        </View>
        <Text style={styles.cardDesc}>
          We get a fresh location fix and match it to your town. Your exact position is never shared.
        </Text>
        <TouchableOpacity
          style={[styles.primaryBtn, disabled && styles.btnDisabled]}
          onPress={() => void useCurrent()}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel="Use My Current Location"
        >
          {busy === "current" ? (
            <ActivityIndicator color={Colors.primaryForeground} />
          ) : (
            <Text style={styles.primaryBtnText}>{current ? "Refresh My Location" : "Use My Current Location"}</Text>
          )}
        </TouchableOpacity>
      </View>

      {message ? (
        <View style={styles.messageBox} accessibilityLiveRegion="polite">
          <Text style={styles.messageText}>{message}</Text>
          {canRetry ? (
            <TouchableOpacity onPress={() => void useCurrent()} style={styles.linkBtn} accessibilityRole="button" disabled={disabled}>
              <Text style={styles.linkText}>Try again</Text>
            </TouchableOpacity>
          ) : null}
          {needsAppSettings ? (
            <TouchableOpacity onPress={() => void Linking.openSettings()} style={styles.linkBtn} accessibilityRole="button">
              <Text style={styles.linkText}>Open app settings</Text>
            </TouchableOpacity>
          ) : null}
          {needsLocationSettings ? (
            <TouchableOpacity onPress={() => void openLocationSettings()} style={styles.linkBtn} accessibilityRole="button">
              <Text style={styles.linkText}>Open location settings</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const createStyles = (Colors: ThemeColors) =>
  StyleSheet.create({
    title: { fontSize: Typography.sizes.xl, fontWeight: Typography.weights.bold, color: Colors.foreground, marginBottom: 8 },
    selectedRow: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
    selectedText: { fontSize: Typography.sizes.base, fontWeight: Typography.weights.bold, color: Colors.foreground },
    modeText: { fontSize: Typography.sizes.sm, color: Colors.mutedForeground, marginBottom: 12 },
    card: {
      backgroundColor: Colors.card,
      borderRadius: Radii.lg,
      borderWidth: 1,
      borderColor: Colors.border,
      padding: Spacing.lg,
      marginBottom: Spacing.md,
    },
    cardActive: { borderColor: Colors.primary, borderWidth: 2 },
    cardHead: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 },
    cardTitle: { fontSize: Typography.sizes.base, fontWeight: Typography.weights.bold, color: Colors.foreground, flexShrink: 1 },
    cardDesc: { fontSize: Typography.sizes.sm, color: Colors.mutedForeground, marginBottom: 10 },
    primaryBtn: {
      backgroundColor: Colors.primary,
      borderRadius: Radii.lg,
      paddingVertical: Spacing.md,
      alignItems: "center",
      justifyContent: "center",
      minHeight: 44,
    },
    primaryBtnText: { color: Colors.primaryForeground, fontWeight: Typography.weights.bold, fontSize: Typography.sizes.base },
    btnDisabled: { opacity: 0.6 },
    resultRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border, minHeight: 44 },
    resultText: { fontSize: Typography.sizes.base, color: Colors.foreground },
    resultSub: { fontSize: Typography.sizes.sm, color: Colors.mutedForeground },
    messageBox: { backgroundColor: Colors.secondary, borderRadius: Radii.lg, padding: 12 },
    messageText: { fontSize: Typography.sizes.sm, color: Colors.foreground },
    linkBtn: { paddingVertical: 8 },
    linkText: { color: Colors.primary, fontWeight: Typography.weights.bold },
  });
