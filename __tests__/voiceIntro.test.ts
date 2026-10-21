import {
  VOICE_INTRO_LIMITS,
  validateVoiceIntroDuration,
  validateVoiceIntroPath,
} from "../mobile/src/services/voiceIntroPolicy";
import { validateProfileDraft } from "../mobile/src/services/profilePolicy";

const UID = "11111111-1111-1111-1111-111111111111";

describe("voice intro policy", () => {
  it("accepts durations inside the limits and rejects the rest", () => {
    expect(validateVoiceIntroDuration(VOICE_INTRO_LIMITS.minDurationSec).valid).toBe(true);
    expect(validateVoiceIntroDuration(VOICE_INTRO_LIMITS.maxDurationSec).valid).toBe(true);
    expect(validateVoiceIntroDuration(1).valid).toBe(false);
    expect(validateVoiceIntroDuration(VOICE_INTRO_LIMITS.maxDurationSec + 5).valid).toBe(false);
    expect(validateVoiceIntroDuration(Number.NaN).valid).toBe(false);
  });

  it("only allows paths inside the owner's folder", () => {
    expect(validateVoiceIntroPath(UID, `${UID}/voice_intro_abc.m4a`)).toBe(true);
    expect(validateVoiceIntroPath(UID, null)).toBe(true);
    expect(validateVoiceIntroPath(UID, `22222222-2222-2222-2222-222222222222/voice_intro_abc.m4a`)).toBe(false);
    expect(validateVoiceIntroPath(UID, `${UID}/../x/voice_intro_abc.m4a`)).toBe(false);
    expect(validateVoiceIntroPath(UID, `${UID}/photo.jpg`)).toBe(false);
  });

  it("is enforced by the profile draft validator", () => {
    const ok = validateProfileDraft(
      { voiceIntroPath: `${UID}/voice_intro_abc.m4a`, voiceIntroDurationSec: 12 },
      UID,
    );
    expect(ok.valid).toBe(true);
    expect(
      validateProfileDraft({ voiceIntroPath: `${UID}/voice_intro_abc.m4a`, voiceIntroDurationSec: 0 }, UID).valid,
    ).toBe(false);
    expect(
      validateProfileDraft({ voiceIntroPath: "other/voice_intro_abc.m4a", voiceIntroDurationSec: 12 }, UID).valid,
    ).toBe(false);
    expect(validateProfileDraft({ voiceIntroPath: null }, UID).valid).toBe(true);
  });
});
