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

interface ParsedUrl {
  scheme: string;
  host: string;
  port: string | null;
}

/** Default port per scheme, dropped from origins the way browsers do. */
const DEFAULT_PORTS: Record<string, string> = { http: '80', https: '443' };

/**
 * Minimal absolute-URL parser for `scheme://host[:port][/path?query#hash]`.
 * The Mentra background runtime has no `URL` global, so the shared core cannot rely on it.
 * Userinfo (`user@host`) and spaces are rejected: a feed URL never needs them.
 */
export function parseUrl(value: string): ParsedUrl | null {
  const m = /^([a-z][a-z0-9+.-]*):\/\/(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::(\d{1,5}))?(?:[/?#][^\s]*)?$/i.exec(value.trim());
  if (!m) return null;
  const host = m[2]!.toLowerCase();
  if (host.startsWith('.') || host.endsWith('.') || host.includes('..')) return null;
  const port = m[3] ?? null;
  if (port !== null && Number(port) > 65535) return null;
  return { scheme: m[1]!.toLowerCase(), host, port };
}

/**
 * Check a URL the wearer typed. HTTPS only, except plain HTTP on localhost / LAN addresses for
 * development. Returns an error message, or null when the URL is usable (or empty).
 */
export function checkUrl(value: string): string | null {
  const text = value.trim();
  if (text === '') return null;
  const url = parseUrl(text);
  if (!url) return 'not a valid URL';
  if (url.scheme === 'https') return null;
  if (url.scheme === 'http' && isLocalHost(url.host)) return null;
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
  const url = parseUrl(value);
  if (!url) return null;
  const port = url.port !== null && url.port !== DEFAULT_PORTS[url.scheme] ? `:${url.port}` : '';
  return `${url.scheme}://${url.host}${port}`;
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
