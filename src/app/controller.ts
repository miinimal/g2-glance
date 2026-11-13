/**
 * GlanceApp wires the pure core to the outside world through small ports, so the whole flow
 * (gestures, refresh, countdown ticks, recording, sending notes) runs in unit tests with fakes.
 */
import { demoFeed } from '../core/demo';
import { parseFeed, type GlanceFeed } from '../core/feed';
import { render, type View } from '../core/render';
import { EMPTY_SETTINGS, SETTINGS_KEY, parseSettings, type Settings } from '../core/settings';
import {
  initialState,
  pageName,
  reduce,
  toGesture,
  type Action,
  type Effect,
  type HubEventLike,
  type NoteOutcome,
  type State,
} from '../core/state';
import { msUntilCountdownChanges } from '../core/time';
import { PcmRecorder } from '../core/wav';
import { nextDeadline } from '../core/feed';

export interface GlassesPort {
  /** Show a view. The first call creates the page; later calls update only what changed. */
  show(view: View): Promise<void>;
  /** Open or close the glasses microphone. Resolves false when the host refuses. */
  setMic(on: boolean): Promise<boolean>;
  /** Ask the system to close the plugin (shows the exit dialog on the glasses). */
  exit(): Promise<void>;
}

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export interface SavedNote {
  id: string;
  createdAt: number;
  durationMs: number;
  wav: Uint8Array;
  sent: boolean;
}

export interface NoteStore {
  add(note: SavedNote): Promise<void>;
}

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface HttpResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type HttpFetch = (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: Uint8Array; signal?: AbortSignal; cache?: 'no-store' },
) => Promise<HttpResponse>;

export interface AppOptions {
  glasses: GlassesPort;
  store: KeyValueStore;
  notes: NoteStore;
  clock: Clock;
  fetch: HttpFetch;
  timeZone?: string;
  /** Longest voice note. */
  maxRecordingMs?: number;
  /** Auto refresh period. */
  refreshEveryMs?: number;
  /** Network timeout for feed and note requests. */
  timeoutMs?: number;
}

export const FEED_CACHE_KEY = 'glance.feed';

const DEFAULTS = {
  maxRecordingMs: 120_000,
  refreshEveryMs: 5 * 60_000,
  timeoutMs: 10_000,
};

export class GlanceApp {
  state: State = initialState;
  feed: GlanceFeed | null = null;
  source: 'demo' | 'remote' = 'demo';
  fetchError: string | null = null;
  settings: Settings = { ...EMPTY_SETTINGS };

  private readonly o: Required<Omit<AppOptions, 'timeZone'>> & { timeZone?: string };
  private recorder: PcmRecorder | null = null;
  private lastView: View | null = null;
  private tickTimer: unknown = null;
  private refreshTimer: unknown = null;
  private refreshing: Promise<void> | null = null;
  private stopped = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: AppOptions) {
    this.o = { ...DEFAULTS, ...options };
  }

  async start(): Promise<void> {
    this.settings = parseSettings(await this.o.store.get(SETTINGS_KEY));
    await this.loadCachedFeed();
    if (!this.settings.feedUrl) this.useDemo();
    await this.render();
    await this.refresh();
    this.scheduleRefresh();
  }

  /** Apply new settings from the phone page and reload the feed. */
  async applySettings(settings: Settings): Promise<void> {
    this.settings = { ...settings };
    await this.o.store.set(SETTINGS_KEY, JSON.stringify(this.settings));
    this.feed = null;
    this.fetchError = null;
    if (!this.settings.feedUrl) this.useDemo();
    else this.source = 'remote';
    await this.render();
    await this.refresh();
  }

  /** Feed an Even Hub event (text/list/sys) into the app. */
  handleEvent(event: HubEventLike): Promise<void> {
    const gesture = toGesture(event);
    if (!gesture) return Promise.resolve();
    return this.dispatch({ type: 'gesture', gesture, now: this.o.clock.now() });
  }

  /** Feed a chunk of microphone PCM into the app. */
  handleAudio(pcm: Uint8Array): Promise<void> {
    if (!this.recorder || this.state.recording.kind !== 'recording') return Promise.resolve();
    const room = this.recorder.push(pcm);
    if (!room) return this.dispatch({ type: 'limit', now: this.o.clock.now() });
    return Promise.resolve();
  }

  /** Stop timers. Called on exit and in tests. */
  stop(): void {
    this.stopped = true;
    if (this.tickTimer !== null) this.o.clock.clearTimeout(this.tickTimer);
    if (this.refreshTimer !== null) this.o.clock.clearTimeout(this.refreshTimer);
    this.tickTimer = this.refreshTimer = null;
  }

  /** Actions run one after another so effects never interleave. */
  dispatch(action: Action): Promise<void> {
    const run = async () => {
      const step = reduce(this.state, action);
      this.state = step.state;
      for (const effect of step.effects) await this.run(effect);
    };
    this.queue = this.queue.then(run, run);
    return this.queue;
  }

  private async run(effect: Effect): Promise<void> {
    switch (effect) {
      case 'render':
        return this.render();
      case 'refresh':
        // Not awaited inside the queue: a slow network must not block gestures.
        void this.refresh();
        return;
      case 'exit':
        this.stop();
        return this.o.glasses.exit();
      case 'startRecording':
        return this.startRecording();
      case 'stopRecording':
        // Finishing a note posts to the network, so it runs outside the queue too.
        void this.finishRecording();
        return;
    }
  }

  view(): View {
    return render({
      state: this.state,
      feed: this.feed,
      source: this.source,
      fetchError: this.fetchError,
      noteEndpoint: this.settings.noteUrl !== '',
      maxRecordingMs: this.o.maxRecordingMs,
      now: this.o.clock.now(),
      timeZone: this.o.timeZone,
    });
  }

  async render(): Promise<void> {
    if (this.stopped) return;
    const view = this.view();
    const last = this.lastView;
    if (!last || last.header !== view.header || last.body !== view.body || last.footer !== view.footer) {
      this.lastView = view;
      await this.o.glasses.show(view);
    }
    this.scheduleTick();
  }

  refresh(): Promise<void> {
    if (!this.refreshing) {
      this.refreshing = this.load().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private useDemo(): void {
    this.source = 'demo';
    this.feed = demoFeed(this.o.clock.now());
    this.fetchError = null;
  }

  private async loadCachedFeed(): Promise<void> {
    const raw = await this.o.store.get(FEED_CACHE_KEY);
    if (!raw || !this.settings.feedUrl) return;
    try {
      const cached = JSON.parse(raw) as { url?: string; text?: string };
      if (cached.url !== this.settings.feedUrl || typeof cached.text !== 'string') return;
      const result = parseFeed(cached.text);
      if (result.ok) {
        this.feed = result.feed;
        this.source = 'remote';
      }
    } catch {
      // A corrupt cache is ignored; the next fetch replaces it.
    }
  }

  private async load(): Promise<void> {
    const url = this.settings.feedUrl;
    if (!url) {
      this.useDemo();
      await this.render();
      return;
    }
    this.source = 'remote';
    try {
      const res = await this.request(url, { cache: 'no-store' });
      if (!res.ok) throw new FetchError(`HTTP ${res.status}`);
      const text = await res.text();
      const result = parseFeed(text);
      if (!result.ok) throw new FetchError('invalid feed');
      if (url !== this.settings.feedUrl) return; // settings changed while loading
      this.feed = result.feed;
      this.fetchError = null;
      await this.o.store.set(FEED_CACHE_KEY, JSON.stringify({ url, text }));
    } catch (err) {
      if (url !== this.settings.feedUrl) return;
      this.fetchError = err instanceof FetchError ? err.message : 'network error';
    }
    await this.render();
  }

  private async request(
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: Uint8Array; cache?: 'no-store' },
  ): Promise<HttpResponse> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = this.o.clock.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.o.timeoutMs);
    try {
      return await this.o.fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      if (timedOut) throw new FetchError('timed out');
      throw err;
    } finally {
      this.o.clock.clearTimeout(timer);
    }
  }

  private scheduleRefresh(): void {
    if (this.stopped) return;
    this.refreshTimer = this.o.clock.setTimeout(() => {
      void this.refresh().then(() => this.scheduleRefresh());
    }, this.o.refreshEveryMs);
  }

  /** Re-render exactly when the visible text can change: every second while recording, else per minute. */
  private scheduleTick(): void {
    if (this.stopped) return;
    if (this.tickTimer !== null) this.o.clock.clearTimeout(this.tickTimer);
    const now = this.o.clock.now();
    let delay: number;
    const r = this.state.recording;
    if (r.kind === 'recording') {
      delay = 1000 - ((now - r.startedAt) % 1000);
    } else if (pageName(this.state) === 'deadline' && this.feed) {
      const next = nextDeadline(this.feed, now);
      delay = next ? msUntilCountdownChanges(next.deadline.at - now) : 60_000 - (now % 60_000);
    } else {
      delay = 60_000 - (now % 60_000);
    }
    this.tickTimer = this.o.clock.setTimeout(() => {
      this.tickTimer = null;
      void this.render();
    }, delay);
  }

  private async startRecording(): Promise<void> {
    this.recorder = new PcmRecorder(this.o.maxRecordingMs);
    const ok = await this.o.glasses.setMic(true).catch(() => false);
    if (!ok) {
      this.recorder = null;
      // Runs inside the dispatch queue, so apply the transition directly instead of re-dispatching.
      this.state = reduce(
        { ...this.state, recording: { kind: 'saving' } },
        {
          type: 'noteDone',
          outcome: { kind: 'failed', durationMs: 0, reason: 'microphone unavailable' },
          now: this.o.clock.now(),
        },
      ).state;
      await this.render();
    }
  }

  private async finishRecording(): Promise<void> {
    await this.o.glasses.setMic(false).catch(() => false);
    const recorder = this.recorder;
    this.recorder = null;
    const outcome = await this.saveNote(recorder);
    await this.dispatch({ type: 'noteDone', outcome, now: this.o.clock.now() });
  }

  private async saveNote(recorder: PcmRecorder | null): Promise<NoteOutcome> {
    if (!recorder || recorder.byteLength === 0) return { kind: 'empty' };
    const durationMs = Math.round(recorder.durationMs);
    const wav = recorder.toWav();
    const createdAt = this.o.clock.now();
    let sent = false;
    let failure: string | null = null;
    if (this.settings.noteUrl) {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'audio/wav',
          'X-Glance-Duration-Ms': String(durationMs),
          'X-Glance-Recorded-At': new Date(createdAt).toISOString(),
        };
        if (this.settings.noteToken) headers.Authorization = `Bearer ${this.settings.noteToken}`;
        const res = await this.request(this.settings.noteUrl, { method: 'POST', headers, body: wav });
        if (!res.ok) throw new FetchError(`HTTP ${res.status}`);
        sent = true;
      } catch (err) {
        failure = err instanceof FetchError ? err.message : 'network error';
      }
    }
    try {
      await this.o.notes.add({ id: `note-${createdAt}`, createdAt, durationMs, wav, sent });
    } catch {
      if (!sent) return { kind: 'failed', durationMs, reason: failure ?? 'could not save' };
    }
    if (sent) return { kind: 'sent', durationMs };
    if (failure) return { kind: 'failed', durationMs, reason: failure };
    return { kind: 'saved', durationMs };
  }
}

class FetchError extends Error {}
