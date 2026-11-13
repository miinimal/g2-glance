/**
 * Page state machine. Pure: takes the current state and an action, returns the next state and the
 * side effects the bridge layer must run. No timers, no I/O.
 */

export const PAGES = ['action', 'deadline', 'inbox', 'voice'] as const;
export type Page = (typeof PAGES)[number];

export type Gesture =
  | 'click'
  | 'double'
  | 'up'
  | 'down'
  | 'hold'
  | 'release'
  | 'foreground'
  | 'background';

export type NoteOutcome =
  | { kind: 'sent'; durationMs: number }
  | { kind: 'saved'; durationMs: number }
  | { kind: 'failed'; durationMs: number; reason: string }
  | { kind: 'empty' };

export type Recording =
  | { kind: 'idle' }
  | { kind: 'recording'; startedAt: number }
  | { kind: 'saving' }
  | { kind: 'done'; outcome: NoteOutcome; at: number };

export interface State {
  page: number;
  recording: Recording;
}

export type Action =
  | { type: 'gesture'; gesture: Gesture; now: number }
  /** The recorder reached its maximum length. */
  | { type: 'limit'; now: number }
  /** Saving or sending a note finished. */
  | { type: 'noteDone'; outcome: NoteOutcome; now: number };

export type Effect = 'render' | 'refresh' | 'exit' | 'startRecording' | 'stopRecording';

export interface Step {
  state: State;
  effects: Effect[];
}

export const initialState: State = { page: 0, recording: { kind: 'idle' } };

export function pageName(state: State): Page {
  return PAGES[state.page]!;
}

const VOICE = PAGES.indexOf('voice');

function turn(state: State, delta: number): State {
  const page = (state.page + delta + PAGES.length) % PAGES.length;
  return { ...state, page };
}

function stopIfRecording(state: State, extra: Effect[]): Step {
  if (state.recording.kind !== 'recording') return { state, effects: extra };
  return {
    state: { ...state, recording: { kind: 'saving' } },
    effects: ['stopRecording', 'render', ...extra],
  };
}

function onGesture(state: State, gesture: Gesture, now: number): Step {
  const recording = state.recording.kind === 'recording';
  switch (gesture) {
    case 'down':
    case 'up':
      // Pages stay put while recording so the status and timer stay in view.
      if (recording || state.recording.kind === 'saving') return { state, effects: [] };
      return { state: turn(state, gesture === 'down' ? 1 : -1), effects: ['render'] };
    case 'click':
      if (recording || state.recording.kind === 'saving') return { state, effects: [] };
      return { state, effects: ['refresh'] };
    case 'double':
      return stopIfRecording(state, ['exit']);
    case 'hold':
      if (state.page !== VOICE) return { state, effects: [] };
      if (recording || state.recording.kind === 'saving') return { state, effects: [] };
      return {
        state: { ...state, recording: { kind: 'recording', startedAt: now } },
        effects: ['startRecording', 'render'],
      };
    case 'release':
      return stopIfRecording(state, []);
    case 'background':
      return stopIfRecording(state, []);
    case 'foreground':
      return { state, effects: ['render', 'refresh'] };
  }
}

export function reduce(state: State, action: Action): Step {
  switch (action.type) {
    case 'gesture':
      return onGesture(state, action.gesture, action.now);
    case 'limit':
      return stopIfRecording(state, []);
    case 'noteDone':
      if (state.recording.kind !== 'saving') return { state, effects: [] };
      return {
        state: { ...state, recording: { kind: 'done', outcome: action.outcome, at: action.now } },
        effects: ['render'],
      };
  }
}

/** Minimal shape of an Even Hub event payload (text, list or sys event). */
interface EventPayload {
  eventType?: number | null;
  imuData?: unknown;
}

export interface HubEventLike {
  textEvent?: EventPayload | null;
  sysEvent?: EventPayload | null;
  listEvent?: EventPayload | null;
}

/**
 * Map an Even Hub event to a gesture. Values follow `OsEventTypeList` in SDK 0.0.16.
 *
 * Click is event type 0, and protobuf omits zero values on the wire, so a click can arrive with no
 * `eventType` at all. A payload without a type is therefore read as a click (IMU reports excepted).
 */
export function toGesture(event: HubEventLike): Gesture | null {
  const payload = event.textEvent ?? event.listEvent ?? event.sysEvent;
  if (!payload) return null;
  if (payload.imuData) return null;
  const type = payload.eventType ?? 0;
  switch (type) {
    case 0:
      return 'click';
    case 1:
      return 'up';
    case 2:
      return 'down';
    case 3:
      return 'double';
    case 4:
      return 'foreground';
    case 5: // foreground exit
    case 6: // abnormal exit
    case 7: // system exit
      return 'background';
    case 9:
      return 'hold';
    case 10:
      return 'release';
    default:
      return null;
  }
}
