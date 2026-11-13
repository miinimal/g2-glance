# Text fitting

The G2 shows text in one firmware font (LVGL) at 27 px per line. A text container wraps at its
inner width and clips or scrolls whatever does not fit. On glasses a clipped line looks like a bug,
so g2-glance fits every string before sending it. Code: [`src/core/fit.ts`](../src/core/fit.ts).

## How text is measured

Widths come from [`@evenrealities/pretext`](https://www.npmjs.com/package/@evenrealities/pretext),
Even Realities' own port of the firmware font metrics: per-glyph advance widths, kerning, and the
same line-breaking rules as `lv_text_get_next_line`. Fitting is done in pixels, not characters,
because glyph widths vary from 4 px (`i`) to 17 px (`@`).

When text does not fit, it is cut at the longest prefix (by code point, never splitting a surrogate
pair) that still fits together with `...`, and trailing spaces before the ellipsis are removed.
Three dots are used instead of `…` because they render in every firmware font.

## Budgets per container

The canvas is 576 x 288. Inner size = outer size minus padding and border on both sides.

| Container | Outer (w x h) | Padding / border | Inner width | Lines | Worst-case chars per line |
| --- | --- | --- | --- | --- | --- |
| header | 576 x 36 | 4 / 0 | 568 px | 1 | 33 |
| body | 576 x 204 | 8 / 1 | 558 px | 6 | 32 |
| footer | 576 x 36 | 4 / 0 | 568 px | 1 | 33 |

"Worst-case chars per line" is `floor(inner width / 17)`, the count that fits even if every glyph is
the widest printable ASCII glyph. Typical English text fits 55 to 65 characters per body line.

Inside the body each field has its own line budget, and the container budget (6 lines) caps the
total:

| Page | Field | Lines |
| --- | --- | --- |
| Next action | title | 4 |
| | blank | 1 |
| | `Where: ...` | 1 |
| Next deadline | name | 3 |
| | blank | 1 |
| | countdown (`in 1d 4h`) | 1 |
| | due time (`tomorrow 19:00 (+1 more)`) | 1 |
| Inbox | `Mentions` / count | 1 |
| | blank | 1 |
| | `Decisions waiting` / count | 1 |
| Voice note | status lines | 1 to 2 each |

## How the budgets were chosen

- 27 px line height is the firmware value (also used by pretext's `measureTextWrap`).
- Header and footer are 36 px tall: one 27 px line plus 4 px padding top and bottom, with one
  pixel to spare.
- The body gets everything between them, 204 px. With 8 px padding and a 1 px border its inner
  height is 186 px: 6 full lines (162 px). A seventh line would need 189 px.
- The next action title gets 4 lines because it is the one thing on that page; deadline names get
  3 so the countdown and the due time always stay visible beneath them.
- Each container also stays under the firmware limit of 1,000 characters per text container.

The test suite checks every page with extreme data (very long titles, 50 deadlines, nine-digit
counters, long error messages) against these budgets: see
[`tests/render.test.ts`](../tests/render.test.ts) and [`tests/fit.test.ts`](../tests/fit.test.ts).
