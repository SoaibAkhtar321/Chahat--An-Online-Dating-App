// eslint-disable-next-line @typescript-eslint/no-require-imports
const appConfig = require("../mobile/app.config.js");

const { resolveGoogleServicesFile } = appConfig;

describe("google-services.json resolution", () => {
  it("returns null when no credential file exists (build still works)", () => {
    expect(resolveGoogleServicesFile({ projectDir: "/p", exists: () => false })).toBeNull();
    const base = { name: "Chahat", android: { package: "x.y" } };
    expect(appConfig({ config: base })).toEqual(base);
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
