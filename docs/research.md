# Research notes

Checked on 2026-11-13 (America/Los_Angeles). Every fact below comes from a page, package or
repository opened on that date; sources are linked next to each item.

## Ranked: where an outside contribution is most likely to be accepted first

| Rank | Target | Evidence | Plan |
| --- | --- | --- | --- |
| 1 | [fabioglimb/even-toolkit](https://github.com/fabioglimb/even-toolkit) (MIT, 100 stars) | The only outside PR ([#3](https://github.com/fabioglimb/even-toolkit/pull/3), CJK fix in `cleanForG2`) was merged in ~13 hours. `AGENTS.md` asks for test infrastructure ("If you add test infrastructure, wire it through `npm test`") and the repo has none. | A focused PR that adds a test harness plus tests for one module, or a bug found while testing, with a reproduction. |
| 2 | [even-realities/everything-evenhub](https://github.com/even-realities/everything-evenhub) (official, MIT, 79 stars) | Outside PRs merged: [#12](https://github.com/even-realities/everything-evenhub/pull/12) (8 days), [#8](https://github.com/even-realities/everything-evenhub/pull/8) (same day). 13 open issues, several are documentation gaps (for example [#32](https://github.com/even-realities/everything-evenhub/issues/32) hot reload, [#33](https://github.com/even-realities/everything-evenhub/issues/33) `min_app_version`). | A documentation fix verified against SDK 0.0.16 and CLI 0.2.0 (see "Differences" below). |
| 3 | [even-realities/evenhub-templates](https://github.com/even-realities/evenhub-templates) (official, MIT, 55 stars) | One outside PR, [#2](https://github.com/even-realities/evenhub-templates/pull/2) (`CLICK_EVENT` zero-value fix), merged after 33 days. Open issues [#1](https://github.com/even-realities/evenhub-templates/issues/1), [#3](https://github.com/even-realities/evenhub-templates/issues/3). | A template fix only if reproduced in the simulator. Slow review. |
| 4 | [nickustinov/even-g2-notes](https://github.com/nickustinov/even-g2-notes) (121 stars, no license) | One outside PR, [#1](https://github.com/nickustinov/even-g2-notes/pull/1), merged after 29 days. Three open issues, [#3](https://github.com/nickustinov/even-g2-notes/issues/3) lists hardware corrections. Last push 2026-07-31. | Note corrections that we verify ourselves (SDK 0.0.15/0.0.16 changes). Slow review. |
| 5 | [pangoleen/awesome-even-realities-g2](https://github.com/pangoleen/awesome-even-realities-g2) (170 stars) | Every merged change is by the maintainer; he adds community repos in bulk sweeps (last 2026-09-12). Five outside PRs are open and unmerged, the oldest since 2026-09-09. Format and rules in [`contributing.md`](https://github.com/pangoleen/awesome-even-realities-g2/blob/main/contributing.md). | One entry for g2-glance after v0.1.0 is public, in the exact format, `npx awesome-lint` clean. Expect a long wait; inclusion may come through a sweep instead. |
| 6 | [Mentra-Community/MentraOS](https://github.com/Mentra-Community/MentraOS) (MIT, branch `dev`) | Of the PRs merged since 2026-10-14, 101 are by `aisraelov`, 94 by `PhilippeFerreiraDeSousa`, 4 by `nic-olo`, 1 by `thesohamdatta`. No `good first issue` / `help wanted` labels. | Later step (Block 3 context first). Candidate issues listed below. |

## Even Hub platform: what differs from the brief

Sources: [overview](https://hub.evenrealities.com/docs/get-started/overview),
[display](https://hub.evenrealities.com/docs/build/display),
[page lifecycle](https://hub.evenrealities.com/docs/build/page-lifecycle),
[design guidelines](https://hub.evenrealities.com/docs/build/design-guidelines),
[device APIs](https://hub.evenrealities.com/docs/build/device-apis),
[packaging](https://hub.evenrealities.com/docs/ship/packaging),
[app submission](https://hub.evenrealities.com/docs/ship/app-submission),
[simulator](https://hub.evenrealities.com/docs/test/simulator),
[CLI](https://hub.evenrealities.com/docs/cli/index),
[learn](https://hub.evenrealities.com/docs/learn/index), and the published npm packages.

1. **SDK version.** npm has `@evenrealities/even_hub_sdk` **0.0.16** (published 2026-09-24,
   `minAppVersion: "2.2.10"` in its `package.json`). The hub docs still say the current SDK is
   0.0.14 with Even App 2.2.9. We build on 0.0.16.
2. **Container limits.** SDK 0.0.16 typings: `containerTotalNum` 1–12, `textObject` max 8,
   `imageObject` max 4. The docs phrase it as "4 image + 8 other" (list and text share the 8).
3. **Text limits.** 1,000 characters per text container on create/rebuild, 2,000 on
   `textContainerUpgrade`. No font size, alignment or bold. Lines wrap at the container width.
   Line height and characters per line are not documented.
4. **Exit rule (review requirement).** On the root page a double tap must call
   `shutDownPageContainer(1)`, which shows the system exit dialog. Mode 0 on the root page is
   rejected in review. g2-glance follows this.
5. **Events.** SDK 0.0.16 `OsEventTypeList`: 0 click, 1 scroll top, 2 scroll bottom, 3 double click,
   4 foreground enter, 5 foreground exit, 6 abnormal exit, 7 system exit, 8 IMU, 9 long press,
   10 long press release. `EventSourceType`: 1 glasses R, 2 ring, 3 glasses L.
   Click (0) may arrive with `eventType` missing because protobuf drops zero values
   (see evenhub-templates PR #2); g2-glance treats a missing type as a click.
6. **Audio.** PCM 16 kHz, signed 16-bit little-endian, mono, delivered as `event.audioEvent.audioPcm`.
   The simulator sends 100 ms chunks (3,200 bytes). Audio stops if the WebView is suspended
   (Android) and must be re-armed on foreground.
7. **Manifest.** `package_id` segments are lowercase letters and digits only, so
   `com.miinimal.glance` is valid. `edition` must be `"202601"`. `name` ≤ 20 characters and must
   not contain "Even". Permissions are an array of objects `{ name, desc, whitelist? }`;
   `whitelist` (network only) is an array of origins such as `"https://example.com"`.
   The packaging page's example still shows `min_sdk_version: "0.0.7"` (doc inconsistency).
8. **Submission.** Store icon is 1-bit, 24x24. Screenshots from the simulator. Privacy policy
   must cover every permission. Must survive locked-phone use and 2 minutes idle. No medical,
   financial or emergency routing.
9. **Simulator** 0.9.5 runs on Windows and has an automation server
   (`--automation-port`): `GET /api/screenshot/glasses` (576x288) and `POST /api/input`
   (`up|down|click|double_click|long_press|long_press_release|context_menu`). We use it for README
   screenshots.
10. **Community resources.** `hub.evenrealities.com/docs/community` now redirects to the overview;
    the list lives on the learn page: even-g2-notes, even-toolkit, ER Studio, a Figma file and
    Discord. `awesome-even-realities-g2` is not linked from the hub.

## MentraOS: issues an outsider could fix

`CONTRIBUTING.md` on `dev`: branch from `dev`, target `dev`, read the nearest `README.md` and
`AGENTS.md`, keep PRs focused, run local checks, explain hardware-only testing. Top-level areas:
`mobile/`, `asg_client/`, `cloud-v2/`, `sdk/`, `miniapps/`.

| Issue | Why it looks fixable | Estimate |
| --- | --- | --- |
| [#3892](https://github.com/Mentra-Community/MentraOS/issues/3892) `speaker.isPlaying` false during `createStream()` | A comment traced the race: the host sends `playing` via `queueMicrotask` after `sendResult`, so the result reaches the miniapp first. Fix and unit test are SDK-side TypeScript. | 3–5 h |
| [#3776](https://github.com/Mentra-Community/MentraOS/issues/3776) hardcoded "Mentra Connected" notification | Kotlin, text derived from real connection state; needs Android build. | 4–6 h |
| [#3891](https://github.com/Mentra-Community/MentraOS/issues/3891) `setVoiceActivityDetectionEnabled` no effect | Needs Mentra Live hardware to verify. | unknown |
| [#4718](https://github.com/Mentra-Community/MentraOS/issues/4718) audio route probe every second when idle | Clear code pointer in `cloud-client` runtime; gate probes on audio subscriptions; testable. | 4–6 h |
| [#330](https://github.com/Mentra-Community/MentraOS/issues/330) merge `VITE_API_URL` into `VITE_CLOUD_API_URL` | Small config cleanup; old issue, may be obsolete after the cloud-v2 move. | 1–2 h |

Most other open issues need Mentra Live hardware or are feature requests that need a design
decision from the core team.
