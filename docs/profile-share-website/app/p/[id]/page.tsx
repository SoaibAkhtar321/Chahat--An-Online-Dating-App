// Landing page for shared Chahat profile links: https://chahatlegal.netlify.app/p/<id>
// Copy this file into the website project (Chahat-admin-legal) at app/p/[id]/page.tsx.
//
// On Android with Chahat installed and App Links verified (public/.well-known/assetlinks.json), Android opens the
// app directly and this page is never shown. Otherwise it offers "Open in Chahat" and the Play Store.
// PRIVACY: this page must never fetch or show any profile data (name, photo, city, age). It only knows the id.
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "View this profile on Chahat",
  description: "Open the Chahat app to view this profile.",
  robots: { index: false, follow: false },
  openGraph: { title: "View this profile on Chahat", description: "Open the Chahat app to view this profile." },
};

const PLAY_URL = "https://play.google.com/store/apps/details?id=com.chahat.dating";
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SharedProfilePage({ params }: { params: Promise<{ id: string }> | { id: string } }) {
  const { id } = await params;
  const valid = ID_PATTERN.test(id);
  const appUrl = valid ? `chahat://p/${id.toLowerCase()}` : "chahat://";
  return (
    <main style={{ maxWidth: 420, margin: "64px auto", padding: 16, textAlign: "center", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Someone shared a Chahat profile</h1>
      <p style={{ color: "#666", marginBottom: 24 }}>Profiles are only visible inside the Chahat app to signed-in members.</p>
      <p><a href={appUrl} style={{ display: "inline-block", padding: "12px 24px", borderRadius: 999, background: "#B0124B", color: "#fff", textDecoration: "none", fontWeight: 600 }}>Open in Chahat</a></p>
      <p style={{ marginTop: 16 }}><a href={PLAY_URL}>Get Chahat on Google Play</a></p>
    </main>
  );
}
