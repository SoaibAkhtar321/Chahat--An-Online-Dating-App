describe("Compatibility Score Rules", () => {
  const calculateCompatibility = (myInterests: string[], theirInterests: string[]): number => {
    const shared = theirInterests.filter((i) => myInterests.includes(i));
    return Math.min(95, 60 + shared.length * 10);
  };

  test("calculates base compatibility with no shared interests", () => {
    expect(calculateCompatibility(["Cricket"], ["Coffee"])).toBe(60);
  });

  test("increases score by 10% per shared interest", () => {
    expect(calculateCompatibility(["Cricket", "Coffee"], ["Coffee"])).toBe(70);
    expect(calculateCompatibility(["Cricket", "Coffee", "Yoga"], ["Coffee", "Yoga"])).toBe(80);
  });

  test("caps compatibility score at 95%", () => {
    expect(
      calculateCompatibility(["1", "2", "3", "4", "5", "6"], ["1", "2", "3", "4", "5", "6"]),
    ).toBe(95);
  });
});
