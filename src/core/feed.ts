/**
 * Glance feed: the JSON document that tells g2-glance what to show.
 *
 * Validation is lenient by section and strict at the root:
 * - a broken root (not an object, missing or invalid `updated`) is an error and the feed is rejected;
 * - a broken section (`next_action`, `deadlines`, `counters`) is dropped with a warning,
 *   so one bad field never blanks the whole display.
 */

export interface NextAction {
  title: string;
  where: string;
}

export interface Deadline {
  name: string;
  /** Epoch milliseconds. */
  at: number;
}

export interface Counters {
  mentions: number;
  decisions: number;
}

export interface GlanceFeed {
  /** Epoch milliseconds of the `updated` field. */
  updated: number;
  nextAction: NextAction | null;
  /** Sorted by `at`, earliest first. */
  deadlines: Deadline[];
  counters: Counters | null;
}

export type FeedResult =
  | { ok: true; feed: GlanceFeed; warnings: string[] }
  | { ok: false; errors: string[] };

/** A feed older than this is shown with a "stale" marker. */
export const DEFAULT_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/** Longest accepted text field. Anything longer is cut; the display truncates further anyway. */
export const MAX_FIELD_CHARS = 200;

/** Upper bound on deadlines kept from a feed. */
export const MAX_DEADLINES = 50;

const ISO_8601 =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/;

/**
 * Parse an ISO-8601 timestamp with an explicit offset (`Z` or `+hh:mm`).
 * Timestamps without an offset are rejected: they are ambiguous on a device that travels.
 */
export function parseIsoTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !ISO_8601.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) return null;
  return collapsed.length > MAX_FIELD_CHARS ? collapsed.slice(0, MAX_FIELD_CHARS) : collapsed;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** Validate an already-parsed JSON value. */
export function validateFeed(input: unknown): FeedResult {
  if (!isRecord(input)) {
    return { ok: false, errors: ['feed must be a JSON object'] };
  }
  const updated = parseIsoTimestamp(input.updated);
  if (updated === null) {
    return {
      ok: false,
      errors: ['"updated" must be an ISO-8601 timestamp with an offset, e.g. 2026-11-13T15:00:00Z'],
    };
  }

  const warnings: string[] = [];

  let nextAction: NextAction | null = null;
  if (input.next_action !== undefined && input.next_action !== null) {
    const na = input.next_action;
    if (!isRecord(na)) {
      warnings.push('"next_action" must be an object; ignored');
    } else {
      const title = cleanText(na.title);
      const where = na.where === undefined ? null : cleanText(na.where);
      if (title === null) {
        warnings.push('"next_action.title" must be a non-empty string; ignored');
      } else if (na.where !== undefined && where === null) {
        warnings.push('"next_action.where" must be a non-empty string; ignored');
      } else {
        nextAction = { title, where: where ?? '' };
      }
    }
  }

  const deadlines: Deadline[] = [];
  if (input.deadlines !== undefined && input.deadlines !== null) {
    if (!Array.isArray(input.deadlines)) {
      warnings.push('"deadlines" must be an array; ignored');
    } else {
      input.deadlines.forEach((item: unknown, index: number) => {
        if (!isRecord(item)) {
          warnings.push(`"deadlines[${index}]" must be an object; skipped`);
          return;
        }
        const name = cleanText(item.name);
        const at = parseIsoTimestamp(item.at);
        if (name === null) {
          warnings.push(`"deadlines[${index}].name" must be a non-empty string; skipped`);
        } else if (at === null) {
          warnings.push(`"deadlines[${index}].at" must be an ISO-8601 timestamp; skipped`);
        } else {
          deadlines.push({ name, at });
        }
      });
      deadlines.sort((a, b) => a.at - b.at);
      if (deadlines.length > MAX_DEADLINES) {
        warnings.push(`only the first ${MAX_DEADLINES} deadlines are kept`);
        deadlines.length = MAX_DEADLINES;
      }
    }
  }

  let counters: Counters | null = null;
  if (input.counters !== undefined && input.counters !== null) {
    const c = input.counters;
    if (!isRecord(c)) {
      warnings.push('"counters" must be an object; ignored');
    } else {
      const mentions = c.mentions ?? 0;
      const decisions = c.decisions ?? 0;
      if (!isCount(mentions) || !isCount(decisions)) {
        warnings.push('"counters.mentions" and "counters.decisions" must be non-negative integers; ignored');
      } else {
        counters = { mentions, decisions };
      }
    }
  }

  return { ok: true, feed: { updated, nextAction, deadlines, counters }, warnings };
}

/** Parse feed text (the body of an HTTP response). */
export function parseFeed(text: string): FeedResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['feed is not valid JSON'] };
  }
  return validateFeed(json);
}

/** True when the feed is older than `staleAfterMs` at `now`. */
export function isStale(feed: GlanceFeed, now: number, staleAfterMs = DEFAULT_STALE_AFTER_MS): boolean {
  return now - feed.updated > staleAfterMs;
}

/**
 * The deadline to show: the earliest one that has not passed yet, or, when all have passed,
 * the most recent overdue one. `null` when the feed has none.
 */
export function nextDeadline(feed: GlanceFeed, now: number): { deadline: Deadline; remaining: number } | null {
  if (feed.deadlines.length === 0) return null;
  const upcoming = feed.deadlines.find((d) => d.at >= now);
  const deadline = upcoming ?? feed.deadlines[feed.deadlines.length - 1]!;
  const remaining = feed.deadlines.filter((d) => d.at >= now).length;
  return { deadline, remaining };
}
