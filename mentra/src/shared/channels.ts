/**
 * Messages between the background JSContext and the settings WebView.
 * Both halves import this file at build time.
 */
import type { Settings } from '../../../src/core/settings';
import type { NoteMeta } from '../background/adapter';

export interface GlanceStatus {
  source: 'demo' | 'remote';
  fetchError: string | null;
  /** Text currently on the glasses. */
  view: { header: string; body: string; footer: string };
  notes: NoteMeta[];
}

export interface Channels {
  // WebView -> background
  'settings:save': Settings;
  'status:get': Record<string, never>;
  'gesture': { kind: 'single_tap' | 'swipe_up' | 'swipe_down' | 'long_press' };
  'note:get': { id: string };
  'note:delete': { id: string };

  // background -> WebView
  'settings': Settings;
  'status': GlanceStatus;
  'note': { id: string; wavBase64: string | null };
}
