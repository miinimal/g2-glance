import { getTextWidth, measureTextWrap } from '@evenrealities/pretext';
import { describe, expect, it } from 'vitest';
import { demoFeed } from '../src/core/demo';
import type { GlanceFeed } from '../src/core/feed';
import { innerWidth, maxLines } from '../src/core/fit';
import { LAYOUT, render, type ViewInput } from '../src/core/render';
import { PAGES, type Recording } from '../src/core/state';

const NOW = Date.parse('2026-11-13T15:00:00-08:00');
const TZ = 'America/Los_Angeles';
const H = 3_600_000;

const feed: GlanceFeed = {
  updated: NOW - 5 * 60_000,
  nextAction: { title: 'Reply to the venue about the Friday booking', where: 'phone' },
  deadlines: [
    { name: 'Send the quarterly report', at: NOW + 28 * H },
    { name: 'Renew the domain', at: NOW + 74 * H },
  ],
  counters: { mentions: 4, decisions: 2 },
};

function input(page: string, patch: Partial<ViewInput> = {}): ViewInput {
  return {
    state: { page: PAGES.indexOf(page as never), recording: { kind: 'idle' } },
    feed,
    source: 'remote',
    fetchError: null,
    noteEndpoint: false,
    maxRecordingMs: 120_000,
    now: NOW,
    timeZone: TZ,
    ...patch,
  };
}

function fits(text: string, box: (typeof LAYOUT)[keyof typeof LAYOUT]) {
  expect(measureTextWrap(text, innerWidth(box)).lineCount).toBeLessThanOrEqual(maxLines(box));
  if (maxLines(box) === 1) expect(getTextWidth(text)).toBeLessThanOrEqual(innerWidth(box));
}

describe('render', () => {
  it('Next action page', () => {
    const v = render(input('action'));
    expect(v.header).toMatch(/^NEXT ACTION +● ○ ○ ○$/);
    expect(v.body).toBe('Reply to the venue about the Friday booking\n\nWhere: phone');
    expect(v.footer).toMatch(/^updated 5m ago +tap: refresh$/);
  });

  it('Next deadline page with live countdown', () => {
    const v = render(input('deadline'));
    expect(v.header).toMatch(/^NEXT DEADLINE +○ ● ○ ○$/);
    expect(v.body).toBe('Send the quarterly report\n\nin 1d 4h\ntomorrow 19:00 (+1 more)');
    const later = render(input('deadline', { now: NOW + 27 * H + 30 * 60_000 }));
    expect(later.body).toContain('in 30m');
  });

  it('overdue deadline', () => {
    const v = render(input('deadline', { now: NOW + 80 * H }));
    expect(v.body).toContain('Renew the domain');
    expect(v.body).toContain('overdue 6h 0m');
  });

  it('Inbox page aligns counters to the right', () => {
    const v = render(input('inbox'));
    const [mentions, , decisions] = v.body.split('\n');
    expect(mentions).toMatch(/^Mentions +4$/);
    expect(decisions).toMatch(/^Decisions waiting +2$/);
  });

  it('Voice note page in every recording state', () => {
    const states: [Recording, RegExp][] = [
      [{ kind: 'idle' }, /Hold to record a note\.[\s\S]*saved on the phone/],
      [{ kind: 'recording', startedAt: NOW - 7_400 }, /● Recording 0:07[\s\S]*Stops by itself at 2:00/],
      [{ kind: 'saving' }, /^Saving\.\.\.$/],
      [{ kind: 'done', outcome: { kind: 'sent', durationMs: 12_000 }, at: NOW }, /^Sent: 0:12 note\./],
      [{ kind: 'done', outcome: { kind: 'saved', durationMs: 3_000 }, at: NOW }, /^Saved on the phone: 0:03/],
      [
        { kind: 'done', outcome: { kind: 'failed', durationMs: 3_000, reason: 'HTTP 500' }, at: NOW },
        /Send failed: HTTP 500/,
      ],
      [{ kind: 'done', outcome: { kind: 'empty' }, at: NOW }, /^Nothing was recorded\./],
    ];
    for (const [recording, expected] of states) {
      const v = render({ ...input('voice'), state: { page: PAGES.indexOf('voice'), recording } });
      expect(v.body).toMatch(expected);
      expect(v.footer).toMatch(/hold: record$/);
    }
    expect(render(input('voice', { noteEndpoint: true })).body).toContain('sent to your endpoint');
  });

  it('footer shows demo, stale, offline and error states', () => {
    expect(render(input('action', { source: 'demo' })).footer).toMatch(/^demo data/);
    expect(render(input('action', { now: NOW + 7 * H })).footer).toMatch(/^stale - updated 7h ago/);
    expect(render(input('action', { fetchError: 'HTTP 404' })).footer).toMatch(/^offline - updated 5m ago/);
    const none = render(input('action', { feed: null, fetchError: 'timed out' }));
    expect(none.footer).toMatch(/^no data - timed out/);
    expect(none.body).toBe('Could not load the feed.');
    expect(render(input('action', { feed: null })).body).toBe('Loading...');
  });

  it('empty sections read as plain sentences', () => {
    const empty: GlanceFeed = { updated: NOW, nextAction: null, deadlines: [], counters: null };
    expect(render(input('action', { feed: empty })).body).toBe('Nothing queued.');
    expect(render(input('deadline', { feed: empty })).body).toBe('No deadlines.');
    expect(render(input('inbox', { feed: empty })).body).toBe('No counters in the feed.');
  });

  it('every page fits its containers, even with extreme data', () => {
    const long = 'W'.repeat(40) + ' ' + 'Very long words keep coming '.repeat(12);
    const extreme: GlanceFeed = {
      updated: NOW - 400 * 24 * H,
      nextAction: { title: long, where: long },
      deadlines: Array.from({ length: 50 }, (_, i) => ({ name: long, at: NOW + (i + 1) * 999 * 24 * H })),
      counters: { mentions: 123_456_789, decisions: 987_654_321 },
    };
    for (const page of PAGES) {
      for (const fetchError of [null, 'a very long network error message that goes on and on and on']) {
        const v = render(input(page, { feed: extreme, fetchError }));
        fits(v.header, LAYOUT.header);
        fits(v.body, LAYOUT.body);
        fits(v.footer, LAYOUT.footer);
      }
    }
  });

  it('works with the demo feed at any time', () => {
    for (const now of [0, NOW, NOW + 1e10]) {
      const v = render(input('deadline', { feed: demoFeed(now), now, source: 'demo' }));
      expect(v.body).toContain('in 1d 4h');
    }
  });
});
