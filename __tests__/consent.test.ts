import * as fs from "fs";
import * as path from "path";

const mockRpc = jest.fn();
let mockConfigured = true;
const mockAlert = jest.fn();

jest.mock("../mobile/src/services/supabase", () => ({
  isSupabaseConfigured: () => mockConfigured,
  supabase: { rpc: (...a: unknown[]) => mockRpc(...a) },
}));
jest.mock("../mobile/src/utils/alert", () => ({
  Alert: { alert: (...a: unknown[]) => mockAlert(...a) },
}));

import {
  CONSENT_NOTICES,
  CONSENT_NOTICE_VERSIONS,
  CONSENT_PURPOSES,
} from "../mobile/src/constants/consentNotices";
import { LEGAL_DOCUMENT_VERSIONS } from "../mobile/src/constants/legalVersions";
import {
  ensureConsent,
  fetchMyConsents,
  hasConsent,
  setConsent,
} from "../mobile/src/services/consent";

const migrationsDir = path.join(__dirname, "..", "supabase", "migrations");
const migrationFile = fs
  .readdirSync(migrationsDir)
  .find((f) => f.endsWith("_optional_processing_consents.sql"));
const migrationSql = migrationFile ? fs.readFileSync(path.join(migrationsDir, migrationFile), "utf8") : "";

function consentRows(over: Record<string, unknown> = {}) {
  return [
    {
      purpose: "location_discovery",
      current_notice_version: CONSENT_NOTICE_VERSIONS.location_discovery,
      decision: null,
      notice_version: null,
    },
    {
      purpose: "push_notifications",
      current_notice_version: CONSENT_NOTICE_VERSIONS.push_notifications,
      decision: null,
      notice_version: null,
      ...over,
    },
  ];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockConfigured = true;
});

describe("notice versions", () => {
  it("client constants equal the newest server registry version for each purpose", () => {
    expect(migrationFile).toBeDefined();
    const insert = migrationSql.match(/INSERT INTO public\.consent_notice_versions[^;]*;/i)?.[0] ?? "";
    for (const purpose of CONSENT_PURPOSES) {
      const versions = [...insert.matchAll(new RegExp(`\\('${purpose}',\\s*'(\\d{4}-\\d{2}-\\d{2})'\\)`, "g"))]
        .map((m) => m[1])
        .sort();
      expect(versions.length).toBeGreaterThan(0);
      expect(CONSENT_NOTICE_VERSIONS[purpose]).toBe(versions[versions.length - 1]);
    }
  });

  it("every purpose has a notice that names the data, the purpose and how to turn it off", () => {
    for (const purpose of CONSENT_PURPOSES) {
      const n = CONSENT_NOTICES[purpose];
      expect(n.title.length).toBeGreaterThan(0);
      expect(n.body).toMatch(/optional/i);
      expect(n.body).toMatch(/Settings/);
      expect(n.declineLabel).toBeTruthy();
    }
    expect(CONSENT_NOTICES.location_discovery.body).toMatch(/1 km/);
    expect(CONSENT_NOTICES.push_notifications.body).toMatch(/token/i);
  });

  it("keeps these notice versions separate from the Terms/Privacy versions", () => {
    expect(Object.keys(CONSENT_NOTICE_VERSIONS).sort()).toEqual(["location_discovery", "push_notifications"]);
    expect(Object.keys(LEGAL_DOCUMENT_VERSIONS).sort()).toEqual(["privacy", "terms"]);
  });
});

describe("migration shape", () => {
  it("never backfills consent for existing users", () => {
    expect(migrationSql).not.toMatch(/INSERT INTO public\.consent_records[^;]*SELECT/i);
    expect(migrationSql).not.toMatch(/INSERT INTO public\.consent_records[^;]*FROM\s+auth\.users/i);
  });

  it("is append-only evidence with RLS and no client write privileges", () => {
    expect(migrationSql).toMatch(/ALTER TABLE public\.consent_records ENABLE ROW LEVEL SECURITY/);
    expect(migrationSql).toMatch(/REVOKE ALL ON public\.consent_records FROM PUBLIC, anon, authenticated/);
    expect(migrationSql).toMatch(/GRANT SELECT ON public\.consent_records TO authenticated/);
    expect(migrationSql).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*ON public\.consent_records TO authenticated/i);
    expect(migrationSql).toMatch(/user_id = \(SELECT auth\.uid\(\)\)/);
    expect(migrationSql).toMatch(/consent_records_no_update/);
  });

  it("enforces consent on the server for both optional purposes", () => {
    expect(migrationSql).toMatch(/TRIGGER discovery_locations_require_consent/);
    expect(migrationSql).toMatch(/TRIGGER push_devices_require_consent/);
    expect(migrationSql).toMatch(/has_active_consent\(NEW\.user_id, 'location_discovery'\)/);
    expect(migrationSql).toMatch(/has_active_consent\(NEW\.user_id, 'push_notifications'\)/);
  });
});

describe("fetchMyConsents / hasConsent", () => {
  it("reads the latest decision per purpose from the server", async () => {
    mockRpc.mockResolvedValue({
      data: consentRows({ decision: "granted", notice_version: CONSENT_NOTICE_VERSIONS.push_notifications }),
      error: null,
    });
    const consents = await fetchMyConsents();
    expect(mockRpc).toHaveBeenCalledWith("get_my_consents");
    expect(consents.location_discovery.decision).toBeNull();
    expect(consents.push_notifications.decision).toBe("granted");
  });

  it("treats 'never decided' and 'withdrawn' as not granted", async () => {
    mockRpc.mockResolvedValue({ data: consentRows(), error: null });
    await expect(hasConsent("push_notifications")).resolves.toBe(false);
    mockRpc.mockResolvedValue({ data: consentRows({ decision: "withdrawn" }), error: null });
    await expect(hasConsent("push_notifications")).resolves.toBe(false);
  });

  it("fails closed when the server cannot be reached", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "network down" } });
    await expect(hasConsent("location_discovery")).resolves.toBe(false);
    mockRpc.mockRejectedValue(new Error("boom"));
    await expect(hasConsent("location_discovery")).resolves.toBe(false);
  });

  it("reports nothing granted when the backend is not configured", async () => {
    mockConfigured = false;
    await expect(hasConsent("location_discovery")).resolves.toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("setConsent", () => {
  it("sends only the purpose, the shown notice version, the decision and the method (no identity or time)", async () => {
    mockRpc.mockResolvedValue({ data: {}, error: null });
    await expect(setConsent("location_discovery", "granted")).resolves.toEqual({ success: true });
    expect(mockRpc).toHaveBeenCalledWith("set_my_consent", {
      _purpose: "location_discovery",
      _notice_version: CONSENT_NOTICE_VERSIONS.location_discovery,
      _decision: "granted",
      _method: "in_app_notice",
    });
    await setConsent("push_notifications", "withdrawn");
    expect(mockRpc).toHaveBeenLastCalledWith("set_my_consent", {
      _purpose: "push_notifications",
      _notice_version: CONSENT_NOTICE_VERSIONS.push_notifications,
      _decision: "withdrawn",
      _method: "settings_toggle",
    });
  });

  it("flags an outdated app when the server has a newer notice", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "22023", message: "The notice has changed." } });
    const result = await setConsent("location_discovery", "granted");
    expect(result.success).toBe(false);
    expect(result.outdated).toBe(true);
  });

  it("reports a generic failure without leaking server text", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "secret internals" } });
    const result = await setConsent("location_discovery", "granted");
    expect(result.success).toBe(false);
    expect(result.error).not.toMatch(/secret/);
  });
});

describe("ensureConsent", () => {
  function answerNotice(buttonIndex: number | null) {
    mockAlert.mockImplementation((_t: string, _m: string, buttons: { onPress?: () => void }[]) => {
      if (buttonIndex !== null) buttons?.[buttonIndex]?.onPress?.();
    });
  }

  it("does not show the notice again when consent is already granted", async () => {
    mockRpc.mockResolvedValue({
      data: consentRows({ decision: "granted", notice_version: CONSENT_NOTICE_VERSIONS.push_notifications }),
      error: null,
    });
    await expect(ensureConsent("push_notifications")).resolves.toBe(true);
    expect(mockAlert).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalledWith("set_my_consent", expect.anything());
  });

  it("records nothing when the user declines", async () => {
    mockRpc.mockResolvedValue({ data: consentRows(), error: null });
    answerNotice(0); // "Not now"
    await expect(ensureConsent("push_notifications")).resolves.toBe(false);
    expect(mockRpc).not.toHaveBeenCalledWith("set_my_consent", expect.anything());
  });

  it("records a grant only after an explicit agree on the notice", async () => {
    mockRpc.mockImplementation(async (name: string) =>
      name === "get_my_consents" ? { data: consentRows(), error: null } : { data: {}, error: null },
    );
    answerNotice(1); // agree
    await expect(ensureConsent("push_notifications")).resolves.toBe(true);
    expect(mockAlert).toHaveBeenCalledWith(
      CONSENT_NOTICES.push_notifications.title,
      CONSENT_NOTICES.push_notifications.body,
      expect.any(Array),
    );
    expect(mockRpc).toHaveBeenCalledWith(
      "set_my_consent",
      expect.objectContaining({ _purpose: "push_notifications", _decision: "granted" }),
    );
  });

  it("does not proceed when saving the grant fails", async () => {
    mockRpc.mockImplementation(async (name: string) =>
      name === "get_my_consents"
        ? { data: consentRows(), error: null }
        : { data: null, error: { code: "XX000", message: "down" } },
    );
    answerNotice(1);
    await expect(ensureConsent("push_notifications")).resolves.toBe(false);
  });
});

describe("screen wiring (static)", () => {
  const read = (rel: string) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
  const before = (src: string, a: string, b: string) => {
    const ia = src.indexOf(a);
    const ib = src.indexOf(b);
    return ia >= 0 && ib >= 0 && ia < ib;
  };

  it("the location picker, Discover and Settings ask for location consent before the OS permission flow", () => {
    // Onboarding and the Location screen embed LocationPicker, which asks consent before detecting anything.
    const picker = read("mobile/src/components/location/LocationPicker.tsx");
    expect(before(picker, 'ensureConsent("location_discovery")', "selectCurrentLocation()")).toBe(true);
    expect(read("mobile/app/onboarding/index.tsx")).toMatch(/<LocationPicker/);
    expect(read("mobile/app/settings/location.tsx")).toMatch(/<LocationPicker/);
    // Discover only routes to that screen, and only after consent.
    const discover = read("mobile/app/(tabs)/discover.tsx");
    expect(before(discover, 'ensureConsent("location_discovery")', 'router.push("/settings/location")')).toBe(true);
    // The service itself refuses to read the device position without an active grant.
    // The OS permission flow lives in gpsFix.acquireFreshFix; both callers check consent before invoking it.
    const service = read("mobile/src/services/locationSelection.ts");
    expect(before(service, 'hasConsent("location_discovery")', "await acquireFreshFix()")).toBe(true);
    const legacy = read("mobile/src/services/location.ts");
    expect(before(legacy, 'hasConsent("location_discovery")', "await acquireFreshFix()")).toBe(true);
    expect(service).not.toMatch(/getForegroundPermissionsAsync|requestForegroundPermissionsAsync/);
    expect(read("mobile/src/services/gpsFix.ts")).toMatch(/requestForegroundPermissionsAsync/);
  });

  it("Settings uses consent for both optional purposes and withdraws through the server", () => {
    const src = read("mobile/app/settings/index.tsx");
    expect(before(src, 'ensureConsent("location_discovery")', 'router.push("/settings/location")')).toBe(true);
    expect(src).toMatch(/ensureConsent\("push_notifications"\)/);
    expect(src).toMatch(/setConsent\("location_discovery", "withdrawn"\)/);
    expect(src).toMatch(/setConsent\("push_notifications", "withdrawn"\)/);
    expect(src).toMatch(/openSettings/);
    expect(src).toMatch(/openNotificationSettings/);
  });

  it("no screen records a grant directly: grants only come from ensureConsent after the notice", () => {
    for (const f of [
      "mobile/app/settings/index.tsx",
      "mobile/app/onboarding/index.tsx",
      "mobile/app/(tabs)/discover.tsx",
      "mobile/src/context/AuthContext.tsx",
    ]) {
      expect(read(f)).not.toMatch(/setConsent\([^)]*"granted"/);
    }
  });

  it("consent stays separate from Terms/Privacy acceptance", () => {
    const src = read("mobile/src/services/consent.ts");
    expect(src).not.toMatch(/legalAcceptance|legalVersions|accept_current_legal_documents/);
  });
});
