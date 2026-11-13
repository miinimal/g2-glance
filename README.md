# g2-glance

[![CI](https://github.com/miinimal/g2-glance/actions/workflows/ci.yml/badge.svg)](https://github.com/miinimal/g2-glance/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Your day at eye level on the [Even Realities G2](https://www.evenrealities.com): the next action,
the next deadline with a live countdown, inbox counters, and voice notes from the glasses
microphone.

| Next action | Next deadline |
| --- | --- |
| ![Next action page](docs/screenshots/1-next-action.png) | ![Next deadline page](docs/screenshots/2-next-deadline.png) |
| **Inbox** | **Voice note** |
| ![Inbox page](docs/screenshots/3-inbox.png) | ![Voice note page](docs/screenshots/4-voice-note.png) |
| **Recording** | **Note saved** |
| ![Recording a voice note](docs/screenshots/5-voice-recording.png) | ![Voice note saved](docs/screenshots/6-voice-done.png) |

Screenshots are taken from the Even Hub simulator 0.9.5 with the built-in demo data
(`npm run screenshots`).

## What it does

g2-glance is an Even Hub plugin. It reads a small JSON "glance feed" from a URL you choose and
shows it on four pages:

1. **Next action**: one task and where to do it (phone, computer, ...).
2. **Next deadline**: the nearest deadline with a live countdown (`in 1d 4h`, `in 12m`,
   `overdue 2h 5m`), the due time in your time zone, and how many more are coming.
3. **Inbox**: counters for mentions and decisions waiting on you.
4. **Voice note**: hold the touchpad (temple or R1 ring) to record from the glasses microphone,
   release to stop. The note is saved as a WAV file on your phone and, if you set a note endpoint,
   POSTed to it.

| Gesture | Action |
| --- | --- |
| Swipe up / down | Previous / next page |
| Tap | Refresh the feed |
| Double tap | Exit (system exit dialog) |
| Hold, release (Voice note page) | Start, stop recording |

The feed refreshes every 5 minutes. If the network fails, the last good feed stays on screen and
the footer says `offline`; a feed older than 6 hours is marked `stale`. With no feed URL set, the
app shows demo data.

## Install

You need G2 glasses, the Even App 2.2.10 or newer, and Node.js 20.19+ or 22.12+.

### Run from your computer (developer mode)

```bash
git clone https://github.com/miinimal/g2-glance.git
cd g2-glance
npm install
npm run dev
```

In a second terminal, show a QR code for your computer's LAN address (replace the IP):

```bash
npx evenhub qr --url http://192.168.1.20:5173
```

Scan it from the Even App's developer mode. The phone and the computer must be on the same network.

### Build the package

```bash
npm run build
npm run pack
```

This writes `g2-glance.ehpk`. A ready-made package is attached to every
[release](https://github.com/miinimal/g2-glance/releases) and to every CI run. To install it on your
own glasses, upload it as a private build to your Even Hub developer account
(`npx evenhub login`, then `npx evenhub create g2-glance.ehpk --name Glance --tagline "..."`).

### Try it without glasses

```bash
npm run dev
npx @evenrealities/evenhub-simulator@0.9.5 http://127.0.0.1:5173/
```

Or open http://127.0.0.1:5173/ in a browser: outside the Even App the page shows a preview of the
glasses text with buttons for the gestures.

## The glance feed

Host a JSON file anywhere you can update it: a GitHub repository, a gist, your own server, an
automation that writes it every few minutes.

```json
{
  "updated": "2026-11-13T15:00:00-08:00",
  "next_action": { "title": "Reply to the venue about the Friday booking", "where": "phone" },
  "deadlines": [
    { "name": "Send the quarterly report", "at": "2026-11-14T19:00:00-08:00" },
    { "name": "Renew the domain", "at": "2026-11-16T17:00:00-08:00" }
  ],
  "counters": { "mentions": 4, "decisions": 2 }
}
```

| Field | Type | Rules |
| --- | --- | --- |
| `updated` | string, required | ISO-8601 with an offset (`Z` or `-08:00`). Without it the feed is rejected. |
| `next_action.title` | string | Non-empty. |
| `next_action.where` | string, optional | Free text, e.g. `phone`, `computer`. |
| `deadlines[]` | array | Each item needs `name` (string) and `at` (ISO-8601 with offset). Bad items are skipped; up to 50 are kept. |
| `counters.mentions`, `counters.decisions` | integers, optional | Non-negative; a missing one counts as 0. |

Every section is optional. A section with the wrong shape is ignored and the rest still shows.
Long text is cut to fit the display, never overflowing. A full example is in
[`examples/feed.example.json`](examples/feed.example.json).

Set the feed URL on the plugin's settings page in the Even App. URLs must use HTTPS (plain HTTP is
allowed for `localhost` and LAN addresses during development).

### Allowing your own host

Even Hub plugins may only call hosts listed in `app.json`. The package allows
`https://raw.githubusercontent.com`, so a feed stored in a GitHub repository works out of the box:

```
https://raw.githubusercontent.com/<user>/<repo>/main/feed.json
```

To use another host (your server, a gist, a note endpoint), add its origin to the `network`
whitelist in [`app.json`](app.json), then rebuild and repack:

```json
{
  "name": "network",
  "desc": "...",
  "whitelist": ["https://raw.githubusercontent.com", "https://feeds.example.com"]
}
```

The settings page warns you when a URL you enter is not on the whitelist. The host must also send
CORS headers that allow the request; the whitelist is not a CORS bypass.

## Voice notes

Notes are recorded as 16 kHz, 16-bit mono PCM from the glasses microphone and stored as WAV in the
plugin's storage on your phone (the newest 20). The settings page lists them with a player, a
download link and a delete button. Recording stops by itself after 2 minutes.

If a note endpoint is set, each note is sent as:

```
POST <your endpoint>
Content-Type: audio/wav
X-Glance-Duration-Ms: 4200
X-Glance-Recorded-At: 2026-11-13T23:05:00.000Z
Authorization: Bearer <token>        (only if you set a token)

<WAV bytes>
```

Any 2xx response counts as sent. Otherwise the glasses show `Send failed: HTTP 500` (or the
network error) and the note stays on the phone.

## Architecture

```
src/
  core/          pure TypeScript, no SDK, no DOM; fully unit-tested
    feed.ts      feed parsing and validation
    time.ts      countdown, "updated 5m ago", due-time formatting
    state.ts     page state machine and Even Hub event -> gesture mapping
    fit.ts       pixel-accurate text fitting (see docs/text-fitting.md)
    render.ts    state -> text of the three containers
    wav.ts       PCM recorder and WAV encoder
  app/
    controller.ts  GlanceApp: runs the core against ports (glasses, storage, clock, fetch)
  bridge/        the only code that touches the Even Hub SDK or browser storage
  main.ts        phone settings page and wiring
```

The glasses page is three text containers (header, body, footer) created once with
`createStartUpPageContainer`; after that only containers whose text changed are updated with
`textContainerUpgrade`, so there is no flicker and little Bluetooth traffic. The countdown is
redrawn exactly when its text changes (on the minute), not on a fixed timer.

Reproducing the checks CI runs:

```bash
npm run typecheck
npm test
npm run build
npm run pack
```

## Roadmap

- Settings for the stale threshold and refresh period.
- A feed adapter for calendars (ICS) and task apps.
- A MentraOS miniapp from the same core, so the same four pages run on Mentra glasses.
- Even Hub store submission.

## License

[MIT](LICENSE) © 2026 Aleksandr Shcherbakov
