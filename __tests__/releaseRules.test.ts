import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

describe("Free like quota is 20 per IST day (server + client agree)", () => {
  const migDir = path.join(root, "supabase/migrations");
  const files = fs.readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();
  const latestSwipe = [...files]
    .reverse()
    .find((f) =>
      /CREATE OR REPLACE FUNCTION public\.record_swipe/.test(
        fs.readFileSync(path.join(migDir, f), "utf8"),
      ),
    )!;

  test("latest record_swipe falls back to 20", () => {
    expect(read(`supabase/migrations/${latestSwipe}`)).toMatch(
      /setting_int\('daily_like_limit',\s*20\)/,
    );
  });

  test("the last migration touching app_settings.daily_like_limit sets it to 20", () => {
    const sql = files.map((f) => read(`supabase/migrations/${f}`)).join("\n");
    const last = [...sql.matchAll(/\('daily_like_limit',\s*'(\d+)'::jsonb\)/g)].pop();
    expect(last?.[1]).toBe("20");
  });

  test("quota day is the IST calendar day", () => {
    expect(read(`supabase/migrations/${latestSwipe}`)).toMatch(
      /timezone\('Asia\/Kolkata', now\(\)\)/,
    );
  });

  test("client default is 20, not 10", () => {
    expect(read("mobile/src/context/MiloContext.tsx")).not.toMatch(
      /likesRemaining: 10|useState<number>\(10\)/,
    );
  });
});

describe("UI makes no claims the backend does not honour", () => {
  test("no 'Unlimited Likes' copy while the server enforces a uniform limit", () => {
    for (const f of [
      "mobile/src/services/subscription.ts",
      "mobile/app/(tabs)/discover.tsx",
      "mobile/app/(tabs)/me.tsx",
    ]) {
      expect(read(f)).not.toMatch(/Unlimited Likes|Get Unlimited/);
    }
  });

  test("purchaseSubscription never reports an in-progress payment", () => {
    expect(read("mobile/src/services/subscription.ts")).not.toMatch(
      /payment sheet is connecting/i,
    );
  });

  test("no fabricated notification seed or Milo branding in user-facing strings", () => {
    expect(read("mobile/src/services/notifications.ts")).not.toMatch(
      /Someone liked your profile/,
    );
    expect(read("mobile/src/components/ui/DatePicker.tsx")).not.toMatch(/Milo is strictly|Eligible for Milo/);
    expect(read("mobile/src/utils/validation.ts")).not.toMatch(/use Milo/);
  });
});
