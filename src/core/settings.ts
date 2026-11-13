/** Wearer settings, edited on the phone and stored with the plugin. */
export interface Settings {
  /** Glance feed URL. Empty = built-in demo data. */
  feedUrl: string;
  /** Voice note endpoint. Empty = notes stay on the phone. */
  noteUrl: string;
  /** Optional bearer token sent with notes. Stored only on this phone. */
  noteToken: string;
}

export const EMPTY_SETTINGS: Settings = { feedUrl: '', noteUrl: '', noteToken: '' };

export const SETTINGS_KEY = 'glance.settings';

/**
 * Check a URL the wearer typed. HTTPS only, except plain HTTP on localhost / LAN addresses for
 * development. Returns an error message, or null when the URL is usable (or empty).
 */
export function checkUrl(value: string): string | null {
  const text = value.trim();
  if (text === '') return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return 'not a valid URL';
  }
  if (url.protocol === 'https:') return null;
  if (url.protocol === 'http:' && isLocalHost(url.hostname)) return null;
  return 'must start with https://';
}

function isLocalHost(host: string): boolean {
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.endsWith('.local') ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

/** Origin to add to app.json's network whitelist for a URL, e.g. "https://example.com". */
export function whitelistEntry(value: string): string | null {
  try {
    return new URL(value.trim()).origin;
  } catch {
    return null;
  }
}

export function parseSettings(raw: string | null | undefined): Settings {
  if (!raw) return { ...EMPTY_SETTINGS };
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof Settings, unknown>>;
    const str = (x: unknown) => (typeof x === 'string' ? x.trim() : '');
    return { feedUrl: str(v.feedUrl), noteUrl: str(v.noteUrl), noteToken: str(v.noteToken) };
  } catch {
    return { ...EMPTY_SETTINGS };
  }
}
