/**
 * Glance for MentraOS: background entry, loaded by the Mentra App into a per-miniapp JSContext.
 * Runs the same GlanceApp as the Even Hub plugin, with Mentra adapters for display, input,
 * microphone and storage.
 */
import { registerMiniapp } from '@mentra/miniapp/background';
import { GlanceApp } from '../../../src/app/controller';
import { checkUrl } from '../../../src/core/settings';
import type { Channels } from '../shared/channels';
import { MentraGlasses, MentraNotes, MentraStore, gestureFromTouch, type MentraSessionLike } from './adapter';

/** Mentra storage holds strings, so notes are shorter than on the G2 (2:00). */
const MAX_RECORDING_MS = 60_000;

registerMiniapp<Channels>(async (session) => {
  const mentra = session as unknown as MentraSessionLike;
  const notes = new MentraNotes(mentra);
  let app: GlanceApp | null = null;
  const glasses = new MentraGlasses(mentra, (pcm) => void app?.handleAudio(pcm));

  app = new GlanceApp({
    glasses,
    store: new MentraStore(mentra),
    notes,
    clock: {
      now: () => Date.now(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    },
    fetch: (url, init) => fetch(url, init as RequestInit),
    maxRecordingMs: MAX_RECORDING_MS,
  });
  const glance = app;

  const touch = (kind: string) => {
    const gesture = gestureFromTouch(kind, glance.state.recording.kind === 'recording');
    if (gesture) void glance.dispatch({ type: 'gesture', gesture, now: Date.now() });
  };
  session.input.onTouch(['single_tap', 'swipe_up', 'swipe_down', 'long_press'], (data) => touch(data.kind));

  const sendStatus = async () => {
    session.ui.send('status', {
      source: glance.source,
      fetchError: glance.fetchError,
      view: glance.view(),
      notes: await notes.list(),
    });
  };

  session.ui.onOpen(() => {
    session.ui.send('settings', glance.settings);
    void sendStatus();
  });
  session.ui.on('status:get', () => void sendStatus());
  session.ui.on('settings:save', (s) => {
    if (checkUrl(s.feedUrl) || checkUrl(s.noteUrl)) return; // the page validates before sending
    void glance.applySettings(s).then(sendStatus);
  });
  session.ui.on('gesture', ({ kind }) => {
    touch(kind);
    setTimeout(() => void sendStatus(), 300);
  });
  session.ui.on('note:get', async ({ id }) => {
    session.ui.send('note', { id, wavBase64: await notes.wav(id) });
  });
  session.ui.on('note:delete', async ({ id }) => {
    await notes.remove(id);
    await sendStatus();
  });

  await glance.start();
});
