import { beforeEach, describe, expect, it } from 'vitest';
import {
  FEED_CACHE_KEY,
  GlanceApp,
  type Clock,
  type GlassesPort,
  type HttpFetch,
  type HttpResponse,
  type KeyValueStore,
  type NoteStore,
  type SavedNote,
} from '../src/app/controller';
import type { View } from '../src/core/render';
import { SETTINGS_KEY } from '../src/core/settings';

const START = Date.parse('2026-11-13T23:00:00Z');
const FEED_URL = 'https://feeds.example.com/me.json';
const NOTE_URL = 'https://notes.example.com/in';

class FakeClock implements Clock {
  t = START;
  private timers = new Map<number, { at: number; fn: () => void }>();
  private next = 1;
  now = () => this.t;
  setTimeout = (fn: () => void, ms: number) => {
    const id = this.next++;
    this.timers.set(id, { at: this.t + ms, fn });
    return id;
  };
  clearTimeout = (h: unknown) => {
    this.timers.delete(h as number);
  };
  /** Advance time, firing due timers in order. */
  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    for (;;) {
      const due = [...this.timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.t = due[1].at;
      due[1].fn();
      await flush();
    }
    this.t = end;
  }
  pending(): number {
    return this.timers.size;
  }
}

class FakeGlasses implements GlassesPort {
  views: View[] = [];
  mic: boolean[] = [];
  exits = 0;
  micOk = true;
  async show(view: View) {
    this.views.push(view);
  }
  async setMic(on: boolean) {
    this.mic.push(on);
    return this.micOk;
  }
  async exit() {
    this.exits++;
  }
  get last(): View {
    return this.views[this.views.length - 1]!;
  }
}

class MemoryStore implements KeyValueStore {
  data = new Map<string, string>();
  async get(k: string) {
    return this.data.get(k) ?? null;
  }
  async set(k: string, v: string) {
    this.data.set(k, v);
  }
}

class MemoryNotes implements NoteStore {
  notes: SavedNote[] = [];
  async add(n: SavedNote) {
    this.notes.push(n);
  }
}

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Uint8Array;
  signal?: AbortSignal;
}

function response(status: number, body = ''): HttpResponse {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

const feedJson = (title: string) =>
  JSON.stringify({
    updated: '2026-11-13T22:55:00Z',
    next_action: { title, where: 'computer' },
    deadlines: [{ name: 'Report', at: '2026-11-14T03:00:00Z' }],
    counters: { mentions: 1, decisions: 0 },
  });

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

let clock: FakeClock;
let glasses: FakeGlasses;
let store: MemoryStore;
let notes: MemoryNotes;
let calls: Call[];
let reply: (call: Call) => Promise<HttpResponse>;

const fetch: HttpFetch = async (url, init) => {
  const call: Call = { url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body, signal: init.signal };
  calls.push(call);
  return reply(call);
};

function makeApp(extra: Partial<ConstructorParameters<typeof GlanceApp>[0]> = {}) {
  return new GlanceApp({ glasses, store, notes, clock, fetch, timeZone: 'UTC', ...extra });
}

async function withSettings(s: object) {
  await store.set(SETTINGS_KEY, JSON.stringify(s));
}

const pcm = (ms: number) => new Uint8Array(ms * 32).fill(1); // 16 kHz * 2 bytes = 32 bytes/ms

beforeEach(() => {
  clock = new FakeClock();
  glasses = new FakeGlasses();
  store = new MemoryStore();
  notes = new MemoryNotes();
  calls = [];
  reply = async () => response(200, feedJson('Ship v0.1.0'));
});

describe('start and refresh', () => {
  it('shows demo data when no feed URL is set, without network calls', async () => {
    const app = makeApp();
    await app.start();
    expect(calls).toEqual([]);
    expect(glasses.last.header).toMatch(/^NEXT ACTION/);
    expect(glasses.last.footer).toMatch(/^demo data/);
    app.stop();
  });

  it('loads the configured feed', async () => {
    await withSettings({ feedUrl: FEED_URL });
    const app = makeApp();
    await app.start();
    expect(calls.map((c) => c.url)).toEqual([FEED_URL]);
    expect(glasses.last.body).toBe('Ship v0.1.0\n\nWhere: computer');
    expect(glasses.last.footer).toMatch(/^updated 5m ago/);
    expect(JSON.parse(store.data.get(FEED_CACHE_KEY)!)).toEqual({ url: FEED_URL, text: feedJson('Ship v0.1.0') });
    app.stop();
  });

  it('tap refreshes', async () => {
    await withSettings({ feedUrl: FEED_URL });
    const app = makeApp();
    await app.start();
    reply = async () => response(200, feedJson('Second'));
    await app.handleEvent({ textEvent: {} }); // click with eventType dropped by protobuf
    await flush();
    expect(calls).toHaveLength(2);
    expect(glasses.last.body).toMatch(/^Second/);
    app.stop();
  });

  it('refreshes by itself every 5 minutes', async () => {
    await withSettings({ feedUrl: FEED_URL });
    const app = makeApp();
    await app.start();
    await clock.advance(5 * 60_000);
    expect(calls).toHaveLength(2);
    await clock.advance(5 * 60_000);
    expect(calls).toHaveLength(3);
    app.stop();
  });

  it('keeps the last good feed when offline and says so', async () => {
    await withSettings({ feedUrl: FEED_URL });
    const app = makeApp();
    await app.start();
    reply = async () => response(503);
    await app.refresh();
    expect(glasses.last.body).toMatch(/^Ship v0.1.0/);
    expect(glasses.last.footer).toMatch(/^offline - updated 5m ago/);
    app.stop();
  });

  it('shows the cached feed at start before the network answers', async () => {
    await withSettings({ feedUrl: FEED_URL });
    await store.set(FEED_CACHE_KEY, JSON.stringify({ url: FEED_URL, text: feedJson('Cached') }));
    let release!: () => void;
    reply = () => new Promise((resolve) => (release = () => resolve(response(200, feedJson('Fresh')))));
    const app = makeApp();
    const started = app.start();
    await flush();
    expect(glasses.views[0]!.body).toMatch(/^Cached/);
    release();
    await started;
    expect(glasses.last.body).toMatch(/^Fresh/);
    app.stop();
  });

  it('ignores a cache written for another URL', async () => {
    await withSettings({ feedUrl: FEED_URL });
    await store.set(FEED_CACHE_KEY, JSON.stringify({ url: 'https://old.example.com/x.json', text: feedJson('Old') }));
    reply = async () => response(404);
    const app = makeApp();
    await app.start();
    expect(glasses.last.body).toBe('Could not load the feed.');
    expect(glasses.last.footer).toMatch(/^no data - HTTP 404/);
    app.stop();
  });

  it('reports an invalid feed and a timeout', async () => {
    await withSettings({ feedUrl: FEED_URL });
    reply = async () => response(200, '{"hello":1}');
    const app = makeApp({ timeoutMs: 1000 });
    await app.start();
    expect(app.fetchError).toBe('invalid feed');
    // Like real fetch: never answers, rejects when the request is aborted.
    reply = (call) =>
      new Promise((_, reject) => call.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    const pending = app.refresh();
    await clock.advance(1000);
    await pending;
    expect(app.fetchError).toBe('timed out');
    app.stop();
  });

  it('collapses concurrent refreshes into one request', async () => {
    await withSettings({ feedUrl: FEED_URL });
    const app = makeApp();
    await app.start();
    await Promise.all([app.refresh(), app.refresh(), app.refresh()]);
    expect(calls).toHaveLength(2);
    app.stop();
  });

  it('applySettings saves settings and switches the source', async () => {
    const app = makeApp();
    await app.start();
    await app.applySettings({ feedUrl: FEED_URL, noteUrl: '', noteToken: '' });
    expect(JSON.parse(store.data.get(SETTINGS_KEY)!).feedUrl).toBe(FEED_URL);
    expect(app.source).toBe('remote');
    expect(glasses.last.body).toMatch(/^Ship v0.1.0/);
    await app.applySettings({ feedUrl: '', noteUrl: '', noteToken: '' });
    expect(app.source).toBe('demo');
    app.stop();
  });
});

describe('gestures and timers', () => {
  it('swipes through all four pages', async () => {
    const app = makeApp();
    await app.start();
    const headers: string[] = [];
    for (let i = 0; i < 4; i++) {
      await app.handleEvent({ textEvent: { eventType: 2 } });
      headers.push(glasses.last.header.split(/ {2,}/)[0]!);
    }
    expect(headers).toEqual(['NEXT DEADLINE', 'INBOX', 'VOICE NOTE', 'NEXT ACTION']);
    app.stop();
  });

  it('double tap asks the system to exit and stops timers', async () => {
    const app = makeApp();
    await app.start();
    await app.handleEvent({ sysEvent: { eventType: 3 } });
    expect(glasses.exits).toBe(1);
    expect(clock.pending()).toBe(0);
  });

  it('updates the countdown on the minute it changes and sends only changed text', async () => {
    await withSettings({ feedUrl: FEED_URL });
    const app = makeApp();
    await app.start();
    await app.handleEvent({ textEvent: { eventType: 2 } }); // deadline page, due 04:00 from now
    expect(glasses.last.body).toContain('in 4h 0m');
    const before = glasses.views.length;
    await clock.advance(1);
    expect(glasses.last.body).toContain('in 3h 59m');
    expect(glasses.views.length).toBe(before + 1);
    await clock.advance(60_000);
    expect(glasses.last.body).toContain('in 3h 58m');
    app.stop();
  });

  it('ignores unknown events', async () => {
    const app = makeApp();
    await app.start();
    const n = glasses.views.length;
    await app.handleEvent({ sysEvent: { eventType: 8, imuData: { x: 1 } } });
    await app.handleEvent({});
    expect(glasses.views.length).toBe(n);
    app.stop();
  });
});

describe('voice notes', () => {
  async function onVoicePage(settings: object = {}) {
    await withSettings(settings);
    const app = makeApp({ maxRecordingMs: 10_000 });
    await app.start();
    await app.handleEvent({ textEvent: { eventType: 1 } }); // swipe up wraps to Voice note
    expect(glasses.last.header).toMatch(/^VOICE NOTE/);
    return app;
  }

  it('records while held and saves a WAV on the phone', async () => {
    const app = await onVoicePage();
    await app.handleEvent({ sysEvent: { eventType: 9 } });
    expect(glasses.mic).toEqual([true]);
    expect(glasses.last.body).toMatch(/^● Recording 0:00/);
    await app.handleAudio(pcm(100));
    await clock.advance(1000);
    expect(glasses.last.body).toMatch(/^● Recording 0:01/);
    await app.handleAudio(pcm(1400));
    await app.handleEvent({ sysEvent: { eventType: 10 } });
    await flush();
    expect(glasses.mic).toEqual([true, false]);
    expect(notes.notes).toHaveLength(1);
    expect(notes.notes[0]!.durationMs).toBe(1500);
    expect(notes.notes[0]!.wav.length).toBe(44 + 1500 * 32);
    expect(notes.notes[0]!.sent).toBe(false);
    expect(glasses.last.body).toMatch(/^Saved on the phone: 0:01 note\./);
    expect(calls).toEqual([]);
    app.stop();
  });

  it('POSTs the note to the configured endpoint with the token', async () => {
    const app = await onVoicePage({ noteUrl: NOTE_URL, noteToken: 'secret-token' });
    reply = async () => response(201);
    await app.handleEvent({ sysEvent: { eventType: 9 } });
    await app.handleAudio(pcm(2000));
    await app.handleEvent({ sysEvent: { eventType: 10 } });
    await flush();
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.method).toBe('POST');
    expect(call.url).toBe(NOTE_URL);
    expect(call.headers['Content-Type']).toBe('audio/wav');
    expect(call.headers.Authorization).toBe('Bearer secret-token');
    expect(call.headers['X-Glance-Duration-Ms']).toBe('2000');
    expect(String.fromCharCode(...call.body!.subarray(0, 4))).toBe('RIFF');
    expect(notes.notes[0]!.sent).toBe(true);
    expect(glasses.last.body).toMatch(/^Sent: 0:02 note\./);
    app.stop();
  });

  it('keeps the note on the phone when sending fails', async () => {
    const app = await onVoicePage({ noteUrl: NOTE_URL });
    reply = async () => response(500);
    await app.handleEvent({ sysEvent: { eventType: 9 } });
    await app.handleAudio(pcm(500));
    await app.handleEvent({ sysEvent: { eventType: 10 } });
    await flush();
    expect(notes.notes).toHaveLength(1);
    expect(glasses.last.body).toContain('Send failed: HTTP 500');
    app.stop();
  });

  it('stops by itself at the maximum length', async () => {
    const app = await onVoicePage();
    await app.handleEvent({ sysEvent: { eventType: 9 } });
    for (let i = 0; i < 120; i++) await app.handleAudio(pcm(100));
    await flush();
    expect(glasses.mic).toEqual([true, false]);
    expect(notes.notes[0]!.durationMs).toBe(10_000);
    app.stop();
  });

  it('reports an empty note when nothing arrived', async () => {
    const app = await onVoicePage();
    await app.handleEvent({ sysEvent: { eventType: 9 } });
    await app.handleEvent({ sysEvent: { eventType: 10 } });
    await flush();
    expect(notes.notes).toEqual([]);
    expect(glasses.last.body).toMatch(/^Nothing was recorded\./);
    app.stop();
  });

  it('reports a refused microphone', async () => {
    glasses.micOk = false;
    const app = await onVoicePage();
    await app.handleEvent({ sysEvent: { eventType: 9 } });
    await flush();
    expect(glasses.last.body).toContain('Send failed: microphone unavailable');
    expect(app.state.recording.kind).toBe('done');
    app.stop();
  });

  it('ignores audio when not recording', async () => {
    const app = await onVoicePage();
    await app.handleAudio(pcm(100));
    expect(notes.notes).toEqual([]);
    app.stop();
  });

  it('double tap while recording saves the note, then exits', async () => {
    const app = await onVoicePage();
    await app.handleEvent({ sysEvent: { eventType: 9 } });
    await app.handleAudio(pcm(300));
    await app.handleEvent({ sysEvent: { eventType: 3 } });
    await flush();
    expect(glasses.exits).toBe(1);
    expect(notes.notes).toHaveLength(1);
  });
});
