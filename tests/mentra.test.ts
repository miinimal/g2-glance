import { describe, expect, it } from 'vitest';
import { GlanceApp } from '../src/app/controller';
import { LAYOUT } from '../src/core/render';
import {
  MAX_MENTRA_NOTES,
  MentraGlasses,
  MentraNotes,
  MentraStore,
  NOTES_INDEX_KEY,
  base64ToBytes,
  bytesToBase64,
  gestureFromTouch,
  isG2CompatiblePcm,
  scaleBox,
  sceneFor,
  type MentraSessionLike,
  type TextElement,
} from '../mentra/src/background/adapter';

type ChunkHandler = (chunk: { data: string; sampleRate?: number; format?: string }) => void;

class FakeSession implements MentraSessionLike {
  capabilities: { display?: { width?: number; height?: number } | null } | null = { display: { width: 576, height: 288 } };
  frames: TextElement[][] = [];
  data = new Map<string, string>();
  micHandlers = new Set<ChunkHandler>();
  micAllowed = true;

  display = { render: async (elements: TextElement[]) => void this.frames.push(elements) };
  mic = {
    onAudioChunk: (handler: ChunkHandler) => {
      this.micHandlers.add(handler);
      return () => this.micHandlers.delete(handler);
    },
  };
  storage = {
    get: async (key: string) => this.data.get(key) ?? null,
    set: async (key: string, value: string) => void this.data.set(key, value),
    delete: async (key: string) => void this.data.delete(key),
  };
  permissions = { has: () => this.micAllowed };

  emitPcm(bytes: Uint8Array, extra: { sampleRate?: number; format?: string } = { sampleRate: 16_000 }) {
    for (const h of this.micHandlers) h({ data: bytesToBase64(bytes), ...extra });
  }
}

const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

describe('gestureFromTouch', () => {
  it.each([
    ['single_tap', false, 'click'],
    ['swipe_up', false, 'up'],
    ['swipe_down', false, 'down'],
    ['long_press', false, 'hold'],
    ['long_press', true, 'release'],
    ['double_tap', false, null],
    ['triple_tap', false, null],
    ['something_new', false, null],
  ])('%s (recording: %s) -> %s', (kind, recording, gesture) => {
    expect(gestureFromTouch(kind, recording)).toBe(gesture);
  });
});

describe('display scene', () => {
  it('keeps the G2 layout on a 576x288 display', () => {
    const scene = sceneFor({ header: 'H', body: 'B', footer: 'F' }, { width: 576, height: 288 });
    expect(scene.map((e) => e.id)).toEqual(['glance-header', 'glance-body', 'glance-footer']);
    expect(scene[1]!.box).toEqual({ x: 0, y: LAYOUT.body.y, w: 576, h: LAYOUT.body.height });
    expect(scene[0]!.style).toBeUndefined();
    expect(scene[1]!.style).toEqual({ border: 1, radius: 6 });
  });

  it('scales to another canvas, keeps the aspect ratio and lets the host cut overflow', () => {
    expect(scaleBox(LAYOUT.body, { width: 640, height: 480 })).toEqual({ x: 0, y: 44, w: 640, h: 227 });
    const scene = sceneFor({ header: 'H', body: 'B', footer: 'F' }, { width: 640, height: 480 });
    for (const e of scene) {
      expect(e.box.x + e.box.w).toBeLessThanOrEqual(640);
      expect(e.box.y + e.box.h).toBeLessThanOrEqual(480);
      expect(e.style?.overflow).toBe('ellipsis');
    }
  });

  it('falls back to the G2 canvas when the display size is unknown', () => {
    expect(scaleBox(LAYOUT.footer, null)).toEqual({ x: 0, y: 252, w: 576, h: 36 });
    expect(scaleBox(LAYOUT.footer, { width: 0 })).toEqual({ x: 0, y: 252, w: 576, h: 36 });
  });
});

describe('audio helpers', () => {
  it('round-trips bytes through base64, including long notes', () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 256);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
  });

  it.each([
    [{ sampleRate: 16_000 }, true],
    [{}, true],
    [{ sampleRate: 16_000, format: 'pcm_s16le' }, true],
    [{ sampleRate: 48_000 }, false],
    [{ sampleRate: 16_000, format: 'lc3' }, false],
  ])('accepts %j as G2-compatible PCM: %s', (chunk, ok) => {
    expect(isG2CompatiblePcm(chunk)).toBe(ok);
  });
});

describe('MentraGlasses', () => {
  it('renders views as Mentra scenes', async () => {
    const session = new FakeSession();
    const glasses = new MentraGlasses(session, () => {});
    await glasses.show({ header: 'H', body: 'B', footer: 'F' });
    expect(session.frames[0]!.map((e) => e.text)).toEqual(['H', 'B', 'F']);
    await glasses.exit();
    expect(session.frames[1]).toEqual([]);
  });

  it('subscribes to the microphone only while recording and skips foreign formats', async () => {
    const session = new FakeSession();
    const got: number[][] = [];
    const glasses = new MentraGlasses(session, (pcm) => got.push(Array.from(pcm)));
    session.emitPcm(new Uint8Array([1, 2]));
    expect(await glasses.setMic(true)).toBe(true);
    session.emitPcm(new Uint8Array([3, 4]));
    session.emitPcm(new Uint8Array([5, 6]), { sampleRate: 48_000 });
    expect(await glasses.setMic(false)).toBe(true);
    session.emitPcm(new Uint8Array([7, 8]));
    expect(got).toEqual([[3, 4]]);
    expect(glasses.skippedChunks).toBe(1);
    expect(session.micHandlers.size).toBe(0);
  });

  it('refuses the microphone without the manifest permission', async () => {
    const session = new FakeSession();
    session.micAllowed = false;
    expect(await new MentraGlasses(session, () => {}).setMic(true)).toBe(false);
  });
});

describe('Mentra storage', () => {
  it('stores settings strings', async () => {
    const store = new MentraStore(new FakeSession());
    expect(await store.get('x')).toBeNull();
    await store.set('x', 'y');
    expect(await store.get('x')).toBe('y');
  });

  it(`keeps the newest ${MAX_MENTRA_NOTES} notes and deletes the audio of older ones`, async () => {
    const session = new FakeSession();
    const notes = new MentraNotes(session);
    for (let i = 1; i <= MAX_MENTRA_NOTES + 2; i++) {
      await notes.add({ id: `n${i}`, createdAt: i, durationMs: 1000, wav: new Uint8Array([i]), sent: false });
    }
    expect((await notes.list()).map((n) => n.id)).toEqual(['n5', 'n4', 'n3']);
    expect(session.data.has('glance.note.n1')).toBe(false);
    expect(Array.from(base64ToBytes((await notes.wav('n5'))!))).toEqual([5]);
    await notes.remove('n4');
    expect((await notes.list()).map((n) => n.id)).toEqual(['n5', 'n3']);
  });

  it('survives a corrupt index', async () => {
    const session = new FakeSession();
    session.data.set(NOTES_INDEX_KEY, '{oops');
    expect(await new MentraNotes(session).list()).toEqual([]);
  });
});

describe('GlanceApp on Mentra', () => {
  it('runs the shared app: swipes, long press toggles a voice note, note saved to storage', async () => {
    const session = new FakeSession();
    const notes = new MentraNotes(session);
    let app!: GlanceApp;
    const glasses = new MentraGlasses(session, (pcm) => void app.handleAudio(pcm));
    app = new GlanceApp({
      glasses,
      store: new MentraStore(session),
      notes,
      clock: { now: () => Date.now(), setTimeout: () => 0, clearTimeout: () => {} },
      fetch: async () => ({ ok: true, status: 200, text: async () => '' }),
      maxRecordingMs: 60_000,
    });
    const touch = (kind: string) => {
      const g = gestureFromTouch(kind, app.state.recording.kind === 'recording');
      return g ? app.dispatch({ type: 'gesture', gesture: g, now: Date.now() }) : Promise.resolve();
    };
    await app.start();
    expect(session.frames.at(-1)![0]!.text).toMatch(/^NEXT ACTION/);
    await touch('swipe_up');
    expect(session.frames.at(-1)![0]!.text).toMatch(/^VOICE NOTE/);

    await touch('long_press');
    expect(session.micHandlers.size).toBe(1);
    session.emitPcm(new Uint8Array(3200).fill(1));
    await flush();
    await touch('long_press');
    await flush();
    expect(session.micHandlers.size).toBe(0);
    const saved = await notes.list();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.durationMs).toBe(100);
    const wav = base64ToBytes((await notes.wav(saved[0]!.id))!);
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe('RIFF');
    expect(session.frames.at(-1)![1]!.text).toMatch(/^Saved on the phone: 0:00 note\./);
    app.stop();
  });
});
