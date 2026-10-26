// Framework-free call controller: join, mute, camera, hang up, with duplicate-action protection
// and full cleanup. It owns the MEDIA session only. The call lifecycle (accept / end) stays in the
// server-owned transition_video_call RPC, driven by the screen.
import {
  CallError,
  toCallError,
  type CallErrorCode,
  type CallJoinGrant,
  type CallMediaProvider,
  type CallMediaSession,
  type CallMediaType,
} from "./callMedia";

export type CallPhase = "idle" | "joining" | "connected" | "ending" | "ended" | "failed";

export interface CallControllerState {
  phase: CallPhase;
  callId: string | null;
  callType: CallMediaType | null;
  microphoneEnabled: boolean;
  cameraEnabled: boolean;
  error: CallError | null;
}

export const INITIAL_CALL_STATE: CallControllerState = {
  phase: "idle",
  callId: null,
  callType: null,
  microphoneEnabled: true,
  cameraEnabled: false,
  error: null,
};

export interface CallControllerDeps {
  provider: CallMediaProvider;
  requestToken: (callId: string) => Promise<CallJoinGrant>;
  isEnabled: () => boolean;
}

type Listener = (state: CallControllerState) => void;

export class CallController {
  private state: CallControllerState = INITIAL_CALL_STATE;
  private readonly listeners = new Set<Listener>();
  private session: CallMediaSession | null = null;
  private endedUnsubscribe: (() => void) | null = null;
  private run = 0;
  private disposed = false;
  private joinPromise: Promise<void> | null = null;
  private hangUpPromise: Promise<void> | null = null;

  constructor(private readonly deps: CallControllerDeps) {}

  /** The live media session, if any. The call screen uses it only to render video. */
  getSession(): CallMediaSession | null {
    return this.session;
  }

  getState(): CallControllerState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private set(patch: Partial<CallControllerState>): void {
    this.state = { ...this.state, ...patch };
    if (this.disposed) return;
    for (const listener of [...this.listeners]) listener(this.state);
  }

  private isStale(run: number): boolean {
    return (
      this.disposed ||
      run !== this.run ||
      this.state.phase === "ending" ||
      this.state.phase === "ended"
    );
  }

  join(callId: string, callType: CallMediaType): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.joinPromise) return this.joinPromise; // duplicate request while joining
    const phase = this.state.phase;
    if (phase === "connected" || phase === "ending" || phase === "ended") return Promise.resolve();
    this.joinPromise = this.runJoin(callId, callType).finally(() => {
      this.joinPromise = null;
    });
    return this.joinPromise;
  }

  private async runJoin(callId: string, callType: CallMediaType): Promise<void> {
    const run = ++this.run;
    this.set({
      phase: "joining",
      callId,
      callType,
      error: null,
      microphoneEnabled: true,
      cameraEnabled: callType === "video",
    });
    try {
      if (!this.deps.isEnabled()) throw new CallError("calling_disabled");
      if (!this.deps.provider.configured) throw new CallError("provider_not_configured");

      const granted = await this.deps.provider.requestPermissions(callType);
      if (this.isStale(run)) return;
      if (!granted) throw new CallError("permission_denied");

      const grant = await this.deps.requestToken(callId);
      if (this.isStale(run)) return;

      const session = await this.deps.provider.join(grant, { callType });
      if (this.isStale(run)) {
        await this.safeLeave(session);
        return;
      }
      this.session = session;
      this.endedUnsubscribe = session.onEnded((reason) => this.handleRemoteEnd(session, reason));
      await session.setMicrophoneEnabled(true);
      if (callType === "video") await session.setCameraEnabled(true);
      if (this.isStale(run)) return;
      this.set({ phase: "connected" });
    } catch (cause) {
      if (this.isStale(run)) return;
      await this.releaseSession();
      this.set({ phase: "failed", error: toCallError(cause) });
    }
  }

  async setMicrophoneEnabled(enabled: boolean): Promise<boolean> {
    if (this.state.phase !== "connected" || !this.session) return false;
    try {
      await this.session.setMicrophoneEnabled(enabled);
      this.set({ microphoneEnabled: enabled });
      return true;
    } catch (cause) {
      this.set({ error: toCallError(cause) });
      return false;
    }
  }

  async setCameraEnabled(enabled: boolean): Promise<boolean> {
    if (this.state.phase !== "connected" || !this.session || this.state.callType !== "video") {
      return false;
    }
    try {
      await this.session.setCameraEnabled(enabled);
      this.set({ cameraEnabled: enabled });
      return true;
    } catch (cause) {
      this.set({ error: toCallError(cause) });
      return false;
    }
  }

  hangUp(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.hangUpPromise) return this.hangUpPromise;
    const phase = this.state.phase;
    if (phase === "ending" || phase === "ended") return Promise.resolve();
    if (phase === "idle" || phase === "failed") {
      this.run++;
      this.set({ phase: "ended" });
      return Promise.resolve();
    }
    this.run++; // invalidates any in-flight join
    this.set({ phase: "ending" });
    this.hangUpPromise = this.releaseSession().then(() => {
      this.set({ phase: "ended" });
      this.hangUpPromise = null;
    });
    return this.hangUpPromise;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.run++;
    this.listeners.clear();
    await this.releaseSession();
  }

  private handleRemoteEnd(session: CallMediaSession, reason?: CallErrorCode): void {
    if (this.session !== session) return;
    this.session = null;
    this.endedUnsubscribe?.();
    this.endedUnsubscribe = null;
    void this.safeLeave(session);
    if (this.state.phase === "connected" || this.state.phase === "joining") {
      this.set({ phase: "ended", ...(reason ? { error: new CallError(reason) } : {}) });
    }
  }

  private async releaseSession(): Promise<void> {
    const session = this.session;
    this.session = null;
    this.endedUnsubscribe?.();
    this.endedUnsubscribe = null;
    if (session) await this.safeLeave(session);
  }

  private async safeLeave(session: CallMediaSession): Promise<void> {
    try {
      await session.leave();
    } catch {
      // Leaving is best-effort; the server owns the authoritative call state.
    }
  }
}
