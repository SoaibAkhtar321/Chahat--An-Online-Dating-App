describe("Like Quotas & India Standard Time Calculations", () => {
  const getIstDateString = (date: Date): string => {
    // Formats date into Asia/Kolkata date
    const options: Intl.DateTimeFormatOptions = {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    };
    return new Intl.DateTimeFormat("en-CA", options).format(date);
  };

  test("calculates IST date correctly across UTC boundaries", () => {
    // UTC 2026-10-09 20:00:00 is IST 2026-10-10 01:30:00 (+5:30)
    const utcDate = new Date("2026-10-09T20:00:00Z");
    const istString = getIstDateString(utcDate);
    expect(istString).toBe("2026-10-10");
  });

  test("calculates remaining free daily likes accurately", () => {
    const dailyLimit = 10;
    const used = 4;
    expect(Math.max(0, dailyLimit - used)).toBe(6);
  });

  test("clamps negative remaining likes to zero", () => {
    const dailyLimit = 10;
    const used = 12;
    expect(Math.max(0, dailyLimit - used)).toBe(0);
  });
});
