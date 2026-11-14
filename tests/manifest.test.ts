import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkUrl, parseSettings, parseUrl, whitelistEntry } from '../src/core/settings';

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const app = read('../app.json');
const pkg = read('../package.json');
const sdk = read('../node_modules/@evenrealities/even_hub_sdk/package.json');

describe('app.json (Even Hub packaging rules)', () => {
  it('has a valid package id', () => {
    expect(app.package_id).toBe('com.miinimal.glance');
    expect(app.package_id).toMatch(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/);
  });

  it('has a store-legal name', () => {
    expect(app.name.length).toBeLessThanOrEqual(20);
    expect(app.name).not.toMatch(/even/i);
  });

  it('matches package.json and the installed SDK', () => {
    expect(app.edition).toBe('202601');
    expect(app.version).toBe(pkg.version);
    expect(app.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(app.min_sdk_version).toBe(sdk.version);
    expect(app.min_app_version).toBe(sdk.minAppVersion);
    expect(pkg.dependencies['@evenrealities/even_hub_sdk']).toBe(sdk.version);
  });

  it('asks only for the permissions it uses, as an array of objects', () => {
    expect(Array.isArray(app.permissions)).toBe(true);
    expect(app.permissions.map((p: { name: string }) => p.name).sort()).toEqual(['g2-microphone', 'network']);
    for (const p of app.permissions) {
      expect(p.desc.length).toBeGreaterThan(0);
      expect(p.desc.length).toBeLessThanOrEqual(300);
    }
  });

  it('whitelists exact HTTPS origins only', () => {
    const network = app.permissions.find((p: { name: string }) => p.name === 'network');
    for (const origin of network.whitelist) {
      expect(whitelistEntry(origin)).toBe(origin);
      expect(origin.startsWith('https://')).toBe(true);
    }
  });

  it('points at the built entry page', () => {
    expect(app.entrypoint).toBe('index.html');
  });
});

describe('settings', () => {
  it.each([
    ['', null],
    ['https://example.com/feed.json', null],
    ['http://localhost:8787/feed.json', null],
    ['http://192.168.1.20/feed.json', null],
    ['http://example.com/feed.json', 'must start with https://'],
    ['ftp://example.com', 'must start with https://'],
    ['example.com/feed.json', 'not a valid URL'],
  ])('checkUrl(%j)', (url, error) => {
    expect(checkUrl(url)).toBe(error);
  });

  it('turns a URL into a whitelist origin', () => {
    expect(whitelistEntry('https://gist.githubusercontent.com/u/abc/raw/feed.json')).toBe(
      'https://gist.githubusercontent.com',
    );
    expect(whitelistEntry('nope')).toBeNull();
  });

  it('parses stored settings defensively', () => {
    expect(parseSettings(null)).toEqual({ feedUrl: '', noteUrl: '', noteToken: '' });
    expect(parseSettings('{bad')).toEqual({ feedUrl: '', noteUrl: '', noteToken: '' });
    expect(parseSettings('{"feedUrl":" https://a.b/c ","noteUrl":5}')).toEqual({
      feedUrl: 'https://a.b/c',
      noteUrl: '',
      noteToken: '',
    });
  });
});

describe('parseUrl (no URL global in the Mentra background)', () => {
  it.each([
    ['https://Example.com/feed.json?x=1#y', { scheme: 'https', host: 'example.com', port: null }],
    ['http://localhost:8787', { scheme: 'http', host: 'localhost', port: '8787' }],
    ['https://[::1]:8443/a', { scheme: 'https', host: '[::1]', port: '8443' }],
  ])('parses %s', (url, parsed) => {
    expect(parseUrl(url)).toEqual(parsed);
  });

  it.each(['example.com', 'https://', 'https://exa mple.com', 'https://user@example.com', 'https://a..b', 'https://a.com:99999', 'https://.a.com'])(
    'rejects %j',
    (url) => {
      expect(parseUrl(url)).toBeNull();
    },
  );

  it('drops default ports from whitelist origins like a browser', () => {
    expect(whitelistEntry('https://a.com:443/x')).toBe('https://a.com');
    expect(whitelistEntry('https://a.com:8443/x')).toBe('https://a.com:8443');
    expect(whitelistEntry('HTTPS://A.COM/feed')).toBe('https://a.com');
  });
});

describe('mentra/miniapp.json', () => {
  const mini = read('../mentra/miniapp.json');

  it('matches the Even Hub package and the repository version', () => {
    expect(mini.packageName).toBe(app.package_id);
    expect(mini.version).toBe(pkg.version);
    expect(mini.name).toBe(app.name);
  });

  it('declares exactly what the miniapp uses', () => {
    expect(mini.permissions.map((p: { type: string }) => p.type)).toEqual(['MICROPHONE']);
    expect(mini.entry).toEqual({ background: 'background/index.js', ui: 'ui/index.html' });
    expect(mini.hardwareRequirements).toContainEqual(expect.objectContaining({ type: 'DISPLAY', level: 'REQUIRED' }));
  });
});
