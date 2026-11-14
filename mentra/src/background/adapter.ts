/**
 * MentraOS adapters: implement the GlanceApp ports on top of a Mentra `MiniappSession`.
 *
 * Only the narrow slice of the session used here is typed (`MentraSessionLike`), so the
 * adapters run in unit tests with a fake session and in the Mentra App's background JSContext
 * with the real one. The background is a bare JavaScript engine: no DOM, no IndexedDB, no Node.
 */
import type { GlassesPort, KeyValueStore, NoteStore, SavedNote } from '../../../src/app/controller';
import { LAYOUT, type View } from '../../../src/core/render';
import type { Gesture } from '../../../src/core/state';

/** Canvas the shared layout is designed for (Even Realities G2). */
export const BASE_WIDTH = 576;
export const BASE_HEIGHT = 288;

export interface RenderBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextElement {
  type: 'text';
  id: string;
  box: RenderBox;
  text: string;
  style?: { border?: number; radius?: number; overflow?: 'clip' | 'ellipsis'; maxLines?: number };
}

export interface DisplayLike {
  width?: number;
  height?: number;
}

export interface MentraSessionLike {
  capabilities?: { display?: DisplayLike | null } | null;
  display: { render(elements: TextElement[]): Promise<unknown> | unknown };
  mic: {
    onAudioChunk(handler: (chunk: { data: string; sampleRate?: number; format?: string }) => void): () => void;
    stop?(): void;
  };
  storage: {
    get(key: string): Promise<string | null | undefined>;
    set(key: string, value: string): Promise<unknown>;
    delete(key: string): Promise<unknown>;
  };
  permissions?: { has(type: 'microphone'): boolean };
}

/**
 * Map a Mentra touch gesture to a glance gesture.
 *
 * Mentra reports `long_press` once, with no release event, so a long press toggles recording:
 * it starts a note when idle and stops it while recording. Mentra has no plugin exit dialog
 * (the Mentra App closes miniapps), so double tap is not mapped to exit.
 */
export function gestureFromTouch(kind: string, recording: boolean): Gesture | null {
  switch (kind) {
    case 'single_tap':
      return 'click';
    case 'swipe_up':
      return 'up';
    case 'swipe_down':
      return 'down';
    case 'long_press':
      return recording ? 'release' : 'hold';
    default:
      return null;
  }
}

/** Scale the shared 576x288 layout to the connected display, keeping the aspect ratio. */
export function scaleBox(box: { x: number; y: number; width: number; height: number }, display: DisplayLike | null | undefined): RenderBox {
  const width = display?.width && display.width > 0 ? display.width : BASE_WIDTH;
  const height = display?.height && display.height > 0 ? display.height : BASE_HEIGHT;
  const k = Math.min(width / BASE_WIDTH, height / BASE_HEIGHT);
  return {
    x: Math.round(box.x * k),
    y: Math.round(box.y * k),
    w: Math.round(box.width * k),
    h: Math.round(box.height * k),
  };
}

const SLOTS: (keyof View)[] = ['header', 'body', 'footer'];

/** The three glance containers as one Mentra scene. */
export function sceneFor(view: View, display: DisplayLike | null | undefined): TextElement[] {
  const nativeG2 = (display?.width ?? BASE_WIDTH) === BASE_WIDTH && (display?.height ?? BASE_HEIGHT) === BASE_HEIGHT;
  return SLOTS.map((slot) => {
    const box = LAYOUT[slot];
    const element: TextElement = {
      type: 'text',
      id: `glance-${slot}`,
      box: scaleBox(box, display),
      text: view[slot],
      // Text is fitted with G2 font metrics. On other displays the host font differs, so let the
      // host cut overflow with an ellipsis rather than clip mid-line.
      style: nativeG2 ? undefined : { overflow: 'ellipsis' },
    };
    if (box.border > 0) element.style = { ...element.style, border: box.border, radius: 6 };
    return element;
  });
}

/** Decode base64 into bytes (the background has `atob`, not `Buffer`). */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Encode bytes as base64 in chunks, so long notes do not overflow the call stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(bin);
}

/** True for 16 kHz linear PCM, the only format the WAV recorder accepts. */
export function isG2CompatiblePcm(chunk: { sampleRate?: number; format?: string }): boolean {
  if (chunk.sampleRate !== undefined && chunk.sampleRate !== 16_000) return false;
  if (chunk.format && /lc3|opus|aac|mp3/i.test(chunk.format)) return false;
  return true;
}

export class MentraGlasses implements GlassesPort {
  private unsubscribeMic: (() => void) | null = null;
  /** Chunks dropped because they were not 16 kHz PCM. */
  skippedChunks = 0;

  constructor(
    private readonly session: MentraSessionLike,
    private readonly onPcm: (pcm: Uint8Array) => void,
  ) {}

  async show(view: View): Promise<void> {
    await this.session.display.render(sceneFor(view, this.session.capabilities?.display));
  }

  async setMic(on: boolean): Promise<boolean> {
    if (!on) {
      this.unsubscribeMic?.();
      this.unsubscribeMic = null;
      return true;
    }
    if (this.session.permissions && !this.session.permissions.has('microphone')) return false;
    this.unsubscribeMic?.();
    this.unsubscribeMic = this.session.mic.onAudioChunk((chunk) => {
      if (!isG2CompatiblePcm(chunk)) {
        this.skippedChunks++;
        return;
      }
      this.onPcm(base64ToBytes(chunk.data));
    });
    return true;
  }

  /** Mentra has no plugin exit dialog; clear the glance from the display instead. */
  async exit(): Promise<void> {
    await this.session.display.render([]);
  }
}

export class MentraStore implements KeyValueStore {
  constructor(private readonly session: MentraSessionLike) {}

  async get(key: string): Promise<string | null> {
    const value = await this.session.storage.get(key);
    return value === undefined || value === null || value === '' ? null : value;
  }

  async set(key: string, value: string): Promise<void> {
    await this.session.storage.set(key, value);
  }
}

export interface NoteMeta {
  id: string;
  createdAt: number;
  durationMs: number;
  sent: boolean;
}

export const NOTES_INDEX_KEY = 'glance.notes';
/** Notes kept in Mentra storage (strings only, so each WAV is stored as base64). */
export const MAX_MENTRA_NOTES = 3;

/** Voice notes in Mentra storage: an index plus one base64 WAV per note, newest first. */
export class MentraNotes implements NoteStore {
  constructor(private readonly session: MentraSessionLike) {}

  async list(): Promise<NoteMeta[]> {
    const raw = await this.session.storage.get(NOTES_INDEX_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as NoteMeta[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async wav(id: string): Promise<string | null> {
    return (await this.session.storage.get(`glance.note.${id}`)) ?? null;
  }

  async add(note: SavedNote): Promise<void> {
    await this.session.storage.set(`glance.note.${note.id}`, bytesToBase64(note.wav));
    const meta: NoteMeta = { id: note.id, createdAt: note.createdAt, durationMs: note.durationMs, sent: note.sent };
    const all = [meta, ...(await this.list()).filter((n) => n.id !== note.id)];
    const keep = all.slice(0, MAX_MENTRA_NOTES);
    for (const old of all.slice(MAX_MENTRA_NOTES)) await this.session.storage.delete(`glance.note.${old.id}`);
    await this.session.storage.set(NOTES_INDEX_KEY, JSON.stringify(keep));
  }

  async remove(id: string): Promise<void> {
    await this.session.storage.delete(`glance.note.${id}`);
    const rest = (await this.list()).filter((n) => n.id !== id);
    await this.session.storage.set(NOTES_INDEX_KEY, JSON.stringify(rest));
  }
}
