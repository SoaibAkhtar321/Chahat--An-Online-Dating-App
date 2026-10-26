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
  type CallJoinGrant,
  type CallMediaProvider,
  type CallMediaSession,
  type CallMediaType,
} from "./callMedia";

export interface AgoraVideoState {
  localVideoReady: boolean;
  remoteUid: number | null;
}

/** Optional video surface exposed by sessions that can render video (Agora). */
export interface CallVideoSurface {
  getState(): AgoraVideoState;
  subscribe(listener: (state: AgoraVideoState) => void): () => void;
  renderLocal(): React.ReactElement | null;
  renderRemote(): React.ReactElement | null;
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

function defaultLoadSdk(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("react-native-agora");
  } catch {
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

      const engine = sdk.createAgoraRtcEngine();
      const endedListeners = new Set<() => void>();
      const videoListeners = new Set<(s: AgoraVideoState) => void>();
      let video: AgoraVideoState = { localVideoReady: false, remoteUid: null };
      let left = false;
      let joined = false;
      let rejoinFailed = false;

      const setVideo = (patch: Partial<AgoraVideoState>) => {
        video = { ...video, ...patch };
        videoListeners.forEach((l) => l(video));
      };
      const notifyEnded = () => {
        if (left) return;
        endedListeners.forEach((l) => l());
      };
      const release = async () => {
        if (left) return;
        left = true;
        try {
          engine.unregisterEventHandler?.(handler);
        } catch {}
        try {
          await engine.leaveChannel();
        } catch {}
        try {
          engine.release();
        } catch {}
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
        // One-to-one call: when the other person leaves or drops, the call is over.
        onUserOffline: () => {
          setVideo({ remoteUid: null });
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
        onTokenPrivilegeWillExpire: async () => {
          try {
            const fresh = await deps.renewToken(callId);
            await engine.renewToken(fresh.token);
          } catch {
            // The server refused a new token (call over, out of coins, rate limit): end cleanly.
            rejoinFailed = true;
            notifyEnded();
          }
        },
        onRequestToken: () => {
          if (!rejoinFailed) void handler.onTokenPrivilegeWillExpire();
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
          renderLocal: () =>
            React.createElement(RtcSurfaceView, {
              style: { flex: 1 },
              canvas: { uid: 0 },
              zOrderMediaOverlay: true,
            }),
          renderRemote: () =>
            video.remoteUid === null
              ? null
              : React.createElement(RtcSurfaceView, {
                  style: { flex: 1 },
                  canvas: { uid: video.remoteUid },
                }),
        };
      }
      return session;
    },
  };
}

/** Wrapper so the call screen can render a session's video without knowing the SDK. */
export function CallVideoStage({
  session,
}: {
  session: CallSessionWithVideo | null;
}): React.ReactElement | null {
  const surface = session?.video;
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => (surface ? surface.subscribe(() => force()) : undefined), [surface]);
  if (!surface) return null;
  return React.createElement(
    View,
    { style: { flex: 1, width: "100%", backgroundColor: "#000" }, testID: "call-video-stage" },
    surface.renderRemote(),
    React.createElement(
      View,
      {
        style: {
          position: "absolute",
          top: 16,
          right: 16,
          width: 110,
          height: 160,
          borderRadius: 12,
          overflow: "hidden",
          backgroundColor: "#222",
        },
      },
      surface.renderLocal(),
    ),
  );
}
