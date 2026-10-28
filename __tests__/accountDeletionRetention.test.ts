import * as fs from "fs";
import * as path from "path";

const root = path.resolve(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

describe("Step 5: deletion migration (static checks)", () => {
  const sql = read("supabase/migrations/20260101003500_account_deletion_hardening.sql");

  it("keeps the deletion functions service-role only", () => {
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.purge_user_data\(uuid\) FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.purge_user_data\(uuid\) TO service_role/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.find_orphaned_chat_folders\(\) FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.find_orphaned_chat_folders\(\) TO service_role/);
  });

  it("pins search_path on every SECURITY DEFINER function", () => {
    const defs = sql.match(/SECURITY DEFINER[\s\S]*?AS \$\$/g) ?? [];
    expect(defs.length).toBeGreaterThanOrEqual(2);
    for (const d of defs) expect(d).toMatch(/SET search_path = /);
  });

  it("makes the audit event idempotent and does not touch retained-data decisions", () => {
    expect(sql).toMatch(/IF NOT EXISTS \([\s\S]*account_self_deleted/);
    expect(sql).not.toMatch(/DROP TABLE|TRUNCATE|ALTER TABLE public\.(coin_|legal_|consent_)/i);
  });

  it("orphan finder is read-only", () => {
    const finder = sql.slice(sql.indexOf("find_orphaned_chat_folders()\nRETURNS"));
    expect(finder).not.toMatch(/\b(DELETE|UPDATE|INSERT)\b/i);
  });
});

describe("Step 5: Edge Function wiring", () => {
  const index = read("supabase/functions/delete-account/index.ts");
  const logic = read("supabase/functions/delete-account/deletion.ts");

  it("is a thin wrapper around the tested logic and never reads a user id from the request body", () => {
    expect(index).toMatch(/from "\.\/deletion\.ts"/);
    expect(logic).toMatch(/userData\.user\.id/);
    expect(logic).not.toMatch(/body\.(uid|user_id|userId|_uid)/);
  });

  it("stays JWT-verified in config", () => {
    expect(read("supabase/config.toml")).toMatch(/\[functions\.delete-account\]\s*\nverify_jwt = true/);
  });
});

describe("Step 5: documentation does not invent retention", () => {
  const doc = read("docs/ACCOUNT_DELETION.md");
  const table = doc.slice(doc.indexOf("## What is deleted"), doc.indexOf("## Processing status"));

  it("covers every retained category and marks periods as needing a legal decision", () => {
    for (const k of ["subscription_orders", "reports", "admin_audit", "legal_acceptances", "consent_records", "coin_transactions"]) {
      expect(table).toContain(k);
    }
    expect(table).toMatch(/Needs legal decision/i);
  });

  it("states no retention period in numbers", () => {
    expect(table).not.toMatch(/\b\d+\s*(days?|weeks?|months?|years?)\b/i);
  });

  it("keeps the retention period in the app a visible placeholder until legal confirms it", () => {
    const op = read("mobile/src/constants/operatorDetails.ts");
    expect(op).toMatch(/dataRetentionPeriods: "\[/);
  });
});

describe("Step 5: in-app deletion route and consequences", () => {
  const settings = read("mobile/app/settings/index.tsx");

  it("tells the user what is deleted, what is kept, the Play subscription and retry before confirming", () => {
    expect(settings).toMatch(/verification selfie/);
    expect(settings).toMatch(/Kept without a link to you/);
    expect(settings).toMatch(/plans are prepaid and never renew/);
    expect(settings).toMatch(/retry from Settings/);
    expect(settings).toMatch(/Type DELETE to confirm/);
  });

  it("still links to Legal & Privacy and uses the guarded flow (Steps 1-4 not regressed)", () => {
    expect(settings).toMatch(/router\.push\("\/legal"\)/);
    expect(settings).toMatch(/runAccountDeletion\(/);
    for (const f of [
      "supabase/migrations/20260101003300_legal_acceptances.sql",
      "supabase/migrations/20260101003400_optional_processing_consents.sql",
      "mobile/app/legal/index.tsx",
      "mobile/src/constants/legalVersions.ts",
    ]) {
      expect(fs.existsSync(path.join(root, f))).toBe(true);
    }
  });
});
