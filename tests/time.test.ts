import { describe, expect, it } from 'vitest';
import { formatAgo, formatCountdown, formatDue, formatDuration, msUntilCountdownChanges } from '../src/core/time';

const S = 1000;
const M = 60 * S;
const H = 60 * M;
const D = 24 * H;

describe('formatCountdown', () => {
  it.each([
    [D + 4 * H, '1d 4h'],
    [D + 4 * H + 59 * M + 59 * S, '1d 4h'],
    [D, '1d 0h'],
    [D - 1, '23h 59m'],
    [10 * D + 23 * H, '10d 23h'],
    [4 * H + 12 * M, '4h 12m'],
    [H, '1h 0m'],
    [H - 1, '59m'],
    [12 * M + 59 * S, '12m'],
    [M, '1m'],
    [M - 1, '<1m'],
    [0, '<1m'],
    [-1, 'now'],
    [-(M - 1), 'now'],
    [-M, 'overdue 1m'],
    [-(2 * H + 5 * M + 30 * S), 'overdue 2h 5m'],
    [-(3 * D + H), 'overdue 3d 1h'],
  ])('%d ms -> %s', (ms, text) => {
    expect(formatCountdown(ms)).toBe(text);
  });

  it('returns empty text for non-finite input', () => {
    expect(formatCountdown(Number.NaN)).toBe('');
    expect(formatCountdown(Number.POSITIVE_INFINITY)).toBe('');
  });
});

describe('formatAgo', () => {
  it.each([
    [-5 * M, 'just now'],
    [0, 'just now'],
    [M - 1, 'just now'],
    [M, '1m ago'],
    [59 * M, '59m ago'],
    [H, '1h ago'],
    [23 * H + 59 * M, '23h ago'],
    [D, '1d ago'],
    [Number.NaN, 'just now'],
  ])('%d ms -> %s', (ms, text) => {
    expect(formatAgo(ms)).toBe(text);
  });
});

describe('msUntilCountdownChanges', () => {
  it('agrees with formatCountdown around every boundary', () => {
    for (const r of [3 * H + 5, 2 * M, M, 1, 0, -1, -M + 1, -M, -M - 1, -5 * M - 7 * S]) {
      const d = msUntilCountdownChanges(r);
      expect(formatCountdown(r - d + 1)).toBe(formatCountdown(r));
      expect(formatCountdown(r - d)).not.toBe(formatCountdown(r));
    }
  });

  it.each([
    [5 * M + 20 * S, 20 * S + 1],
    [5 * M, 1],
    [0, 1],
    [1, 2],
    [-1, M - 1],
    [-M, M],
    [-(M + 15 * S), 45 * S],
  ])('%d ms remaining -> next change in %d ms', (remaining, delay) => {
    expect(msUntilCountdownChanges(remaining)).toBe(delay);
  });

  it('lands exactly where the countdown text changes', () => {
    const remaining = 4 * H + 12 * M + 7 * S;
    const delay = msUntilCountdownChanges(remaining);
    expect(formatCountdown(remaining - delay + 1)).toBe('4h 12m');
    expect(formatCountdown(remaining - delay)).toBe('4h 11m');
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '0:00'],
    [999, '0:00'],
    [7_000, '0:07'],
    [65_500, '1:05'],
    [120_000, '2:00'],
    [-5, '0:00'],
  ])('%d ms -> %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });
});

describe('formatDue', () => {
  const tz = 'America/Los_Angeles';
  // Friday 2026-11-13 15:00 in Los Angeles.
  const now = Date.parse('2026-11-13T15:00:00-08:00');

  it.each([
    ['2026-11-13T17:00:00-08:00', 'today 17:00'],
    ['2026-11-13T23:59:00-08:00', 'today 23:59'],
    ['2026-11-14T09:30:00-08:00', 'tomorrow 09:30'],
    ['2026-11-12T18:00:00-08:00', 'yesterday 18:00'],
    ['2026-11-17T17:00:00-08:00', 'Tue 17 Nov 17:00'],
  ])('%s -> %s', (iso, text) => {
    expect(formatDue(Date.parse(iso), now, tz)).toBe(text);
  });

  it('uses the given time zone, not UTC', () => {
    // 01:00 UTC on the 14th is still the 13th in Los Angeles.
    expect(formatDue(Date.parse('2026-11-14T01:00:00Z'), now, tz)).toBe('today 17:00');
    expect(formatDue(Date.parse('2026-11-14T01:00:00Z'), now, 'UTC')).toBe('tomorrow 01:00');
  });
});
