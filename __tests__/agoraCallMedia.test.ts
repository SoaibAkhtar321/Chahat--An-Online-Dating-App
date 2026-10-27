import { callIdFromRoomId, createAgoraCallProvider } from "../mobile/src/services/agoraCallMedia";
import { CallError, type CallJoinGrant } from "../mobile/src/services/callMedia";

const CALL_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const grant: CallJoinGrant = {
  provider: "agora",
  roomId: `call_${CALL_ID}`,
  token: "server-token",
  expiresAt: "2026-01-01T00:00:00Z",
  callType: "video",
};

function makeSdk(opts: { autoJoin?: boolean } = { autoJoin: true }) {
  let handler: any = null;
  const engine: any = {
    initialize: jest.fn(),
    registerEventHandler: jest.fn((h) => (handler = h)),
    unregisterEventHandler: jest.fn(),
    enableAudio: jest.fn(),
    enableVideo: jest.fn(),
    startPreview: jest.fn(),
    setEnableSpeakerphone: jest.fn(),
    registerLocalUserAccount: jest.fn(),
    joinChannelWithUserAccount: jest.fn(() => {
      if (opts.autoJoin !== false) setTimeout(() => handler.onJoinChannelSuccess({}, 0), 0);
      return 0;
    }),
    muteLocalAudioStream: jest.fn(),
    muteLocalVideoStream: jest.fn(),
    enableLocalVideo: jest.fn(),
    renewToken: jest.fn(),
    leaveChannel: jest.fn(async () => 0),
    release: jest.fn(),
  };
  const sdk = {
    createAgoraRtcEngine: () => engine,
    ChannelProfileType: { ChannelProfileCommunication: 0 },
    ClientRoleType: { ClientRoleBroadcaster: 1 },
    RtcSurfaceView: class {
      get view() {
        return () => null;
      }
    },
  };
  return { sdk, engine, getHandler: () => handler };
}

const deps = (sdk: any, extra: any = {}) => ({
  appId: "app-id",
  getUserId: async () => USER_ID,
  renewToken: jest.fn(async () => ({ ...grant, token: "fresh" })),
  loadSdk: () => sdk,
  ...extra,
});

describe("Agora call media adapter", () => {
  test("is not configured without the SDK or the public App ID", () => {
    expect(createAgoraCallProvider(deps(null)).configured).toBe(false);
    expect(createAgoraCallProvider(deps(makeSdk().sdk, { appId: "" })).configured).toBe(false);
    expect(createAgoraCallProvider(deps(makeSdk().sdk)).configured).toBe(true);
  });

  test("join without SDK throws provider_not_configured and never fakes a session", async () => {
    const provider = createAgoraCallProvider(deps(null));
    await expect(provider.join(grant, { callType: "video" })).rejects.toMatchObject({
      code: "provider_not_configured",
    });
  });

  test("joins with the server token as the verified user account, publishing camera for video", async () => {
    const { sdk, engine } = makeSdk();
    const session: any = await createAgoraCallProvider(deps(sdk)).join(grant, { callType: "video" });
    expect(engine.joinChannelWithUserAccount).toHaveBeenCalledWith(
      "server-token",
      grant.roomId,
      USER_ID,
      expect.objectContaining({ publishMicrophoneTrack: true, publishCameraTrack: true }),
    );
    expect(engine.enableVideo).toHaveBeenCalled();
    expect(session.video).toBeDefined();
  });

  test("a join that never succeeds is cleaned up and reported", async () => {
    jest.useFakeTimers();
    const { sdk, engine } = makeSdk({ autoJoin: false });
    const p = createAgoraCallProvider(deps(sdk)).join(grant, { callType: "video" });
    const assertion = expect(p).rejects.toBeInstanceOf(CallError);
    await jest.advanceTimersByTimeAsync(21_000);
    await assertion;
    expect(engine.release).toHaveBeenCalled();
    jest.useRealTimers();
  });

  test("remote user leaving ends the call; mute and leave work", async () => {
    const { sdk, engine, getHandler } = makeSdk();
    const session: any = await createAgoraCallProvider(deps(sdk)).join(grant, { callType: "video" });
    const ended = jest.fn();
    session.onEnded(ended);
    getHandler().onUserJoined({}, 77);
    expect(session.video.getState().remoteUid).toBe(77);
    await session.setMicrophoneEnabled(false);
    expect(engine.muteLocalAudioStream).toHaveBeenCalledWith(true);
    getHandler().onUserOffline({}, 77);
    expect(ended).toHaveBeenCalledTimes(1);
    await session.leave();
    await session.leave(); // idempotent
    expect(engine.release).toHaveBeenCalledTimes(1);
  });

  test("token expiry renews through the server; a refused renewal ends the call", async () => {
    const { sdk, engine, getHandler } = makeSdk();
    const d = deps(sdk);
    const session: any = await createAgoraCallProvider(d).join(grant, { callType: "video" });
    const ended = jest.fn();
    session.onEnded(ended);
    await getHandler().onTokenPrivilegeWillExpire();
    expect(d.renewToken).toHaveBeenCalledWith(CALL_ID);
    expect(engine.renewToken).toHaveBeenCalledWith("fresh");
    expect(ended).not.toHaveBeenCalled();

    d.renewToken.mockRejectedValueOnce(new CallError("insufficient_coins"));
    await getHandler().onTokenPrivilegeWillExpire();
    expect(ended).toHaveBeenCalledTimes(1);
  });

  test("room id helper only accepts call_ rooms", () => {
    expect(callIdFromRoomId(`call_${CALL_ID}`)).toBe(CALL_ID);
    expect(callIdFromRoomId("other")).toBeNull();
  });
});

describe("Agora shared engine and two-way audio", () => {
  const withAudioApi = (engine: any) => {
    Object.assign(engine, {
      enableLocalAudio: jest.fn(),
      muteAllRemoteAudioStreams: jest.fn(),
      adjustRecordingSignalVolume: jest.fn(),
      adjustPlaybackSignalVolume: jest.fn(),
      updateChannelMediaOptions: jest.fn(),
    });
    return engine;
  };

  test("explicitly turns on capture, publishing and remote audio after joining", async () => {
    const { sdk, engine } = makeSdk();
    withAudioApi(engine);
    await createAgoraCallProvider(deps(sdk)).join(grant, { callType: "video" });
    expect(engine.enableLocalAudio).toHaveBeenCalledWith(true);
    expect(engine.muteLocalAudioStream).toHaveBeenCalledWith(false);
    expect(engine.muteAllRemoteAudioStreams).toHaveBeenCalledWith(false);
    expect(engine.updateChannelMediaOptions).toHaveBeenCalledWith(
      expect.objectContaining({ publishMicrophoneTrack: true, autoSubscribeAudio: true }),
    );
  });

  test("a finished call cannot destroy the shared engine of the next call", async () => {
    const { sdk, engine } = makeSdk();
    withAudioApi(engine);
    const provider = createAgoraCallProvider(deps(sdk));
    const first: any = await provider.join(grant, { callType: "video" });
    const second: any = await provider.join(grant, { callType: "video" });
    await first.leave(); // stale cleanup of the older session
    expect(engine.release).not.toHaveBeenCalled();
    await second.leave();
    expect(engine.release).toHaveBeenCalledTimes(1);
  });

  test("reports a microphone failure so the screen can tell the user", async () => {
    const { sdk, engine, getHandler } = makeSdk();
    withAudioApi(engine);
    const session: any = await createAgoraCallProvider(deps(sdk)).join(grant, { callType: "video" });
    getHandler().onLocalAudioStateChanged({}, 3, 0);
    expect(session.video.getState().micProblem).toBe(true);
    expect(engine.enableLocalAudio).toHaveBeenCalledWith(false); // one automatic restart attempt
    getHandler().onLocalAudioStateChanged({}, 2, 0);
    expect(session.video.getState().micProblem).toBe(false);
  });
});
