// "Download my data" (DPDP Act 2023, s.11): the member's own data, as a JSON file they can save or send.
// The server builds the export (export_my_data) and only ever includes the signed-in member's own data.
import { Platform, Share } from "react-native";
import { isSupabaseConfigured, supabase } from "./supabase";

export function exportFileName(now: Date = new Date()): string {
  return `chahat-my-data-${now.toISOString().slice(0, 10)}.json`;
}

export async function fetchMyData(): Promise<Record<string, unknown>> {
  if (!isSupabaseConfigured()) throw new Error("Not available in this build.");
  const { data, error } = await supabase.rpc("export_my_data");
  if (error || !data || typeof data !== "object") throw new Error("Couldn't prepare your data. Please try again.");
  return data as Record<string, unknown>;
}

/** Writes the export to a file and opens the share sheet (save to Files / Drive, email it, ...). */
export async function downloadMyData(): Promise<void> {
  const data = await fetchMyData();
  const json = JSON.stringify(data, null, 2);
  if (Platform.OS === "web") {
    await Share.share({ message: json });
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const FileSystem = require("expo-file-system/legacy");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Sharing = require("expo-sharing");
  const uri = `${FileSystem.cacheDirectory}${exportFileName()}`;
  await FileSystem.writeAsStringAsync(uri, json, { encoding: FileSystem.EncodingType.UTF8 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: "application/json", dialogTitle: "Your Chahat data" });
  } else {
    await Share.share({ message: json });
  }
}
