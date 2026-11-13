# Contributions to other projects

Pull requests to repositories around the G2 and MentraOS, tracked here. Status is checked daily.

| Repository | Change | Branch | Opened | Status | Merged |
| --- | --- | --- | --- | --- | --- |
| [pangoleen/awesome-even-realities-g2](https://github.com/pangoleen/awesome-even-realities-g2) | Add g2-glance to "Apps - Productivity and Utilities" | [`add-g2-glance`](https://github.com/miinimal/awesome-even-realities-g2/tree/add-g2-glance) | - | branch ready, `awesome-lint` passes | - |
| [fabioglimb/even-toolkit](https://github.com/fabioglimb/even-toolkit) | Fix `RangeError` on odd-length / odd-offset PCM chunks in `GlassBridgeSource` and `uint8ToPcm16`; add vitest | [`fix/pcm16-odd-chunks`](https://github.com/miinimal/even-toolkit/tree/fix/pcm16-odd-chunks) | - | branch ready; 3 of 10 new tests fail without the fix, all pass with it; build green | - |
| [Mentra-Community/MentraOS](https://github.com/Mentra-Community/MentraOS) | Pause UDP liveness probes while no audio is subscribed ([#4718](https://github.com/Mentra-Community/MentraOS/issues/4718)), target `dev` | [`pause-idle-udp-probes`](https://github.com/miinimal/MentraOS/tree/pause-idle-udp-probes) | - | branch ready; cloud-client `bun test` 357 pass (3 new tests fail without the fix); `tsc -b` clean | - |

Candidates for the next ones are ranked in [research.md](research.md).
