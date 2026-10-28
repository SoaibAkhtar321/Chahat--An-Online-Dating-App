// eslint-disable-next-line @typescript-eslint/no-require-imports
const appConfig = require("../mobile/app.config.js");

const { resolveGoogleServicesFile } = appConfig;

describe("google-services.json resolution", () => {
  it("returns null when no credential file exists (build still works)", () => {
    expect(resolveGoogleServicesFile({ projectDir: "/p", exists: () => false })).toBeNull();
    // Hermetic: a developer's real (gitignored) mobile/google-services.json or GOOGLE_SERVICES_JSON must not
    // change the result. Previously this test failed on any machine that had the local credential file.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs");
    const previous = process.env.GOOGLE_SERVICES_JSON;
    delete process.env.GOOGLE_SERVICES_JSON;
    const exists = jest.spyOn(fs, "existsSync").mockReturnValue(false);
    try {
      const base = { name: "Chahat", android: { package: "x.y" } };
      expect(appConfig({ config: base })).toEqual(base);
    } finally {
      exists.mockRestore();
      if (previous === undefined) delete process.env.GOOGLE_SERVICES_JSON;
      else process.env.GOOGLE_SERVICES_JSON = previous;
    }
  });

  it("prefers the EAS file variable over the local file", () => {
    const exists = () => true;
    expect(
      resolveGoogleServicesFile({ envPath: "/eas/file.json", projectDir: "/p", exists }),
    ).toBe("/eas/file.json");
  });

  it("falls back to the local file, ignoring an env path that does not exist", () => {
    const exists = (candidate: string) => candidate.endsWith("google-services.json");
    expect(
      resolveGoogleServicesFile({ envPath: "/missing.json", projectDir: "/p", exists }),
    ).toBe("./google-services.json");
  });

  it("keeps existing android settings when adding the file", () => {
    const previous = process.env.GOOGLE_SERVICES_JSON;
    process.env.GOOGLE_SERVICES_JSON = __filename; // a file that exists
    const result = appConfig({ config: { android: { package: "x.y" } } });
    expect(result.android.package).toBe("x.y");
    expect(result.android.googleServicesFile).toBe(__filename);
    if (previous === undefined) delete process.env.GOOGLE_SERVICES_JSON;
    else process.env.GOOGLE_SERVICES_JSON = previous;
  });
});
