import type { GlanceFeed } from './feed';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Built-in sample feed used until the wearer sets a feed URL. Times are relative to `now`, so the
 * countdown is always live and never shows a deadline from the past.
 */
export function demoFeed(now: number): GlanceFeed {
  return {
    updated: now,
    nextAction: { title: 'Reply to the venue about the Friday booking', where: 'phone' },
    deadlines: [
      { name: 'Send the quarterly report', at: now + DAY + 4 * HOUR },
      { name: 'Renew the domain', at: now + 3 * DAY + 2 * HOUR },
    ],
    counters: { mentions: 4, decisions: 2 },
  };
}
