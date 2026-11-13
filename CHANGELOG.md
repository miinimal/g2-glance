# Changelog

## 0.1.0 - 2026-11-13

First release.

- Four glasses pages: next action, next deadline with live countdown, inbox counters, voice note.
- Glance feed from a URL set on the phone, with validation, offline cache and stale marker;
  built-in demo data when no URL is set.
- Voice notes from the glasses microphone, saved as WAV on the phone and optionally POSTed to an
  endpoint with a bearer token.
- Pixel-accurate text fitting with `@evenrealities/pretext`; nothing overflows a container.
- Built on `@evenrealities/even_hub_sdk` 0.0.16 (Even App 2.2.10+).
- CI: typecheck, tests, build and `.ehpk` package on Node 20 and 22.
