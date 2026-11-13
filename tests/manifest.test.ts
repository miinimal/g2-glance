import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkUrl, parseSettings, whitelistEntry } from '../src/core/settings';

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
