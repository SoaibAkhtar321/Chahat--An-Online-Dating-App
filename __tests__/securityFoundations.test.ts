import fs from "fs";
import path from "path";

const mockUpsert = jest.fn();
const mockInsert = jest.fn();
const mockDelete = jest.fn();
const mockUpdate = jest.fn();
const mockSelect = jest.fn();
const mockGetUser = jest.fn();

jest.mock("../mobile/src/services/supabase", () => ({
  supabase: {
    from: jest.fn((table: string) => {
      if (table === "account_state") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) }),
          }),
          upsert: mockUpsert,
        };
      }
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) }),
          }),
          update: () => ({
            eq: () => ({
              select: () => Promise.resolve({ data: [{ id: "test-user-id" }], error: null }),
            }),
          }),
        };
      }
      if (table === "blocks") {
        return {
          insert: mockInsert,
        };
      }
      if (table === "matches") {
        return {
          delete: () => ({
            or: mockDelete,
          }),
        };
      }
      return {
        select: mockSelect,
        insert: mockInsert,
        update: mockUpdate,
        delete: mockDelete,
      };
    }),
    auth: {
      getUser: () => mockGetUser(),
    },
    rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
  },
  isSupabaseConfigured: () => true,
  getConfigStatus: () => ({ configured: true, missing: [] }),
}));

import { saveProfile } from "../mobile/src/services/profile";
import { blockUser } from "../mobile/src/services/moderation";

const root = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

describe("Phase B: Critical Security Foundations", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpsert.mockResolvedValue({ data: null, error: null });
    mockInsert.mockResolvedValue({ data: null, error: null });
    mockDelete.mockResolvedValue({ data: null, error: null });
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-123" } }, error: null });
  });

  describe("1. Database Migration 20260101001300 Ordering & Structure", () => {
    const migPath = "supabase/migrations/20260101001300_critical_security_foundations.sql";

    test("new migration file exists and sorts after all previous migrations", () => {
      expect(fs.existsSync(path.join(root, migPath))).toBe(true);
      const allMigrations = fs
        .readdirSync(path.join(root, "supabase/migrations"))
        .filter((f) => f.endsWith(".sql"))
        .sort();
      expect(allMigrations.includes("20260101001300_critical_security_foundations.sql")).toBe(true);
      expect(
        allMigrations.indexOf("20260101001300_critical_security_foundations.sql"),
      ).toBeGreaterThan(allMigrations.indexOf("20260101001200_daily_like_limit_20.sql"));
      expect(
        allMigrations.indexOf("20260101001400_harden_verification_metadata_guard.sql"),
      ).toBeGreaterThan(allMigrations.indexOf("20260101001300_critical_security_foundations.sql"));
      expect(allMigrations[allMigrations.length - 1]).toBe(
        "20260101002300_call_token_rate_limit.sql",
      );
    });

    test("is_match_member enforces NOT public.is_blocked_pair", () => {
      const sql = read(migPath);
      expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.is_match_member/);
      expect(sql).toMatch(/NOT public\.is_blocked_pair\(m\.user_a,\s*m\.user_b\)/);
    });

    test("chat_folder_member enforces NOT public.is_blocked_pair", () => {
      const sql = read(migPath);
      expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.chat_folder_member/);
      expect(sql).toMatch(/NOT public\.is_blocked_pair\(m\.user_a,\s*m\.user_b\)/);
    });

    test("matches SELECT policy enforces NOT public.is_blocked_pair", () => {
      const sql = read(migPath);
      expect(sql).toMatch(/CREATE POLICY "members read match" ON public\.matches FOR SELECT/);
      expect(sql).toMatch(/NOT public\.is_blocked_pair\(user_a,\s*user_b\)/);
    });

    test("on_block_cleanup trigger on public.blocks cascades matches and swipes", () => {
      const sql = read(migPath);
      expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.on_block_cleanup/);
      expect(sql).toMatch(
        /DELETE FROM public\.matches\s+WHERE user_a = least\(NEW\.blocker,\s*NEW\.blocked\)/,
      );
      expect(sql).toMatch(/DELETE FROM public\.swipes/);
      expect(sql).toMatch(/CREATE TRIGGER on_block_cleanup\s+AFTER INSERT ON public\.blocks/);
    });

    test("get_public_profile strictly guards match fallback with NOT public.is_blocked_pair", () => {
      const sql = read(migPath);
      expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.get_public_profile/);
      expect(sql).toMatch(/NOT public\.is_blocked_pair\(p\.id,\s*auth\.uid\(\)::text\)/);
      expect(sql).toMatch(/NOT public\.is_blocked_pair\(m\.user_a,\s*m\.user_b\)/);
    });

    test("account_state_guard prevents client self-approval of verification", () => {
      const sql = read(migPath);
      expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.account_state_guard/);
      expect(sql).toMatch(/Verification status cannot be self-approved/);
      expect(sql).toMatch(
        /CREATE TRIGGER account_state_guard\s+BEFORE INSERT OR UPDATE ON public\.account_state/,
      );
    });

    test("purge_user_data explicitly cleans up photo_reviews", () => {
      const sql = read(migPath);
      expect(sql).toMatch(/DELETE FROM public\.photo_reviews WHERE owner_id = _t;/);
    });

    test("all SECURITY DEFINER functions have pg_temp in search_path", () => {
      const sql = read(migPath);
      const funcMatches = sql.match(
        /CREATE OR REPLACE FUNCTION [^(]+\([^)]*\)[\s\S]*?SET search_path = ([^;]+);/g,
      );
      expect(funcMatches).not.toBeNull();
      for (const m of funcMatches || []) {
        expect(m).toMatch(/search_path\s*=\s*public,\s*pg_temp/);
      }
    });

    test("20260101001400 hardens verification metadata tampering and preserves approved status", () => {
      const mig14Path = "supabase/migrations/20260101001400_harden_verification_metadata_guard.sql";
      expect(fs.existsSync(path.join(root, mig14Path))).toBe(true);
      const sql = read(mig14Path);
      expect(sql).toMatch(
        /Unauthorized verification metadata tampering: only status is client-modifiable/,
      );
      expect(sql).toMatch(/Invalid verification status: client may only set pending or none/);
      expect(sql).toMatch(
        /NEW\.data := jsonb_set\(NEW\.data,\s*'\{verification\}',\s*_old_verif\);/,
      );
      expect(sql).toMatch(/SET search_path = public,\s*pg_temp/);
    });

    test("supabase/tests/run.sh includes 28_security_foundations.sql before 90_assert.sql", () => {
      const runSh = read("supabase/tests/run.sh");
      expect(runSh).toMatch(/28_security_foundations\.sql/);
      expect(fs.existsSync(path.join(root, "supabase/tests/28_security_foundations.sql"))).toBe(
        true,
      );
      const sqlTest = read("supabase/tests/28_security_foundations.sql");
      expect(sqlTest).toMatch(/on_block_cleanup/);
      expect(sqlTest).toMatch(/account_state_guard/);
      expect(sqlTest).toMatch(/purge_user_data/);
    });
  });

  describe("2. Client-Side Verification Spoofing Protection", () => {
    test("saveProfile ignores client-provided 'approved' verification status", async () => {
      await saveProfile({ verificationStatus: "approved" as any }, "user-123");

      // An unsupported status is ignored entirely; it must not trigger an account_state write.
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    test("saveProfile permits legitimate transition to 'pending'", async () => {
      await saveProfile({ verificationStatus: "pending" }, "user-123");

      expect(mockUpsert).toHaveBeenCalled();
      const upsertArg = mockUpsert.mock.calls[0][0];
      expect(upsertArg.data.verification).toEqual({ status: "pending" });
    });

    test("saveProfile permits legitimate reset to 'none'", async () => {
      await saveProfile({ verificationStatus: "none" }, "user-123");

      expect(mockUpsert).toHaveBeenCalled();
      const upsertArg = mockUpsert.mock.calls[0][0];
      expect(upsertArg.data.verification).toEqual({ status: "none" });
    });
  });

  describe("3. Moderation & Block Transaction Safety", () => {
    test("blockUser fails safely if block insertion fails", async () => {
      mockInsert.mockResolvedValueOnce({ error: { message: "connection error" } });

      const result = await blockUser("target-user-456");
      expect(result).toBe(false);
      // match delete should not proceed if block failed
      expect(mockDelete).not.toHaveBeenCalled();
    });

    test("blockUser succeeds and cleans up match when block succeeds", async () => {
      mockInsert.mockResolvedValueOnce({ error: null });

      const result = await blockUser("target-user-456");
      expect(result).toBe(true);
      expect(mockInsert).toHaveBeenCalledWith({
        blocker: "user-123",
        blocked: "target-user-456",
      });
      expect(mockDelete).toHaveBeenCalled();
    });
  });
});
