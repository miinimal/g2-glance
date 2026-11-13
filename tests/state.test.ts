import { describe, expect, it } from 'vitest';
import {
  PAGES,
  initialState,
  pageName,
  reduce,
  toGesture,
  type Gesture,
  type Recording,
  type State,
} from '../src/core/state';

const NOW = 1_000_000;
const g = (state: State, gesture: Gesture) => reduce(state, { type: 'gesture', gesture, now: NOW });
const at = (page: number, recording: Recording = { kind: 'idle' }): State => ({ page, recording });
const VOICE = PAGES.indexOf('voice');

describe('page switching', () => {
  it('starts on Next action', () => {
    expect(pageName(initialState)).toBe('action');
  });

  it('cycles forward with swipe down and wraps', () => {
    const names: string[] = [];
    let s = initialState;
    for (let i = 0; i < PAGES.length + 1; i++) {
      const step = g(s, 'down');
      expect(step.effects).toEqual(['render']);
      s = step.state;
      names.push(pageName(s));
    }
    expect(names).toEqual(['deadline', 'inbox', 'voice', 'action', 'deadline']);
  });

  it('cycles backward with swipe up and wraps', () => {
    const step = g(initialState, 'up');
    expect(pageName(step.state)).toBe('voice');
    expect(step.effects).toEqual(['render']);
  });

  it('does not switch pages while recording or saving', () => {
    for (const recording of [{ kind: 'recording', startedAt: 0 }, { kind: 'saving' }] as Recording[]) {
      for (const gesture of ['up', 'down'] as Gesture[]) {
        const s = at(VOICE, recording);
        expect(g(s, gesture)).toEqual({ state: s, effects: [] });
      }
    }
  });

  it('switches pages again after a note is done', () => {
    const s = at(VOICE, { kind: 'done', outcome: { kind: 'empty' }, at: 0 });
    expect(pageName(g(s, 'down').state)).toBe('action');
  });
});

describe('tap and double tap', () => {
  it.each(PAGES.map((_, i) => i))('tap refreshes on page %i', (page) => {
    expect(g(at(page), 'click')).toEqual({ state: at(page), effects: ['refresh'] });
  });

  it('tap does nothing while recording', () => {
    const s = at(VOICE, { kind: 'recording', startedAt: 0 });
    expect(g(s, 'click').effects).toEqual([]);
  });

  it.each(PAGES.map((_, i) => i))('double tap exits from page %i', (page) => {
    expect(g(at(page), 'double')).toEqual({ state: at(page), effects: ['exit'] });
  });

  it('double tap while recording stops the note before exiting', () => {
    const step = g(at(VOICE, { kind: 'recording', startedAt: 0 }), 'double');
    expect(step.state.recording).toEqual({ kind: 'saving' });
    expect(step.effects).toEqual(['stopRecording', 'render', 'exit']);
  });
});

describe('voice note', () => {
  it('long press on the voice page starts recording', () => {
    const step = g(at(VOICE), 'hold');
    expect(step.state.recording).toEqual({ kind: 'recording', startedAt: NOW });
    expect(step.effects).toEqual(['startRecording', 'render']);
  });

  it('long press on other pages does nothing', () => {
    for (let page = 0; page < PAGES.length; page++) {
      if (page === VOICE) continue;
      expect(g(at(page), 'hold')).toEqual({ state: at(page), effects: [] });
    }
  });

  it('long press while recording or saving is ignored', () => {
    for (const recording of [{ kind: 'recording', startedAt: 1 }, { kind: 'saving' }] as Recording[]) {
      expect(g(at(VOICE, recording), 'hold').effects).toEqual([]);
    }
  });

  it('long press after a finished note starts a new one', () => {
    const s = at(VOICE, { kind: 'done', outcome: { kind: 'sent', durationMs: 3000 }, at: 0 });
    expect(g(s, 'hold').state.recording.kind).toBe('recording');
  });

  it('release stops recording', () => {
    const step = g(at(VOICE, { kind: 'recording', startedAt: 0 }), 'release');
    expect(step.state.recording).toEqual({ kind: 'saving' });
    expect(step.effects).toEqual(['stopRecording', 'render']);
  });

  it('release without recording does nothing', () => {
    expect(g(at(VOICE), 'release').effects).toEqual([]);
  });

  it('leaving the foreground stops recording', () => {
    expect(g(at(VOICE, { kind: 'recording', startedAt: 0 }), 'background').effects).toEqual([
      'stopRecording',
      'render',
    ]);
    expect(g(at(VOICE), 'background').effects).toEqual([]);
  });

  it('returning to the foreground redraws and refreshes', () => {
    expect(g(at(2), 'foreground')).toEqual({ state: at(2), effects: ['render', 'refresh'] });
  });

  it('the length limit stops recording', () => {
    const step = reduce(at(VOICE, { kind: 'recording', startedAt: 0 }), { type: 'limit', now: NOW });
    expect(step.state.recording).toEqual({ kind: 'saving' });
    expect(step.effects).toEqual(['stopRecording', 'render']);
  });

  it('noteDone moves saving to done', () => {
    const outcome = { kind: 'saved' as const, durationMs: 4200 };
    const step = reduce(at(VOICE, { kind: 'saving' }), { type: 'noteDone', outcome, now: NOW });
    expect(step.state.recording).toEqual({ kind: 'done', outcome, at: NOW });
    expect(step.effects).toEqual(['render']);
  });

  it('a late noteDone is ignored unless saving', () => {
    const s = at(VOICE);
    expect(reduce(s, { type: 'noteDone', outcome: { kind: 'empty' }, now: NOW })).toEqual({ state: s, effects: [] });
  });
});

describe('toGesture', () => {
  it.each([
    [0, 'click'],
    [1, 'up'],
    [2, 'down'],
    [3, 'double'],
    [4, 'foreground'],
    [5, 'background'],
    [6, 'background'],
    [7, 'background'],
    [9, 'hold'],
    [10, 'release'],
    [8, null],
    [42, null],
  ])('eventType %i -> %s', (eventType, gesture) => {
    expect(toGesture({ textEvent: { eventType } })).toBe(gesture);
    expect(toGesture({ sysEvent: { eventType } })).toBe(gesture);
    expect(toGesture({ listEvent: { eventType } })).toBe(gesture);
  });

  it('reads a payload without eventType as a click (protobuf drops zero values)', () => {
    expect(toGesture({ textEvent: {} })).toBe('click');
    expect(toGesture({ sysEvent: { eventType: null } })).toBe('click');
  });

  it('ignores IMU reports and empty events', () => {
    expect(toGesture({ sysEvent: { imuData: { x: 1 } } })).toBeNull();
    expect(toGesture({})).toBeNull();
    expect(toGesture({ textEvent: null, sysEvent: null })).toBeNull();
  });

  it('prefers the text event when several payloads are present', () => {
    expect(toGesture({ textEvent: { eventType: 2 }, sysEvent: { eventType: 9 } })).toBe('down');
  });
});
