/**
 * Turns app state into the text of the three containers on the glasses.
 * Pure and deterministic for a given `now` and time zone.
 */
import type { GlanceFeed } from './feed';
import { isStale, nextDeadline, DEFAULT_STALE_AFTER_MS } from './feed';
import { alignRight, innerWidth, stack, type Box, type Field } from './fit';
import { PAGES, type Page, type State } from './state';
import { formatAgo, formatCountdown, formatDue, formatDuration } from './time';

/** Container geometry on the 576x288 canvas. */
export const LAYOUT = {
  header: { x: 0, y: 0, width: 576, height: 36, padding: 4, border: 0 },
  body: { x: 0, y: 40, width: 576, height: 204, padding: 8, border: 1 },
  footer: { x: 0, y: 252, width: 576, height: 36, padding: 4, border: 0 },
} as const satisfies Record<string, Box & { x: number; y: number }>;

export const TITLES: Record<Page, string> = {
  action: 'NEXT ACTION',
  deadline: 'NEXT DEADLINE',
  inbox: 'INBOX',
  voice: 'VOICE NOTE',
};

export interface ViewInput {
  state: State;
  feed: GlanceFeed | null;
  /** Where the feed came from. `demo` = built-in sample, no URL configured. */
  source: 'demo' | 'remote';
  /** Last fetch error, if the last refresh failed. */
  fetchError: string | null;
  /** True when a note endpoint is configured. */
  noteEndpoint: boolean;
  maxRecordingMs: number;
  now: number;
  timeZone?: string;
  staleAfterMs?: number;
}

export interface View {
  header: string;
  body: string;
  footer: string;
}

function pageDots(page: number): string {
  return PAGES.map((_, i) => (i === page ? '●' : '○')).join(' ');
}

function header(input: ViewInput): string {
  const page = PAGES[input.state.page]!;
  return alignRight(TITLES[page], pageDots(input.state.page), innerWidth(LAYOUT.header));
}

function feedStatus(input: ViewInput): string {
  const { feed, now } = input;
  if (input.source === 'demo') return 'demo data - set a feed URL on the phone';
  if (!feed) return input.fetchError ? `no data - ${input.fetchError}` : 'loading...';
  const ago = `updated ${formatAgo(now - feed.updated)}`;
  if (input.fetchError) return `offline - ${ago}`;
  if (isStale(feed, now, input.staleAfterMs ?? DEFAULT_STALE_AFTER_MS)) return `stale - ${ago}`;
  return ago;
}

function footer(input: ViewInput): string {
  const page = PAGES[input.state.page]!;
  const hint = page === 'voice' ? 'hold: record' : 'tap: refresh';
  return alignRight(feedStatus(input), hint, innerWidth(LAYOUT.footer));
}

function noFeed(input: ViewInput): Field[] {
  return [{ text: input.fetchError ? 'Could not load the feed.' : 'Loading...', lines: 2 }];
}

function actionBody(input: ViewInput): Field[] {
  if (!input.feed) return noFeed(input);
  const action = input.feed.nextAction;
  if (!action) return [{ text: 'Nothing queued.', lines: 1 }];
  const fields: Field[] = [{ text: action.title, lines: 4 }];
  if (action.where) fields.push({ text: '', lines: 1 }, { text: `Where: ${action.where}`, lines: 1 });
  return fields;
}

function countdownLine(remainingMs: number): string {
  const text = formatCountdown(remainingMs);
  if (text === 'now') return 'due now';
  if (text.startsWith('overdue')) return text;
  return `in ${text}`;
}

function deadlineBody(input: ViewInput): Field[] {
  if (!input.feed) return noFeed(input);
  const next = nextDeadline(input.feed, input.now);
  if (!next) return [{ text: 'No deadlines.', lines: 1 }];
  const { deadline, remaining } = next;
  const more = remaining > 1 ? ` (+${remaining - 1} more)` : '';
  return [
    { text: deadline.name, lines: 3 },
    { text: '', lines: 1 },
    { text: countdownLine(deadline.at - input.now), lines: 1 },
    { text: `${formatDue(deadline.at, input.now, input.timeZone)}${more}`, lines: 1 },
  ];
}

function inboxBody(input: ViewInput): Field[] {
  if (!input.feed) return noFeed(input);
  const c = input.feed.counters;
  if (!c) return [{ text: 'No counters in the feed.', lines: 1 }];
  const px = innerWidth(LAYOUT.body);
  return [
    { text: alignRight('Mentions', String(c.mentions), px), lines: 1, preformatted: true },
    { text: '', lines: 1 },
    { text: alignRight('Decisions waiting', String(c.decisions), px), lines: 1, preformatted: true },
  ];
}

function voiceBody(input: ViewInput): Field[] {
  const r = input.state.recording;
  const target = input.noteEndpoint ? 'Notes are sent to your endpoint.' : 'Notes are saved on the phone.';
  const limit = formatDuration(input.maxRecordingMs);
  switch (r.kind) {
    case 'idle':
      return [
        { text: 'Hold to record a note.', lines: 1 },
        { text: 'Release to stop.', lines: 1 },
        { text: '', lines: 1 },
        { text: target, lines: 2 },
      ];
    case 'recording':
      return [
        { text: `● Recording ${formatDuration(input.now - r.startedAt)}`, lines: 1 },
        { text: 'Release to stop.', lines: 1 },
        { text: '', lines: 1 },
        { text: `Stops by itself at ${limit}.`, lines: 1 },
      ];
    case 'saving':
      return [{ text: 'Saving...', lines: 1 }];
    case 'done': {
      const o = r.outcome;
      const lines: Field[] =
        o.kind === 'empty'
          ? [{ text: 'Nothing was recorded.', lines: 1 }]
          : o.kind === 'sent'
            ? [{ text: `Sent: ${formatDuration(o.durationMs)} note.`, lines: 1 }]
            : o.kind === 'saved'
              ? [{ text: `Saved on the phone: ${formatDuration(o.durationMs)} note.`, lines: 2 }]
              : [
                  { text: `Saved on the phone: ${formatDuration(o.durationMs)} note.`, lines: 1 },
                  { text: `Send failed: ${o.reason}`, lines: 2 },
                ];
      return [...lines, { text: '', lines: 1 }, { text: 'Hold to record another.', lines: 1 }];
    }
  }
}

const BODIES: Record<Page, (input: ViewInput) => Field[]> = {
  action: actionBody,
  deadline: deadlineBody,
  inbox: inboxBody,
  voice: voiceBody,
};

export function render(input: ViewInput): View {
  const page = PAGES[input.state.page]!;
  return {
    header: header(input),
    body: stack(BODIES[page](input), LAYOUT.body),
    footer: footer(input),
  };
}
