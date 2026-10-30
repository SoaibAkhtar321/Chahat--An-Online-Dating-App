import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { Radii, Typography, ThemeColors, Spacing } from "../../src/constants/theme";
import { useTheme } from "../../src/context/ThemeContext";
import { Header } from "../../src/components/ui/Header";
import { LEGAL_DOCUMENT_VERSIONS } from "../../src/constants/legalVersions";
import { OPERATOR_DETAILS, isOperatorPlaceholder } from "../../src/constants/operatorDetails";
import { legalWebsiteUrl, type LegalWebsiteLink } from "../../src/constants/legalLinks";
import { fetchMyConsents, type ConsentState } from "../../src/services/consent";
import type { ConsentPurpose } from "../../src/constants/consentNotices";

// One consolidated place for legal and privacy information (Step 4). Everything stated here mirrors behaviour that exists
// in the app and database today; anything not yet confirmed by the operator is a visible placeholder from
// constants/operatorDetails.ts. The choices (location, push) are changed in Settings only, so consent is recorded and
// withdrawn through one path (services/consent.ts).

type SectionId = "documents" | "data" | "retention" | "community" | "subscriptions" | "support";

function choiceLabel(state: ConsentState | undefined, loaded: boolean): string {
  if (!loaded) return "Unavailable";
  if (!state || state.decision === null) return "Not chosen";
  return state.decision === "granted" ? "On" : "Off";
}

function useLegalStyles() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  return { Colors, styles };
}

function P({ children }: { children: React.ReactNode }) {
  const { styles } = useLegalStyles();
  return <Text style={styles.paragraph}>{children}</Text>;
}

function Detail({ label, value }: { label: string; value: string }) {
  const { styles } = useLegalStyles();
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      {isOperatorPlaceholder(value) ? (
        <Text style={styles.placeholder}>Not yet provided {value}</Text>
      ) : (
        <Text style={styles.detailValue}>{value}</Text>
      )}
    </View>
  );
}

function NavLink({ label, path }: { label: string; path: string }) {
  const { Colors, styles } = useLegalStyles();
  const router = useRouter();
  return (
    <TouchableOpacity
      style={styles.linkRow}
      onPress={() => router.push(path as never)}
      activeOpacity={0.7}
      accessibilityRole="link"
    >
      <Text style={styles.linkLabel}>{label}</Text>
      <ChevronRight size={18} color={Colors.mutedForeground} />
    </TouchableOpacity>
  );
}

// Opens an official page of the legal website in the in-app browser. These pages only show information (the delete page
// asks the person to sign in and confirm on the website itself); nothing here starts a deletion.
function WebLink({ label, link }: { label: string; link: LegalWebsiteLink }) {
  const { Colors, styles } = useLegalStyles();
  const open = async () => {
    try {
      await WebBrowser.openBrowserAsync(legalWebsiteUrl(link));
    } catch {
      Alert.alert("Could not open the page", `Please try again, or visit ${legalWebsiteUrl(link)} in your browser.`);
    }
  };
  return (
    <TouchableOpacity
      style={styles.linkRow}
      onPress={() => void open()}
      activeOpacity={0.7}
      accessibilityRole="link"
      accessibilityLabel={`${label}, opens the Chahat website`}
    >
      <Text style={styles.linkLabel}>{label}</Text>
      <ChevronRight size={18} color={Colors.mutedForeground} />
    </TouchableOpacity>
  );
}

function Section(props: { title: string; expanded: boolean; onToggle: () => void; children: React.ReactNode }) {
  const { Colors, styles } = useLegalStyles();
  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.sectionHeader}
        onPress={props.onToggle}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ expanded: props.expanded }}
      >
        <Text style={styles.sectionTitle}>{props.title}</Text>
        {props.expanded ? (
          <ChevronDown size={18} color={Colors.mutedForeground} />
        ) : (
          <ChevronRight size={18} color={Colors.mutedForeground} />
        )}
      </TouchableOpacity>
      {props.expanded ? <View style={styles.sectionBody}>{props.children}</View> : null}
    </View>
  );
}

export default function LegalAndPrivacyScreen() {
  const { styles } = useLegalStyles();
  const [open, setOpen] = useState<SectionId | null>("documents");
  const [choices, setChoices] = useState<Record<ConsentPurpose, ConsentState> | null>(null);

  useEffect(() => {
    let active = true;
    fetchMyConsents()
      .then((result) => {
        if (active) setChoices(result);
      })
      .catch(() => {
        // Leave the state as "Unavailable"; the choices themselves are managed in Settings.
      });
    return () => {
      active = false;
    };
  }, []);

  const toggle = (id: SectionId) => setOpen((current) => (current === id ? null : id));

  const loaded = choices !== null;

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Legal & Privacy" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          Everything about how Chahat handles your data, your choices and our rules, in one place. This is a summary; the
          full documents are linked below.
        </Text>

        <Section title="Terms & Conditions and Privacy Policy" expanded={open === "documents"} onToggle={() => toggle("documents")}>
          <NavLink label="Terms of Service" path="/legal/terms" />
          <NavLink label="Privacy Policy" path="/legal/privacy" />
          <Text style={styles.subheading}>Official website pages</Text>
          <WebLink label="Privacy Policy (website)" link="privacy" />
          <WebLink label="Terms of Service (website)" link="terms" />
          <WebLink label="Community Guidelines" link="communityGuidelines" />
          <WebLink label="Child Safety Standards" link="childSafety" />
          <WebLink label="Delete your account (website)" link="deleteAccount" />
          <WebLink label="Support" link="support" />
          <P>
            Current versions: Terms {LEGAL_DOCUMENT_VERSIONS.terms}, Privacy Policy {LEGAL_DOCUMENT_VERSIONS.privacy}. You
            confirm them when you sign up, and you will be asked again if they change.
          </P>
        </Section>

        <Section title="Your data, service providers and choices" expanded={open === "data"} onToggle={() => toggle("data")}>
          <P>
            What Chahat stores: your account email; the profile details and photos you add; your messages and media in
            chats; your likes, matches, blocks and reports; a rounded discovery location and a device notification token
            only if you opt in; and purchase records for paid plans where available.
          </P>
          <P>
            Service providers that help run Chahat, used only where the feature is switched on: Supabase (database,
            sign-in, file storage and server functions), Google Play (payments for paid plans), Google Cloud Vision
            (automated checks on profile photos), Expo push notification service with Firebase Cloud Messaging
            (notifications) and Agora (video calls, which are not recorded).
          </P>
          <Detail label="Provider list and processing locations" value={OPERATOR_DETAILS.serviceProviderConfirmation} />
          <Text style={styles.subheading}>Your optional choices</Text>
          <View style={styles.choiceRow}>
            <Text style={styles.detailLabel}>Use my location</Text>
            <Text style={styles.choiceValue}>{choiceLabel(choices?.location_discovery, loaded)}</Text>
          </View>
          <P>
            Used only to show people near you. Chahat stores a rounded area of about 1 km, not your exact position, and
            other members never see your coordinates. Turning it off deletes the stored location. Without it you can
            still discover people by city.
          </P>
          <P>
            City and town names and centre points come from the countries-states-cities-database by dr5hn, available
            under the Open Database License (ODbL) 1.0.
          </P>
          <View style={styles.choiceRow}>
            <Text style={styles.detailLabel}>Push notifications</Text>
            <Text style={styles.choiceValue}>{choiceLabel(choices?.push_notifications, loaded)}</Text>
          </View>
          <P>
            Stores a notification token for your device so Chahat can alert you about matches, messages, likes and
            calls. Turning it off removes the token. The app works without it.
          </P>
          <NavLink label="Change these choices in Settings" path="/settings" />
        </Section>

        <Section title="Retention, deletion and privacy requests" expanded={open === "retention"} onToggle={() => toggle("retention")}>
          <P>
            Delete your account in Settings. This removes your profile, photos, matches, chat messages and chat media, and
            your Terms and consent records. If it cannot finish, you can try again.
          </P>
          <P>
            Kept after deletion: reports about members stay as moderation records with identifiers removed (report notes
            may remain); payment records for paid plans stay without a link to your account; and an anonymous record that an
            account was deleted.
          </P>
          <Detail label="Retention periods" value={OPERATOR_DETAILS.dataRetentionPeriods} />
          <P>
            To get a copy of your data, use Settings → Download my data. You can correct your details in Edit profile. To ask
            for anything else about your data, or to withdraw a consent, use the options above or write to us.
          </P>
          <Detail label="Contact for privacy requests" value={OPERATOR_DETAILS.supportEmail} />
          <Detail label="How quickly we respond" value={OPERATOR_DETAILS.privacyRequestResponseTime} />
        </Section>

        <Section title="Community guidelines, reporting and child safety" expanded={open === "community"} onToggle={() => toggle("community")}>
          <P>
            Chahat is for adults aged 18 and over. Do not post abusive, obscene or fraudulent content, solicit commercial
            transactions or impersonate anyone.
          </P>
          <P>
            To report someone, open their profile and choose Report. You can also Block them, which removes your match.
            Reports are reviewed by the Chahat moderation team.
          </P>
          <P>
            Chahat does not allow any content or behaviour that sexualises, exploits or endangers children. Report anything
            of this kind straight away.
          </P>
          <Detail label="Child safety contact" value={OPERATOR_DETAILS.childSafetyContact} />
          <WebLink label="Child Safety Standards (website)" link="childSafety" />
          <NavLink label="Safety Centre and emergency helplines" path="/safety" />
        </Section>

        <Section title="Subscriptions, cancellation and refunds" expanded={open === "subscriptions"} onToggle={() => toggle("subscriptions")}>
          <P>
            Paid plans are prepaid and bought through Google Play for a fixed period (1 week, 1 month or 2 months). They do
            not renew automatically and you are never charged again unless you buy another plan. Your plan ends on the date
            shown in the app. Buying the same plan again before it ends adds to it.
          </P>
          <P>
            Deleting your Chahat account ends any active plan. Refunds follow Google Play's rules and the refund policy below.
          </P>
          <Detail label="Refunds" value={OPERATOR_DETAILS.refundPolicy} />
        </Section>

        <Section title="Support, grievances and contact" expanded={open === "support"} onToggle={() => toggle("support")}>
          <Detail label="Operator" value={OPERATOR_DETAILS.operatorName} />
          <Detail label="Address" value={OPERATOR_DETAILS.registeredAddress} />
          <Detail label="Support" value={OPERATOR_DETAILS.supportEmail} />
          <Detail label="Grievance officer" value={OPERATOR_DETAILS.grievanceOfficerName} />
          <Detail label="Grievance contact" value={OPERATOR_DETAILS.grievanceOfficerEmail} />
          <Detail label="Response timelines" value={OPERATOR_DETAILS.grievanceTimelines} />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (Colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
    content: { padding: 20, paddingBottom: 40 },
    intro: {
      fontSize: Typography.sizes.sm,
      color: Colors.mutedForeground,
      lineHeight: 20,
      marginBottom: Spacing.lg,
    },
    card: {
      backgroundColor: Colors.card,
      borderRadius: Radii.lg,
      borderWidth: 1,
      borderColor: Colors.border,
      marginBottom: Spacing.md,
      overflow: "hidden",
    },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      padding: Spacing.lg,
    },
    sectionTitle: {
      flex: 1,
      fontSize: Typography.sizes.base,
      fontWeight: Typography.weights.bold,
      color: Colors.foreground,
      paddingRight: Spacing.sm,
    },
    sectionBody: { paddingHorizontal: 16, paddingBottom: 16 },
    subheading: {
      fontSize: Typography.sizes.sm,
      fontWeight: Typography.weights.bold,
      color: Colors.foreground,
      marginTop: Spacing.md,
      marginBottom: Spacing.sm,
    },
    paragraph: {
      fontSize: Typography.sizes.sm,
      color: Colors.mutedForeground,
      lineHeight: 21,
      marginBottom: Spacing.md,
    },
    linkRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: Spacing.md,
      borderTopWidth: 1,
      borderTopColor: Colors.border,
    },
    linkLabel: { fontSize: Typography.sizes.base, color: Colors.foreground },
    detailRow: { marginBottom: 10 },
    detailLabel: {
      fontSize: Typography.sizes.sm,
      fontWeight: Typography.weights.semibold,
      color: Colors.foreground,
    },
    detailValue: { fontSize: Typography.sizes.sm, color: Colors.mutedForeground, marginTop: 2 },
    placeholder: {
      fontSize: Typography.sizes.sm,
      color: Colors.mutedForeground,
      fontStyle: "italic",
      marginTop: Spacing.xs,
    },
    choiceRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: Spacing.xs,
    },
    choiceValue: {
      fontSize: Typography.sizes.sm,
      fontWeight: Typography.weights.bold,
      color: Colors.primary,
    },
  });
