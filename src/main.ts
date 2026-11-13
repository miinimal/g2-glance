/**
 * Entry point. The page itself is the phone-side settings screen; the glasses UI runs through the
 * Even Hub bridge. Opened in a normal browser, the page shows a live preview of the glasses text
 * instead, so the app can be developed without the simulator.
 */
import { waitForEvenAppBridge, type EvenAppBridge } from '@evenrealities/even_hub_sdk';
import manifest from '../app.json';
import { GlanceApp, type GlassesPort, type SavedNote } from './app/controller';
import { EvenHubGlasses } from './bridge/glasses';
import { BridgeStore, BrowserStore, IndexedDbNotes } from './bridge/storage';
import type { View } from './core/render';
import { checkUrl, whitelistEntry, type Settings } from './core/settings';
import { formatDuration } from './core/time';
import './style.css';

const BRIDGE_TIMEOUT_MS = 3000;

const whitelist: string[] =
  (manifest.permissions as { name: string; whitelist?: string[] }[]).find((p) => p.name === 'network')
    ?.whitelist ?? [];

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

/** True when a host WebView (the Even App or the simulator) has injected its message handler. */
function hasHost(): boolean {
  const w = window as unknown as { flutter_inappwebview?: { callHandler?: unknown } };
  return typeof w.flutter_inappwebview?.callHandler === 'function';
}

/**
 * The SDK creates a bridge object in any browser, so "a bridge exists" does not mean "running in
 * the Even App". Wait briefly for the host's handler, then for the bridge.
 */
async function connectBridge(): Promise<EvenAppBridge | null> {
  const deadline = Date.now() + BRIDGE_TIMEOUT_MS;
  while (!hasHost()) {
    if (Date.now() > deadline) return null;
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  const timeout = new Promise<null>((resolve) =>
    window.setTimeout(() => resolve(null), Math.max(0, deadline - Date.now())),
  );
  try {
    return await Promise.race([waitForEvenAppBridge(), timeout]);
  } catch {
    return null;
  }
}

/** Browser-only glasses: draws the three containers into the preview panel. */
class PreviewGlasses implements GlassesPort {
  async show(view: View): Promise<void> {
    $('preview-header').textContent = view.header;
    $('preview-body').textContent = view.body;
    $('preview-footer').textContent = view.footer;
  }
  async setMic(): Promise<boolean> {
    return false;
  }
  async exit(): Promise<void> {
    $('preview-body').textContent = '(exit dialog would open on the glasses)';
  }
}

const clock = {
  now: () => Date.now(),
  setTimeout: (fn: () => void, ms: number) => window.setTimeout(fn, ms),
  clearTimeout: (h: unknown) => window.clearTimeout(h as number),
};

async function main(): Promise<void> {
  const bridge = await connectBridge();
  const notes = new IndexedDbNotes();
  const preview = new PreviewGlasses();
  const app = new GlanceApp({
    glasses: bridge ? new EvenHubGlasses(bridge) : preview,
    store: bridge ? new BridgeStore(bridge) : new BrowserStore(),
    notes,
    clock,
    fetch: (url, init) => window.fetch(url, init as RequestInit),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

  document.body.dataset.mode = bridge ? 'device' : 'browser';
  if (bridge) {
    bridge.onEvenHubEvent((event) => {
      if (event.audioEvent) void app.handleAudio(event.audioEvent.audioPcm);
      else void app.handleEvent(event);
    });
  } else {
    wirePreviewControls(app);
  }

  wireForm(app);
  try {
    await app.start();
  } catch (err) {
    $('status').textContent = `Could not start: ${err instanceof Error ? err.message : String(err)}`;
    return;
  }
  fillForm(app.settings);
  await showNotes(notes);
  window.setInterval(() => void showNotes(notes), 15_000);
  window.setInterval(() => showStatus(app), 5_000);
  showStatus(app);
}

function wirePreviewControls(app: GlanceApp): void {
  const map: Record<string, number> = { click: 0, up: 1, down: 2, double: 3 };
  for (const [name, eventType] of Object.entries(map)) {
    $(`btn-${name}`).addEventListener('click', () => void app.handleEvent({ textEvent: { eventType } }));
  }
}

function fillForm(s: Settings): void {
  ($('feed-url') as HTMLInputElement).value = s.feedUrl;
  ($('note-url') as HTMLInputElement).value = s.noteUrl;
  ($('note-token') as HTMLInputElement).value = s.noteToken;
  showWhitelistHints(s);
}

function readForm(): Settings {
  return {
    feedUrl: ($('feed-url') as HTMLInputElement).value.trim(),
    noteUrl: ($('note-url') as HTMLInputElement).value.trim(),
    noteToken: ($('note-token') as HTMLInputElement).value.trim(),
  };
}

function showWhitelistHints(s: Settings): void {
  const missing = [s.feedUrl, s.noteUrl]
    .filter((u) => u !== '')
    .map((u) => whitelistEntry(u))
    .filter((o): o is string => o !== null && !whitelist.includes(o));
  const hint = $('whitelist-hint');
  hint.hidden = missing.length === 0;
  hint.textContent =
    missing.length === 0
      ? ''
      : `Add ${missing.join(' and ')} to the network whitelist in app.json and rebuild, or the Even App may block it.`;
}

function wireForm(app: GlanceApp): void {
  $('settings').addEventListener('submit', (e) => {
    e.preventDefault();
    const s = readForm();
    const feedErr = checkUrl(s.feedUrl);
    const noteErr = checkUrl(s.noteUrl);
    $('feed-error').textContent = feedErr ? `Feed URL ${feedErr}.` : '';
    $('note-error').textContent = noteErr ? `Note endpoint ${noteErr}.` : '';
    if (feedErr || noteErr) return;
    showWhitelistHints(s);
    $('saved').textContent = 'Saved.';
    window.setTimeout(() => ($('saved').textContent = ''), 2000);
    void app.applySettings(s).then(() => showStatus(app));
  });
}

function showStatus(app: GlanceApp): void {
  const parts = [app.source === 'demo' ? 'Showing demo data.' : 'Showing your feed.'];
  if (app.fetchError) parts.push(`Last refresh failed: ${app.fetchError}.`);
  $('status').textContent = parts.join(' ');
}

async function showNotes(notes: IndexedDbNotes): Promise<void> {
  let list: SavedNote[] = [];
  try {
    list = await notes.list();
  } catch {
    $('notes').textContent = 'Notes storage is not available in this browser.';
    return;
  }
  const root = $('notes');
  root.replaceChildren();
  if (list.length === 0) {
    root.textContent = 'No notes yet. On the glasses, open the Voice note page and hold to record.';
    return;
  }
  for (const note of list) {
    const row = document.createElement('div');
    row.className = 'note';
    const blob = new Blob([note.wav as BlobPart], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const label = document.createElement('span');
    label.textContent = `${new Date(note.createdAt).toLocaleString()} · ${formatDuration(note.durationMs)}${note.sent ? ' · sent' : ''}`;
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = url;
    const link = document.createElement('a');
    link.href = url;
    link.download = `${note.id}.wav`;
    link.textContent = 'Download';
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = 'Delete';
    del.addEventListener('click', () => void notes.remove(note.id).then(() => showNotes(notes)));
    row.append(label, audio, link, del);
    root.append(row);
  }
}

void main();
