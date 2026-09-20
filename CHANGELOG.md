# Changelog

All notable changes to this project are documented here.
The format loosely follows [Keep a Changelog](https://keepachangelog.com/), and this project
uses [Semantic Versioning](https://semver.org/).

## [0.3.0] — 2026-09-21

### Added

- **English spoken alerts.** All eight scenes now ship in Chinese and English in the
  same package, selected with the `language` setting or `/voice-alerts lang <zh|en>`.
  Chinese remains the default.
- The English lines are **written for English, not translated**. A literal rendering
  of the Chinese runs long and flat, and clip length is the only channel this plugin
  has for conveying urgency, so the English set was rewritten to preserve it. English
  durations run 1.92s to 7.90s, monotonic in the same severity order as the Chinese,
  with every adjacent pair at least 22% apart.
- English uses a native English voice (`loongmary`, warm British) rather than the
  Chinese voice reading English, which was auditioned and ranked last of three for
  sounding noticeably synthetic.
- `build.mjs` and `qa.mjs` understand languages: `--lang <code>` restricts either to
  one language, and `audition` picks the audition line for the candidate's language.
- `/voice-alerts status` reports clip availability per language, so a missing English
  set is visible rather than showing up as unexplained silence.

### Changed

- **Renamed from `dsh-voice-alerts` to `dsh-status-chime`.** The old name sat one letter
  away from an unrelated plugin already listed in the community catalog
  (`dsh-voice-alert`), and the marketplace hides one of two same-named packages, so the
  collision was a real discoverability risk. The new name also leads with "status" rather
  than "voice", which matches what the plugin actually reports. The rename is
  **package-level only**: the cordis `id` stays `voice-alerts`, the slash command stays
  `/voice-alerts`, and the config and clip paths under `$DSH_HOME` are untouched, so an
  existing install keeps working.
- Clips for a non-default language use a `<scene>.<code>.mp3` filename. The default
  language keeps the bare `<scene>.mp3` name, so an existing install and any
  hand-placed user override keep working untouched.
- An unrecognised `language` value falls back to the default rather than resolving no
  clips at all — a typo should not be indistinguishable from a broken install.

## [0.2.0] — 2026-09-21

### Added

- **An eighth scene, `approval`**, spoken when an action is waiting for your approval.
  It listens on the `approval/asked` session event, which DSH emits whenever an approval
  request is raised under the `ask` policy, with the scoped `approval/request` waterfall
  kept as a fallback. Both paths play the same clip. The scene cannot fire under the
  `never` policy, where nothing waits for you.

### Changed

- `watchApprovals` now defaults to `true`. It previously defaulted to `false`, so approval
  prompts stayed silent unless you opted in explicitly.
- `approval/request` now plays the dedicated `approval` clip instead of reusing
  `needs-input`, so the two situations are distinguishable by ear.
- The approval scene sits at priority 35, between `job-failed` (40) and `needs-input` (30).

## [0.1.0] — 2026-09-21

First public release.

### Added

- **Seven spoken alert scenes**, each with its own clip:
  `turn-done`, `turn-error`, `needs-input`, `job-done`, `job-failed`, `goal-complete`,
  `goal-blocked`.
- **A deliberate duration gradient** across the clips (7.97 s down to 1.58 s) so severity can
  be judged from clip length alone when you are not looking at the screen.
- **Bundled audio** for all seven scenes, as `.mp3` and `.wav`. The wav files exist because
  the PowerShell fallback player only accepts uncompressed PCM, and that fallback is what
  makes the plugin work on a clean Windows install.
- **Two playback backends** with automatic probing: `ffplay` when ffmpeg is present,
  otherwise Windows PowerShell 5.1 + `System.Media.SoundPlayer`. If `play.ps1` is blocked by
  an execution policy or ACL, playback retries once with an inline `-EncodedCommand`.
- **Three-level per-file asset resolution**: config `clipsDir`, then
  `$DSH_HOME/voice-alerts/clips/`, then the packaged `assets/clips/`. Replacing a single
  scene therefore requires one file.
- **Event coalescing, per-scene throttling and priority**: several events in one 400 ms
  window collapse to the highest-priority scene; the same scene will not repeat within
  1.5 s; a new alert interrupts the current one.
- **`/voice-alerts` slash command** with `on` / `off` / `status` / `test <scene>`.
- **`scripts/build.mjs`** — candidate auditioning and clip generation through Bailian TTS,
  with loudness normalisation to −16 LUFS so every clip is equally loud.
- **`scripts/qa.mjs`** — quality gate combining ASR read-back (character similarity against
  the intended line) with a full-modality model review and technical measurements. Includes
  a `rank` mode that cross-compares several candidate voices at once.
- **`tools/qw_local_asr.py` and `tools/qw_local_omni.py`** — local-audio helpers that inline
  audio as base64 over the official compatible API, so they work with any regional
  credential.
- **`scripts/selftest.mjs`** — 41 offline checks driving the plugin through a mock context,
  requiring neither a restart nor a real event.
- **`scripts/scan-sensitive.mjs`** — a privacy scan intended to run before committing.

### Design decisions worth recording

- **`turn-error` does not check who initiated the turn.** A failure during an autonomous
  round is exactly when you need to be told. An earlier iteration required human initiation
  and stayed silent for autonomous failures, which was the wrong trade-off.
- **`turn-done` only fires for human-initiated turns**, so a goal running twenty rounds does
  not play the same clip twenty times. Autonomous progress is reported at goal level
  (`goal-complete` / `goal-blocked`) instead.
- **Goal mutations are read from the session event stream** (`goal/change`), not from an
  agent-scoped event. Listening at the session level is what makes them observable to a
  plugin.
- **Subjective model scores are advisory, not gates.** The same clip scored
  "naturalness 6 / character 4" on one run and "naturalness 9 / character 7" on the next,
  and four clearly different clips once received identical scores. Only objective measures
  gate the build.

### Known limitations

- **Windows only.** The backend layer uses `ffplay` and Windows PowerShell.
- **`job-failed` is unreachable for background shell commands that exit non-zero.** DSH
  records those as `completed`, because a job snapshot carries no exit code and the shell
  producer emits only `completed` or `killed`. The scene still works for background tool
  task failures, but its trigger has not been reproduced. DSH's own desktop notifications
  share this blind spot.
- **The host cannot tell whether the window is focused**, so alerts play regardless. Toggle
  them off or lower the volume instead.
- **The `.wav` files roughly double the audio payload.** They are kept because removing them
  would break the zero-dependency promise on a clean Windows install.
- The spoken lines are Chinese. The plugin and its documentation are bilingual, but the
  audio is not; generating another language is a `clips.json` change plus
  `scripts/build.mjs build`.
