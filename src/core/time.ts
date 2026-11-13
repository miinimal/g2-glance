/** Time formatting for a 576x288 display: short, minute resolution, no seconds. */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function span(ms: number): string {
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  const minutes = Math.floor((ms % HOUR) / MINUTE);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Countdown to a deadline, `remainingMs = deadline - now`.
 *
 *   1d 4h       one day or more (hours floored)
 *   4h 12m      one hour or more
 *   12m         one minute or more
 *   <1m         under a minute left
 *   now         passed less than a minute ago
 *   overdue 2h 5m
 */
export function formatCountdown(remainingMs: number): string {
  if (!Number.isFinite(remainingMs)) return '';
  if (remainingMs >= MINUTE) return span(remainingMs);
  if (remainingMs >= 0) return '<1m';
  if (remainingMs > -MINUTE) return 'now';
  return `overdue ${span(-remainingMs)}`;
}

/** Age of a timestamp: "just now", "5m ago", "3h ago", "2d ago". Future timestamps read "just now". */
export function formatAgo(ageMs: number): string {
  if (!Number.isFinite(ageMs) || ageMs < MINUTE) return 'just now';
  if (ageMs < HOUR) return `${Math.floor(ageMs / MINUTE)}m ago`;
  if (ageMs < DAY) return `${Math.floor(ageMs / HOUR)}h ago`;
  return `${Math.floor(ageMs / DAY)}d ago`;
}

/**
 * Milliseconds until `formatCountdown` shows different text, given `remainingMs = deadline - now`.
 * Before the deadline the text changes just after each whole minute is crossed (minutes are
 * floored); after it, "overdue" grows when the next whole minute is reached.
 */
export function msUntilCountdownChanges(remainingMs: number): number {
  if (remainingMs >= 0) return (remainingMs % MINUTE) + 1;
  const rest = -remainingMs % MINUTE;
  return rest === 0 ? MINUTE : MINUTE - rest;
}

/** Recording length as m:ss. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

interface DateParts {
  year: string;
  month: string;
  day: string;
  weekday: string;
  hour: string;
  minute: string;
}

function parts(at: number, timeZone: string | undefined): DateParts {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(at)) out[p.type] = p.value;
  return out as unknown as DateParts;
}

/**
 * When a deadline is due, in the wearer's time zone:
 * "today 17:00", "tomorrow 09:30", "yesterday 18:00", or "Mon 17 Nov 17:00".
 */
export function formatDue(at: number, now: number, timeZone?: string): string {
  const due = parts(at, timeZone);
  const time = `${due.hour}:${due.minute}`;
  const dayKey = (p: DateParts) => `${p.year}-${p.month}-${p.day}`;
  if (dayKey(due) === dayKey(parts(now, timeZone))) return `today ${time}`;
  if (dayKey(due) === dayKey(parts(now + DAY, timeZone))) return `tomorrow ${time}`;
  if (dayKey(due) === dayKey(parts(now - DAY, timeZone))) return `yesterday ${time}`;
  return `${due.weekday} ${due.day} ${due.month} ${time}`;
}
