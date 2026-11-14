/**
 * Settings WebView for Glance on MentraOS. Talks to the background only through the typed
 * `mentra` channels; it has no direct access to the glasses.
 */
import type { MentraTyped } from '@mentra/miniapp/ui';
import { checkUrl, type Settings } from '../../../src/core/settings';
import { formatDuration } from '../../../src/core/time';
import type { Channels, GlanceStatus } from '../shared/channels';

declare const mentra: MentraTyped<Channels>;

interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

function input(id: string): HTMLInputElement {
  return $(id) as HTMLInputElement;
}

function applySafeArea(): void {
  const globals = (window as unknown as { MentraOS?: { safeAreaInsets?: Insets } }).MentraOS;
  const i = globals?.safeAreaInsets;
  if (!i) return;
  const root = $('root');
  root.style.paddingTop = `${i.top + 12}px`;
  root.style.paddingBottom = `${i.bottom + 12}px`;
  root.style.paddingLeft = `${i.left + 16}px`;
  root.style.paddingRight = `${i.right + 16}px`;
}

function fill(s: Settings): void {
  input('feed-url').value = s.feedUrl;
  input('note-url').value = s.noteUrl;
  input('note-token').value = s.noteToken;
}

function showStatus(status: GlanceStatus): void {
  $('preview-header').textContent = status.view.header;
  $('preview-body').textContent = status.view.body;
  $('preview-footer').textContent = status.view.footer;
  const parts = [status.source === 'demo' ? 'Showing demo data.' : 'Showing your feed.'];
  if (status.fetchError) parts.push(`Last refresh failed: ${status.fetchError}.`);
  $('status').textContent = parts.join(' ');

  const root = $('notes');
  root.replaceChildren();
  if (status.notes.length === 0) {
    root.textContent = 'No notes yet. On the glasses, open the Voice note page and long press to record.';
    return;
  }
  for (const note of status.notes) {
    const row = document.createElement('div');
    row.className = 'note';
    const label = document.createElement('span');
    label.textContent = `${new Date(note.createdAt).toLocaleString()} · ${formatDuration(note.durationMs)}${note.sent ? ' · sent' : ''}`;
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.id = `audio-${note.id}`;
    const load = document.createElement('button');
    load.type = 'button';
    load.textContent = 'Load';
    load.addEventListener('click', () => mentra.send('note:get', { id: note.id }));
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = 'Delete';
    del.addEventListener('click', () => mentra.send('note:delete', { id: note.id }));
    row.append(label, load, audio, del);
    root.append(row);
  }
}

function wire(): void {
  $('settings').addEventListener('submit', (e) => {
    e.preventDefault();
    const s: Settings = {
      feedUrl: input('feed-url').value.trim(),
      noteUrl: input('note-url').value.trim(),
      noteToken: input('note-token').value.trim(),
    };
    const feedErr = checkUrl(s.feedUrl);
    const noteErr = checkUrl(s.noteUrl);
    $('feed-error').textContent = feedErr ? `Feed URL ${feedErr}.` : '';
    $('note-error').textContent = noteErr ? `Note endpoint ${noteErr}.` : '';
    if (feedErr || noteErr) return;
    mentra.send('settings:save', s);
    $('saved').textContent = 'Saved.';
    setTimeout(() => ($('saved').textContent = ''), 2000);
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-gesture]')) {
    button.addEventListener('click', () =>
      mentra.send('gesture', { kind: button.dataset.gesture as Channels['gesture']['kind'] }),
    );
  }

  mentra.on('settings', fill);
  mentra.on('status', showStatus);
  mentra.on('note', ({ id, wavBase64 }) => {
    const audio = document.getElementById(`audio-${id}`) as HTMLAudioElement | null;
    if (audio && wavBase64) audio.src = `data:audio/wav;base64,${wavBase64}`;
  });
  setInterval(() => mentra.send('status:get', {}), 15_000);
}

applySafeArea();
wire();
// Hides the Mentra App's loading screen; background `session.ui.onOpen` handlers fire after this.
mentra.ready();
