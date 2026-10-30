// Client adapter for the Agora RTC SDK (react-native-agora). It implements CallMediaProvider so the
// existing CallController, token flow and call screen work unchanged.
//
// Security: the Agora App Certificate never reaches the app. The app only holds the PUBLIC App ID
// (EXPO_PUBLIC_AGORA_APP_ID) and a short-lived, server-issued token bound to one channel and to the
// verified user id (issue-call-token). The SDK is required lazily so Jest, Expo Go and builds
// without the native module simply report "calling unavailable" instead of crashing.
import React from "react";
import { PermissionsAndroid, Platform, View } from "react-native";
import {
  CallError,
  type CallErrorCode,
  type CallJoinGrant,
  type CallMediaProvider,
  type CallMediaSession,
  type CallMediaType,
} from "./callMedia";

export interface AgoraVideoState {
  localVideoReady: boolean;
  remoteUid: number | null;
  /** True once the other person's video frames are actually arriving (not just that they joined). */
  remoteVideoReady: boolean;
  /** True when the microphone could not start (permission, or another app is using it). */
  micProblem: boolean;
}

/** Optional video surface exposed by sessions that can render video (Agora). */
export interface CallVideoSurface {
  getState(): AgoraVideoState;
  subscribe(listener: (state: AgoraVideoState) => void): () => void;
  /** `overlay` = drawn in the small floating box, above the other video. */
  renderLocal(overlay?: boolean): React.ReactElement | null;
  renderRemote(overlay?: boolean): React.ReactElement | null;
}

export type CallSessionWithVideo = CallMediaSession & { video?: CallVideoSurface };

export interface AgoraProviderDeps {
  appId: string;
  getUserId: () => Promise<string | null>;
  /** Fetches a fresh join token for the same call; used when the SDK says the token is expiring. */
  renewToken: (callId: string) => Promise<CallJoinGrant>;
  loadSdk?: () => any | null;
}

const JOIN_TIMEOUT_MS = 20_000;

// react-native-agora returns ONE shared engine for the whole app. If a finished call's asynchronous cleanup
// runs after the next call has started, its release() destroys the NEW call's engine, which shows up as
// one-way or missing audio. So: a new join waits for the previous cleanup, and only the latest owner may release.
let engineOwner = 0;
let pendingRelease: Promise<void> = Promise.resolve();

async function waitForInAppRingToStop(): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    await require("./callNotifications").ringReleased();
  } catch {
    // Not available (tests / other platforms): nothing to wait for.
  }
}

/** Why the Agora SDK could not be loaded on this phone (shown on the call screen to diagnose a build). */
export let agoraLoadError: string | null = null;

function defaultLoadSdk(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sdk = require("react-native-agora");
    agoraLoadError = null;
    return sdk;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    agoraLoadError = message.split("\n")[0].slice(0, 120);
    return null;
  }
}

export function callIdFromRoomId(roomId: string): string | null {
  return roomId.startsWith("call_") ? roomId.slice("call_".length) : null;
}

async function requestAndroidPermissions(callType: CallMediaType): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  const wanted = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
  if (callType === "video") wanted.push(PermissionsAndroid.PERMISSIONS.CAMERA);
  const result = await PermissionsAndroid.requestMultiple(wanted);
  return wanted.every((p) => result[p] === PermissionsAndroid.RESULTS.GRANTED);
}

export function createAgoraCallProvider(deps: AgoraProviderDeps): CallMediaProvider {
  const loadSdk = deps.loadSdk ?? defaultLoadSdk;
  const sdkPresent = !!deps.appId && loadSdk() !== null;

  return {
    name: "agora",
    configured: sdkPresent,

    requestPermissions: (callType) => requestAndroidPermissions(callType),

    async join(grant, { callType }): Promise<CallSessionWithVideo> {
      const sdk = loadSdk();
      if (!sdk || !deps.appId) throw new CallError("provider_not_configured");
      const callId = callIdFromRoomId(grant.roomId);
      const userId = await deps.getUserId();
      if (!callId || !userId) throw new CallError("unauthenticated");

      // The ringtone must have let go of the speaker/audio focus, and any previous call must be fully released.
      await waitForInAppRingToStop();
      await pendingRelease;
      const engine = sdk.createAgoraRtcEngine();
      const owner = ++engineOwner;
      const endedListeners = new Set<(reason?: CallErrorCode) => void>();
      const videoListeners = new Set<(s: AgoraVideoState) => void>();
      let video: AgoraVideoState = {
        localVideoReady: false,
        remoteUid: null,
        remoteVideoReady: false,
        micProblem: false,
      };
      let left = false;
      let joined = false;
      let rejoinFailed = false;
      let micRetried = false;

      const setVideo = (patch: Partial<AgoraVideoState>) => {
        video = { ...video, ...patch };
        videoListeners.forEach((l) => l(video));
      };
      const notifyEnded = (reason?: CallErrorCode) => {
        if (left) return;
        endedListeners.forEach((l) => l(reason));
      };
      const release = async () => {
        if (left) return;
        left = true;
        const done = (async () => {
          try {
            engine.unregisterEventHandler?.(handler);
          } catch {}
          try {
            await engine.leaveChannel();
          } catch {}
          try {
            // Only the newest session owns the shared engine; an older one must not destroy it.
            if (owner === engineOwner) engine.release();
          } catch {}
        })();
        pendingRelease = pendingRelease.then(() => done);
        await done;
      };

      let resolveJoined: () => void = () => {};
      let rejectJoined: (e: unknown) => void = () => {};
      const joinedPromise = new Promise<void>((res, rej) => {
        resolveJoined = res;
        rejectJoined = rej;
      });

      const handler = {
        onJoinChannelSuccess: () => {
          joined = true;
          resolveJoined();
        },
        onUserJoined: (_conn: unknown, remoteUid: number) => setVideo({ remoteUid }),
        // Frames from the other person are really being decoded (2 = DECODING). Until then the call screen
        // shows a "waiting for camera" hint instead of an unexplained black rectangle.
        onRemoteVideoStateChanged: (_conn: unknown, uid: number, state: number) => {
          if (state === 2) setVideo({ remoteUid: uid, remoteVideoReady: true });
          else if (state === 0 || state === 3) setVideo({ remoteVideoReady: false });
        },
        onFirstRemoteVideoDecoded: (_conn: unknown, uid: number) =>
          setVideo({ remoteUid: uid, remoteVideoReady: true }),
        // One-to-one call: when the other person leaves or drops, the call is over.
        onUserOffline: () => {
          setVideo({ remoteUid: null, remoteVideoReady: false });
          notifyEnded();
        },
        onConnectionStateChanged: (_conn: unknown, state: number) => {
          // 5 = CONNECTION_STATE_FAILED
          if (state === 5) {
            if (!joined) rejectJoined(new CallError("network"));
            else notifyEnded();
          }
        },
        onError: (code: number) => {
          // Fatal join errors surface here before onJoinChannelSuccess (bad/expired token, etc.).
          if (!joined && code !== 0) rejectJoined(new CallError("provider_error"));
        },
        // Agora warns ~30 s before the token expires, which for a short free call is right after joining. A
        // refused renewal at that point must NOT end the call: the current token is still valid, and the call
        // screen's timer ends the call when the paid-for time is really over.
        onTokenPrivilegeWillExpire: async () => {
          try {
            const fresh = await deps.renewToken(callId);
            await engine.renewToken(fresh.token);
          } catch {
            // Keep talking on the current token.
          }
        },
        // The token has actually expired: renew or end cleanly, saying why (so the screen can offer Premium).
        onRequestToken: async () => {
          if (rejoinFailed) return;
          try {
            const fresh = await deps.renewToken(callId);
            await engine.renewToken(fresh.token);
          } catch (cause) {
            rejoinFailed = true;
            notifyEnded(cause instanceof CallError ? cause.code : undefined);
          }
        },
        // Microphone health. state 3 = FAILED (no permission / mic busy). Try once to restart capture, then tell the screen.
        onLocalAudioStateChanged: (_conn: unknown, state: number) => {
          if (state === 3) {
            setVideo({ micProblem: true });
            if (!micRetried) {
              micRetried = true;
              try {
                engine.enableLocalAudio(false);
                engine.enableLocalAudio(true);
              } catch {}
            }
          } else if (state === 1 || state === 2) {
            setVideo({ micProblem: false });
          }
        },
        onLocalVideoStateChanged: (_src: unknown, state: number) => {
          // 1 = capturing, 2 = encoding
          if (state === 1 || state === 2) setVideo({ localVideoReady: true });
        },
      };

      try {
        engine.initialize({
          appId: deps.appId,
          channelProfile: sdk.ChannelProfileType.ChannelProfileCommunication,
        });
        engine.registerEventHandler(handler);
        engine.enableAudio();
        if (callType === "video") {
          engine.enableVideo();
          engine.startPreview();
        }
        engine.setEnableSpeakerphone(callType === "video");
        // Tokens are minted for the verified user id as a string account, never a client-chosen uid.
        engine.registerLocalUserAccount(deps.appId, userId);
        const code = engine.joinChannelWithUserAccount(grant.token, grant.roomId, userId, {
          clientRoleType: sdk.ClientRoleType.ClientRoleBroadcaster,
          publishMicrophoneTrack: true,
          publishCameraTrack: callType === "video",
          autoSubscribeAudio: true,
          autoSubscribeVideo: callType === "video",
        });
        if (typeof code === "number" && code < 0) throw new CallError("provider_error");
        // Be explicit about two-way audio instead of relying on defaults: capture on, published, not muted,
        // remote audio subscribed and audible, loudspeaker route for video calls.
        try {
          engine.enableLocalAudio(true);
          engine.muteLocalAudioStream(false);
          engine.muteAllRemoteAudioStreams(false);
          engine.adjustRecordingSignalVolume(100);
          engine.adjustPlaybackSignalVolume(100);
          engine.updateChannelMediaOptions({
            publishMicrophoneTrack: true,
            autoSubscribeAudio: true,
            clientRoleType: sdk.ClientRoleType.ClientRoleBroadcaster,
          });
        } catch {
          // Best-effort hardening; the join options above already enable audio.
        }

        await Promise.race([
          joinedPromise,
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new CallError("network")), JOIN_TIMEOUT_MS),
          ),
        ]);
      } catch (cause) {
        await release();
        throw cause instanceof CallError ? cause : new CallError("provider_error");
      }

      const RtcSurfaceView = sdk.RtcSurfaceView;
      // RtcSurfaceView renders the native "AgoraRtcSurfaceView" component. When the installed app binary does not
      // contain it (old/Expo Go build, or a new-architecture mismatch) that component is `undefined`, and rendering
      // it crashes the call screen with "Element type is invalid ... got: undefined". Detect that up front and
      // fall back to a call without a video surface instead of crashing.
      let surfaceUsable = false;
      try {
        const nativeView = Object.getOwnPropertyDescriptor(RtcSurfaceView?.prototype ?? {}, "view")?.get?.call({});
        surfaceUsable = !!nativeView;
      } catch {
        surfaceUsable = false;
      }
      if (callType === "video" && !surfaceUsable && typeof __DEV__ !== "undefined" && __DEV__) {
        console.warn("Agora RtcSurfaceView native component is missing; video surface disabled. Rebuild the app.");
      }
      const session: CallSessionWithVideo = {
        async setMicrophoneEnabled(enabled) {
          engine.muteLocalAudioStream(!enabled);
        },
        async setCameraEnabled(enabled) {
          engine.enableLocalVideo(enabled);
          engine.muteLocalVideoStream(!enabled);
        },
        async switchCamera() {
          engine.switchCamera();
        },
        leave: release,
        onEnded(listener) {
          endedListeners.add(listener);
          return () => endedListeners.delete(listener);
        },
      };

      if (callType === "video" && RtcSurfaceView && surfaceUsable) {
        session.video = {
          getState: () => video,
          subscribe(listener) {
            videoListeners.add(listener);
            return () => videoListeners.delete(listener);
          },
          renderLocal: (overlay = true) =>
            React.createElement(RtcSurfaceView, {
              key: overlay ? "local-small" : "local-large",
              style: { flex: 1 },
              canvas: { uid: 0 },
              zOrderMediaOverlay: overlay,
            }),
          renderRemote: (overlay = false) =>
            video.remoteUid === null
              ? null
              : React.createElement(RtcSurfaceView, {
                  key: overlay ? "remote-small" : "remote-large",
                  style: { flex: 1 },
                  canvas: { uid: video.remoteUid },
                  zOrderMediaOverlay: overlay,
                }),
        };
      }
      return session;
    },
  };
}

// The call screen's video layout (big video + draggable, tappable small box) lives in its own component.
export { CallVideoStage } from "../components/call/CallVideoStage";
