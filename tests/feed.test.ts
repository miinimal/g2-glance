import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STALE_AFTER_MS,
  MAX_DEADLINES,
  MAX_FIELD_CHARS,
  isStale,
  nextDeadline,
  parseFeed,
  parseIsoTimestamp,
  validateFeed,
  type GlanceFeed,
} from '../src/core/feed';

const T = Date.parse('2026-11-13T23:00:00Z');

const good = {
  updated: '2026-11-13T15:00:00-08:00',
  next_action: { title: 'Reply to the venue', where: 'phone' },
  deadlines: [
    { name: 'Later', at: '2026-11-16T17:00:00-08:00' },
    { name: 'Sooner', at: '2026-11-14T19:00:00-08:00' },
  ],
  counters: { mentions: 4, decisions: 2 },
};

function ok(input: unknown) {
  const r = validateFeed(input);
  if (!r.ok) throw new Error(`expected ok, got ${r.errors.join('; ')}`);
  return r;
}

describe('validateFeed: good input', () => {
  it('accepts a complete feed and sorts deadlines', () => {
    const { feed, warnings } = ok(good);
    expect(warnings).toEqual([]);
    expect(feed.updated).toBe(Date.parse('2026-11-13T23:00:00Z'));
    expect(feed.nextAction).toEqual({ title: 'Reply to the venue', where: 'phone' });
    expect(feed.deadlines.map((d) => d.name)).toEqual(['Sooner', 'Later']);
    expect(feed.counters).toEqual({ mentions: 4, decisions: 2 });
  });

  it('accepts the shipped example file', () => {
    const text = readFileSync(new URL('../examples/feed.example.json', import.meta.url), 'utf8');
    const r = parseFeed(text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  it('accepts a feed with only "updated"', () => {
    const { feed, warnings } = ok({ updated: '2026-11-13T15:00:00Z' });
    expect(warnings).toEqual([]);
    expect(feed).toEqual({ updated: Date.parse('2026-11-13T15:00:00Z'), nextAction: null, deadlines: [], counters: null });
  });

  it('treats null sections as absent', () => {
    const { feed, warnings } = ok({ updated: good.updated, next_action: null, deadlines: null, counters: null });
    expect(warnings).toEqual([]);
    expect(feed.nextAction).toBeNull();
  });

  it('allows next_action without "where"', () => {
    expect(ok({ updated: good.updated, next_action: { title: 'Call mom' } }).feed.nextAction).toEqual({
      title: 'Call mom',
      where: '',
    });
  });

  it('defaults a missing counter to 0', () => {
    expect(ok({ updated: good.updated, counters: { mentions: 3 } }).feed.counters).toEqual({ mentions: 3, decisions: 0 });
  });

  it('collapses whitespace and caps long text', () => {
    const long = 'x'.repeat(MAX_FIELD_CHARS + 50);
    const { feed } = ok({ updated: good.updated, next_action: { title: `  a \n\t b  `, where: long } });
    expect(feed.nextAction?.title).toBe('a b');
    expect(feed.nextAction?.where.length).toBe(MAX_FIELD_CHARS);
  });

  it('keeps at most MAX_DEADLINES deadlines', () => {
    const deadlines = Array.from({ length: MAX_DEADLINES + 5 }, (_, i) => ({
      name: `d${i}`,
      at: new Date(T + i * 60_000).toISOString(),
    }));
    const r = ok({ updated: good.updated, deadlines });
    expect(r.feed.deadlines).toHaveLength(MAX_DEADLINES);
    expect(r.warnings).toHaveLength(1);
  });
});

describe('validateFeed: errors and missing fields', () => {
  it.each([null, 42, 'feed', [], true])('rejects a non-object root: %j', (input) => {
    expect(validateFeed(input).ok).toBe(false);
  });

  it('rejects a feed without "updated"', () => {
    const { updated: _u, ...rest } = good;
    const r = validateFeed(rest);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/updated/);
  });

  it('rejects invalid JSON', () => {
    const r = parseFeed('{"updated":');
    expect(r).toEqual({ ok: false, errors: ['feed is not valid JSON'] });
  });

  it('drops a section with the wrong type and keeps the rest', () => {
    const r = ok({ ...good, next_action: 'call', deadlines: { a: 1 }, counters: [1, 2] });
    expect(r.feed.nextAction).toBeNull();
    expect(r.feed.deadlines).toEqual([]);
    expect(r.feed.counters).toBeNull();
    expect(r.warnings).toHaveLength(3);
  });

  it.each([
    [{ title: '' }, 'title'],
    [{ title: '   ' }, 'title'],
    [{ title: 7 }, 'title'],
    [{ title: 'ok', where: 3 }, 'where'],
    [{ title: 'ok', where: '' }, 'where'],
  ])('drops next_action %j', (na, field) => {
    const r = ok({ updated: good.updated, next_action: na });
    expect(r.feed.nextAction).toBeNull();
    expect(r.warnings[0]).toContain(field);
  });

  it('skips bad deadlines one by one', () => {
    const r = ok({
      updated: good.updated,
      deadlines: [
        { name: 'fine', at: '2026-11-14T10:00:00Z' },
        { name: '', at: '2026-11-14T10:00:00Z' },
        { name: 'no date' },
        { name: 'bad date', at: 'tomorrow' },
        { name: 'no offset', at: '2026-11-14T10:00:00' },
        'string',
      ],
    });
    expect(r.feed.deadlines.map((d) => d.name)).toEqual(['fine']);
    expect(r.warnings).toHaveLength(5);
  });

  it.each([
    { mentions: -1, decisions: 0 },
    { mentions: 1.5, decisions: 0 },
    { mentions: '3', decisions: 0 },
    { mentions: 0, decisions: false },
  ])('drops counters %j', (counters) => {
    const r = ok({ updated: good.updated, counters });
    expect(r.feed.counters).toBeNull();
    expect(r.warnings).toHaveLength(1);
  });
});

describe('parseIsoTimestamp', () => {
  it.each([
    ['2026-11-13T15:00:00Z', Date.UTC(2026, 10, 13, 15)],
    ['2026-11-13T15:00Z', Date.UTC(2026, 10, 13, 15)],
    ['2026-11-13T15:00:00.123+00:00', Date.UTC(2026, 10, 13, 15, 0, 0, 123)],
    ['2026-11-13T07:00:00-08:00', Date.UTC(2026, 10, 13, 15)],
    ['2026-11-13T20:30:00+0530', Date.UTC(2026, 10, 13, 15)],
  ])('parses %s', (text, ms) => {
    expect(parseIsoTimestamp(text)).toBe(ms);
  });

  it.each(['2026-11-13', '2026-11-13T15:00:00', 'Nov 13 2026', '2026-13-45T99:00:00Z', '', 1731510000000, null])(
    'rejects %j',
    (value) => {
      expect(parseIsoTimestamp(value)).toBeNull();
    },
  );
});

describe('stale data', () => {
  const feed: GlanceFeed = { updated: T, nextAction: null, deadlines: [], counters: null };

  it('is fresh up to the threshold and stale after it', () => {
    expect(isStale(feed, T + DEFAULT_STALE_AFTER_MS)).toBe(false);
    expect(isStale(feed, T + DEFAULT_STALE_AFTER_MS + 1)).toBe(true);
  });

  it('honours a custom threshold', () => {
    expect(isStale(feed, T + 61_000, 60_000)).toBe(true);
  });

  it('never calls a feed from the future stale', () => {
    expect(isStale(feed, T - 1_000_000)).toBe(false);
  });
});

describe('nextDeadline', () => {
  const feed: GlanceFeed = {
    updated: T,
    nextAction: null,
    counters: null,
    deadlines: [
      { name: 'a', at: T - 2000 },
      { name: 'b', at: T + 1000 },
      { name: 'c', at: T + 5000 },
    ],
  };

  it('picks the earliest upcoming one and counts the rest', () => {
    expect(nextDeadline(feed, T)).toEqual({ deadline: feed.deadlines[1], remaining: 2 });
  });

  it('counts a deadline due exactly now as upcoming', () => {
    expect(nextDeadline(feed, T + 1000)?.deadline.name).toBe('b');
  });

  it('falls back to the latest overdue one', () => {
    expect(nextDeadline(feed, T + 9000)).toEqual({ deadline: feed.deadlines[2], remaining: 0 });
  });

  it('returns null without deadlines', () => {
    expect(nextDeadline({ ...feed, deadlines: [] }, T)).toBeNull();
  });
});
