import * as fs from "fs";
import * as path from "path";
import {
  LEGAL_ACCEPTANCE_METADATA_KEY,
  LEGAL_DOCUMENT_VERSIONS,
  currentLegalAcceptanceClaim,
} from "../mobile/src/constants/legalVersions";

const migrationsDir = path.join(__dirname, "..", "supabase", "migrations");

function readAllMigrations(): { file: string; sql: string }[] {
  return fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, sql: fs.readFileSync(path.join(migrationsDir, file), "utf8") }));
}

// All (document, version) registry rows inserted by any migration.
function registryVersions(document: "terms" | "privacy"): string[] {
  const out: string[] = [];
  for (const { sql } of readAllMigrations()) {
    const insert = sql.match(/INSERT INTO public\.legal_document_versions[^;]*;/gi) ?? [];
    for (const stmt of insert) {
      for (const m of stmt.matchAll(new RegExp(`\\('${document}',\\s*'(\\d{4}-\\d{2}-\\d{2})'\\)`, "g"))) {
        out.push(m[1]);
      }
    }
  }
  return out.sort();
}

describe("legal document versions", () => {
  it("client constants equal the newest server registry version for each document", () => {
    const terms = registryVersions("terms");
    const privacy = registryVersions("privacy");
    expect(terms.length).toBeGreaterThan(0);
    expect(privacy.length).toBeGreaterThan(0);
    expect(LEGAL_DOCUMENT_VERSIONS.terms).toBe(terms[terms.length - 1]);
    expect(LEGAL_DOCUMENT_VERSIONS.privacy).toBe(privacy[privacy.length - 1]);
  });

  it("builds the signup claim from the shared constants only", () => {
    expect(currentLegalAcceptanceClaim()).toEqual({
      terms_version: LEGAL_DOCUMENT_VERSIONS.terms,
      privacy_version: LEGAL_DOCUMENT_VERSIONS.privacy,
    });
  });

  it("the legal_acceptances migration never backfills existing users", () => {
    const sql = readAllMigrations().find((m) => m.file.includes("legal_acceptances"))?.sql ?? "";
    expect(sql).not.toBe("");
    // The only INSERTs into legal_acceptances live inside the two SECURITY DEFINER functions, never as top-level seeding
    // from auth.users/profiles.
    expect(sql).not.toMatch(/INSERT INTO public\.legal_acceptances[^;]*SELECT[^;]*FROM\s+(auth\.users|public\.profiles)/i);
    expect(sql).toMatch(/NO BACKFILL/);
  });

  it("migration keeps the evidence table write-locked for clients", () => {
    const sql = readAllMigrations().find((m) => m.file.includes("legal_acceptances"))?.sql ?? "";
    expect(sql).toMatch(/REVOKE ALL ON public\.legal_acceptances FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT SELECT ON public\.legal_acceptances TO authenticated;/);
    expect(sql).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*legal_acceptances[^;]*TO[^;]*(authenticated|anon)/i);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
  });
});

describe("signUpUser legal acceptance metadata", () => {
  const mockSignUp = jest.fn();
  let signUpUser: typeof import("../mobile/src/services/auth").signUpUser;

  beforeAll(() => {
    jest.resetModules();
    jest.doMock("../mobile/src/services/supabase", () => ({
      supabase: { auth: { signUp: (...a: any[]) => mockSignUp(...a) } },
      isSupabaseConfigured: () => true,
      getConfigStatus: () => ({ configured: true, missing: [] }),
    }));
    jest.doMock("expo-linking", () => ({ createURL: (p: string) => `chahat://${p}` }));
    jest.doMock("../mobile/src/services/notifications", () => ({
      clearNotificationState: jest.fn(),
      unregisterPushNotificationToken: jest.fn(),
    }));
    signUpUser = (require("../mobile/src/services/auth") as typeof import("../mobile/src/services/auth")).signUpUser;
  });

  beforeEach(() => {
    mockSignUp.mockReset();
    mockSignUp.mockResolvedValue({ data: { user: { identities: [{}] } }, error: null });
  });

  it("sends no legal metadata unless the caller passes an explicit acceptance", async () => {
    await signUpUser("a@example.test", "passWord1");
    const arg = mockSignUp.mock.calls[0][0];
    expect(arg.options).toEqual({ emailRedirectTo: "chahat://callback" });
    expect(JSON.stringify(arg)).not.toContain(LEGAL_ACCEPTANCE_METADATA_KEY);
  });

  it("sends exactly the accepted versions as signup metadata when provided", async () => {
    await signUpUser("a@example.test", "passWord1", currentLegalAcceptanceClaim());
    expect(mockSignUp.mock.calls[0][0].options).toEqual({
      emailRedirectTo: "chahat://callback",
      data: { [LEGAL_ACCEPTANCE_METADATA_KEY]: currentLegalAcceptanceClaim() },
    });
  });
});
