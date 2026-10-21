import {
  createTypingEmitter,
  createTypingReceiver,
  presenceLabel,
  TYPING_EXPIRE_MS,
  TYPING_IDLE_MS,
  TYPING_REFRESH_MS,
} from "../mobile/src/utils/typingState";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe("createTypingEmitter", () => {
  const setup = () => {
    let t = 0;
    const send = jest.fn();
    const emitter = createTypingEmitter(send, () => t);
    return { send, emitter, advance: (ms: number) => { t += ms; jest.advanceTimersByTime(ms); } };
  };

  it("sends typing once, not on every keystroke", () => {
    const { send, emitter, advance } = setup();
    emitter.input(true);
    advance(500);
    emitter.input(true);
    advance(500);
    emitter.input(true);
    expect(send.mock.calls).toEqual([[true]]);
  });

  it("refreshes typing while the user keeps typing", () => {
    const { send, emitter, advance } = setup();
    emitter.input(true);
    advance(TYPING_REFRESH_MS);
    emitter.input(true);
    expect(send.mock.calls).toEqual([[true], [true]]);
  });

  it("sends stopped after the idle timeout", () => {
    const { send, emitter, advance } = setup();
    emitter.input(true);
    advance(TYPING_IDLE_MS);
    expect(send.mock.calls).toEqual([[true], [false]]);
  });

  it("sends stopped when the box is emptied or the message is sent, once", () => {
    const { send, emitter } = setup();
    emitter.input(true);
    emitter.input(false);
    emitter.stop();
    expect(send.mock.calls).toEqual([[true], [false]]);
  });

  it("sends nothing when the user never typed", () => {
    const { send, emitter, advance } = setup();
    emitter.input(false);
    emitter.stop();
    advance(TYPING_IDLE_MS * 2);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("createTypingReceiver", () => {
  it("reports changes only and expires a stuck typing signal", () => {
    const onChange = jest.fn();
    const r = createTypingReceiver(onChange);
    r.receive(true);
    r.receive(true);
    expect(onChange.mock.calls).toEqual([[true]]);
    jest.advanceTimersByTime(TYPING_EXPIRE_MS);
    expect(onChange.mock.calls).toEqual([[true], [false]]);
  });

  it("a refresh keeps it alive; an explicit stop clears it", () => {
    const onChange = jest.fn();
    const r = createTypingReceiver(onChange);
    r.receive(true);
    jest.advanceTimersByTime(TYPING_EXPIRE_MS - 1000);
    r.receive(true);
    jest.advanceTimersByTime(TYPING_EXPIRE_MS - 1000);
    expect(onChange.mock.calls).toEqual([[true]]);
    r.receive(false);
    expect(onChange.mock.calls).toEqual([[true], [false]]);
  });

  it("dispose cancels the expiry timer", () => {
    const onChange = jest.fn();
    const r = createTypingReceiver(onChange);
    r.receive(true);
    r.dispose();
    jest.advanceTimersByTime(TYPING_EXPIRE_MS * 2);
    expect(onChange.mock.calls).toEqual([[true]]);
  });
});

describe("presenceLabel", () => {
  it("typing beats online, and nothing is claimed otherwise", () => {
    expect(presenceLabel(true, true)).toBe("typing…");
    expect(presenceLabel(false, true)).toBe("typing…");
    expect(presenceLabel(true, false)).toBe("online");
    expect(presenceLabel(false, false)).toBe("");
  });
});
