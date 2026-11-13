import { getTextWidth, measureTextWrap } from '@evenrealities/pretext';
import { describe, expect, it } from 'vitest';
import {
  ELLIPSIS,
  LINE_HEIGHT,
  MAX_CONTAINER_CHARS,
  alignRight,
  fitBlock,
  fitLine,
  guaranteedCharsPerLine,
  innerWidth,
  maxLines,
  stack,
} from '../src/core/fit';
import { LAYOUT } from '../src/core/render';

const LONG =
  'Review the quarterly budget proposal with the finance team and send the signed copy back before the board meeting on Monday morning';

describe('geometry', () => {
  it('subtracts padding and border on both sides', () => {
    expect(innerWidth(LAYOUT.body)).toBe(576 - 2 * (8 + 1));
    expect(innerWidth(LAYOUT.header)).toBe(568);
  });

  it('gives each container the intended number of lines', () => {
    expect(LINE_HEIGHT).toBe(27);
    expect(maxLines(LAYOUT.header)).toBe(1);
    expect(maxLines(LAYOUT.footer)).toBe(1);
    expect(maxLines(LAYOUT.body)).toBe(6);
  });

  it('keeps every container on the 576x288 canvas without overlap', () => {
    const boxes = [LAYOUT.header, LAYOUT.body, LAYOUT.footer];
    for (const b of boxes) {
      expect(b.x + b.width).toBeLessThanOrEqual(576);
      expect(b.y + b.height).toBeLessThanOrEqual(288);
    }
    expect(LAYOUT.header.y + LAYOUT.header.height).toBeLessThanOrEqual(LAYOUT.body.y);
    expect(LAYOUT.body.y + LAYOUT.body.height).toBeLessThanOrEqual(LAYOUT.footer.y);
  });

  it('documents the worst-case character budget per line', () => {
    expect(guaranteedCharsPerLine(LAYOUT.body)).toBe(32);
    expect(guaranteedCharsPerLine(LAYOUT.header)).toBe(33);
    // The budget really is worst-case: a line of the widest ASCII glyph fits.
    expect(getTextWidth('@'.repeat(32))).toBeLessThanOrEqual(innerWidth(LAYOUT.body));
  });
});

describe('fitLine', () => {
  it('returns short text unchanged', () => {
    expect(fitLine('Call mom', 200)).toBe('Call mom');
  });

  it('cuts long text with an ellipsis inside the pixel budget', () => {
    for (const px of [40, 100, 200, 333, 558]) {
      const out = fitLine(LONG, px);
      expect(getTextWidth(out)).toBeLessThanOrEqual(px);
      expect(out.endsWith(ELLIPSIS)).toBe(true);
      // Maximal: one more character would not fit.
      const kept = out.slice(0, -ELLIPSIS.length);
      const next = LONG.slice(0, kept.length + 1).trimEnd() + ELLIPSIS;
      if (next !== out) expect(getTextWidth(next)).toBeGreaterThan(px);
    }
  });

  it('fits text that is exactly at the limit without cutting', () => {
    const text = 'Exactly wide';
    expect(fitLine(text, getTextWidth(text))).toBe(text);
    expect(fitLine(text, getTextWidth(text) - 1).endsWith(ELLIPSIS)).toBe(true);
  });

  it('returns an empty string when not even the ellipsis fits', () => {
    expect(fitLine('Hello', getTextWidth(ELLIPSIS) - 1)).toBe('');
    expect(fitLine('Hello', getTextWidth(ELLIPSIS))).toBe(ELLIPSIS);
  });

  it('never splits a surrogate pair', () => {
    const out = fitLine('😀😀😀😀😀😀😀😀😀😀😀😀', 100);
    expect(out.endsWith(ELLIPSIS)).toBe(true);
    expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it('flattens line breaks and tabs', () => {
    expect(fitLine('a\nb\tc', 500)).toBe('a b c');
  });

  it('does not leave a space before the ellipsis', () => {
    const out = fitLine('aaaa bbbb cccc dddd', getTextWidth('aaaa b'));
    expect(out).not.toMatch(/ \.\.\.$/);
  });
});

describe('fitBlock', () => {
  const px = innerWidth(LAYOUT.body);

  it('keeps text that fits in the line budget', () => {
    expect(fitBlock('Short title', px, 3)).toBe('Short title');
  });

  it.each([1, 2, 3, 4])('cuts long text to at most %i wrapped lines', (lines) => {
    const long = `${LONG} ${LONG} ${LONG}`;
    const out = fitBlock(long, px, lines);
    expect(measureTextWrap(out, px).lineCount).toBeLessThanOrEqual(lines);
    expect(out.endsWith(ELLIPSIS)).toBe(true);
  });

  it('handles an unbreakable word longer than a line', () => {
    const out = fitBlock('x'.repeat(500), px, 2);
    expect(measureTextWrap(out, px).lineCount).toBeLessThanOrEqual(2);
  });

  it('returns nothing for a zero line budget', () => {
    expect(fitBlock(LONG, px, 0)).toBe('');
  });
});

describe('alignRight', () => {
  const px = innerWidth(LAYOUT.header);

  it('pushes the right part to the edge without wrapping', () => {
    const out = alignRight('NEXT ACTION', '● ○ ○ ○', px);
    expect(out.startsWith('NEXT ACTION ')).toBe(true);
    expect(out.endsWith('● ○ ○ ○')).toBe(true);
    const w = getTextWidth(out);
    expect(w).toBeLessThanOrEqual(px);
    expect(px - w).toBeLessThan(getTextWidth(' ') * 2);
    expect(measureTextWrap(out, px).lineCount).toBe(1);
  });

  it('cuts the left part first when both do not fit', () => {
    const out = alignRight(LONG, '12', 200);
    expect(out.endsWith(' 12')).toBe(true);
    expect(out).toContain(ELLIPSIS);
    expect(getTextWidth(out)).toBeLessThanOrEqual(200);
  });

  it('falls back to the right part alone in a tiny box', () => {
    expect(alignRight('left', 'right', getTextWidth('right'))).toBe('right');
  });
});

describe('stack', () => {
  it('never exceeds the container line count', () => {
    const out = stack(
      [
        { text: `${LONG} ${LONG}`, lines: 4 },
        { text: '', lines: 1 },
        { text: LONG, lines: 3 },
        { text: 'never shown', lines: 1 },
      ],
      LAYOUT.body,
    );
    expect(measureTextWrap(out, innerWidth(LAYOUT.body)).lineCount).toBeLessThanOrEqual(maxLines(LAYOUT.body));
    expect(out).not.toContain('never shown');
  });

  it('keeps blank spacer lines', () => {
    expect(stack([{ text: 'a', lines: 1 }, { text: '', lines: 1 }, { text: 'b', lines: 1 }], LAYOUT.body)).toBe(
      'a\n\nb',
    );
  });

  it('keeps preformatted spacing', () => {
    const line = alignRight('Mentions', '4', innerWidth(LAYOUT.body));
    expect(stack([{ text: line, lines: 1, preformatted: true }], LAYOUT.body)).toBe(line);
  });

  it('refits preformatted text that is too wide', () => {
    const out = stack([{ text: LONG, lines: 1, preformatted: true }], LAYOUT.body);
    expect(out.endsWith(ELLIPSIS)).toBe(true);
  });

  it('stays under the firmware character limit', () => {
    const tall = { width: 576, height: 288 * 40, padding: 0, border: 0 };
    const out = stack(Array.from({ length: 300 }, () => ({ text: LONG, lines: 1 })), tall);
    expect(out.length).toBeLessThanOrEqual(MAX_CONTAINER_CHARS);
  });
});
