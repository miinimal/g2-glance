/**
 * Text fitting for G2 text containers.
 *
 * The G2 firmware renders text with one LVGL font, 27 px per line, wrapping at the container's
 * inner width. Text that does not fit is clipped or scrolls, which reads as a bug on glasses, so
 * every string g2-glance sends is fitted first: it is measured with `@evenrealities/pretext`
 * (Even Realities' own port of the firmware font metrics, kerning included) and cut with an
 * ellipsis until it fits the container's pixel budget (inner width x line count).
 *
 * See docs/text-fitting.md for the budgets of each container and how they were chosen.
 */
import { getTextWidth, measureTextWrap } from '@evenrealities/pretext';

/** Rendered line height of the G2 system font, in pixels. */
export const LINE_HEIGHT = 27;

/** Ellipsis used when text is cut. Three dots render in every firmware font. */
export const ELLIPSIS = '...';

/** Widest printable ASCII glyph in the firmware font ("@"), in pixels. */
export const WIDEST_ASCII_GLYPH_PX = 17;

/** Firmware limit on characters in one text container for create/rebuild calls. */
export const MAX_CONTAINER_CHARS = 1000;

export interface Box {
  width: number;
  height: number;
  padding: number;
  border: number;
}

export function innerWidth(box: Box): number {
  return Math.max(0, box.width - 2 * (box.padding + box.border));
}

export function maxLines(box: Box): number {
  const inner = Math.max(0, box.height - 2 * (box.padding + box.border));
  return Math.floor(inner / LINE_HEIGHT);
}

/**
 * Characters that always fit, whatever they are: the worst case is a line of the widest ASCII glyph.
 * Used as a guaranteed lower bound in docs and tests; real fitting is by pixels.
 */
export function guaranteedCharsPerLine(box: Box): number {
  return Math.floor(innerWidth(box) / WIDEST_ASCII_GLYPH_PX);
}

/** Collapse whitespace so a single-line field can never introduce its own line breaks. */
export function singleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function codePoints(text: string): string[] {
  return Array.from(text);
}

/** Largest n in [0, hi] for which `fits(n)` holds, assuming `fits` is monotone and fits(0) holds. */
function largestFitting(hi: number, fits: (n: number) => boolean): number {
  let lo = 0;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function cut(chars: string[], n: number): string {
  return chars.slice(0, n).join('').trimEnd() + ELLIPSIS;
}

/** Fit one line into `maxPx` pixels, cutting with an ellipsis when needed. */
export function fitLine(text: string, maxPx: number): string {
  const line = singleLine(text);
  if (getTextWidth(line) <= maxPx) return line;
  if (getTextWidth(ELLIPSIS) > maxPx) return '';
  const chars = codePoints(line);
  const n = largestFitting(chars.length - 1, (k) => getTextWidth(cut(chars, k)) <= maxPx);
  return cut(chars, n);
}

/** Number of wrapped lines `text` takes at `maxPx` inner width. */
export function lineCount(text: string, maxPx: number): number {
  return measureTextWrap(text, maxPx).lineCount;
}

/**
 * Fit wrapped text into at most `lines` lines of `maxPx` pixels, cutting with an ellipsis.
 * Explicit line breaks in `text` are flattened: use `stack` to lay out several fields.
 */
export function fitBlock(text: string, maxPx: number, lines: number): string {
  if (lines <= 0) return '';
  if (lines === 1) return fitLine(text, maxPx);
  const flat = singleLine(text);
  if (lineCount(flat, maxPx) <= lines) return flat;
  const chars = codePoints(flat);
  const n = largestFitting(chars.length - 1, (k) => lineCount(cut(chars, k), maxPx) <= lines);
  return cut(chars, n);
}

/**
 * Put `right` flush against the right edge of a line that starts with `left`, padding with spaces.
 * `left` is cut first when both do not fit. The result is always a single line within `maxPx`.
 */
export function alignRight(left: string, right: string, maxPx: number): string {
  const r = fitLine(right, maxPx);
  const gap = getTextWidth(' ');
  const rightPx = getTextWidth(r);
  if (rightPx + gap > maxPx) return r;
  const l = fitLine(left, maxPx - rightPx - gap);
  let spaces = Math.max(1, Math.floor((maxPx - getTextWidth(l) - rightPx) / gap));
  // Kerning can make the joined line a pixel wider than the sum of its parts.
  while (spaces > 1 && getTextWidth(l + ' '.repeat(spaces) + r) > maxPx) spaces--;
  return l + ' '.repeat(spaces) + r;
}

export interface Field {
  text: string;
  /** Most lines this field may take. 1 = single line. */
  lines: number;
  /** Already fitted to one line (e.g. by `alignRight`): keep spacing, only re-check the width. */
  preformatted?: boolean;
}

/**
 * Lay out fields top to bottom in a container. Each field is fitted to its own line budget, and
 * fields that would run past the container's last line are dropped (the first field always wins).
 * An empty field renders as a blank spacer line.
 */
export function stack(fields: Field[], box: Box): string {
  const px = innerWidth(box);
  let remaining = maxLines(box);
  const out: string[] = [];
  for (const field of fields) {
    if (remaining <= 0) break;
    const budget = Math.min(field.lines, remaining);
    const text =
      field.text.trim() === ''
        ? ''
        : field.preformatted && getTextWidth(field.text) <= px && !field.text.includes('\n')
          ? field.text
          : fitBlock(field.text, px, budget);
    const used = text === '' ? 1 : lineCount(text, px);
    out.push(text);
    remaining -= used;
  }
  const result = out.join('\n');
  return result.length > MAX_CONTAINER_CHARS ? result.slice(0, MAX_CONTAINER_CHARS) : result;
}
