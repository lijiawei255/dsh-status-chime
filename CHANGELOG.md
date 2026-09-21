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
  with the three urgency bands separated by wide margins (38% into the failed/blocked
  band) while clips inside a band sit close by design.
- English uses a native English voice (`loongmary`, warm British) rather than the
  Chinese voice reading English, which was auditioned and ranked last of three for
  sounding noticeably synthetic.
- **Silence floors in the quality gate.** The peak check only looked for clipping, so a clip
  of pure silence with a plausible length passed every gate — one of the classic TTS failure
  modes. Peak must now be >= -30 dB and mean >= -35 dB. Measured: shipped clips peak at
  -4.2..-1.9 dB and average -20.6..-16.6 dB, true silence measures -91 dB.
- **Net speech rate as an advisory check**, measured over actual speech rather than total
  duration. Compared against the median of the same language, with clips under 5 units
  exempt. A fixed band was rejected: the clips are deliberately slow, and the 3.2-5.5
  units/s range from broadcast-speech research would fail seven of the eight.
- **UTMOS naturalness scoring** via `tools/qw_local_utmos.py`, optional and advisory.
  Compared per language, because the predictor scores every English clip above every Chinese
  one and a cross-language comparison would be misleading. A missing install is reported,
  never treated as a failed clip.
- **`scripts/qa-negative-control.mjs`**, an offline regression test that injects a fully
  silent clip, a uniformly quiet one, a loud-click-then-silence one (high crest factor, the
  only fixture that exercises the mean floor without the peak floor firing first) and a
  slowed one, then asserts the gates report each while healthy clips are left alone. Ten
  assertions, no API calls, so it costs nothing to run.
- **`scripts/verify-local-install.mjs`**, which verifies an installed copy through the public
  `/voice-alerts` command rather than a mock context, proving that switching language changes
  the resolved **file** and not merely the label.
- **`docs/verification.md`** now records the per-item evidence, including the margin for each
  silence floor separately and the fixtures the negative control relies on.
- The offline suite grew from 41 to **60 checks** across this and the previous release:
  43 for the approval scene, 50 with the seven language checks, 52 with the two
  bracketed-language checks, 53 with the command-input guard, 55 with the observed
  asset-resolution and resolved-file checks, and 60 with the config-surface checks — see Fixed.

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
- `build.mjs` and `qa.mjs` understand languages: `--lang <code>` restricts either to
  one language, and `audition` picks the audition line for the candidate's language.
- `/voice-alerts status` reports clip availability per language, so a missing English
  set is visible rather than showing up as unexplained silence.
- The quality gate is language-aware and checks every declared language, instead of one flat
  scene list that only ever looked for `<scene>.mp3`.
- `qa.mjs` now takes `--lang <code>`, and reports speech time, units/s and UTMOS in its
  table. `VOICE_ALERTS_UTMOS_PYTHON` selects the interpreter that has `utmos-pytorch`.

### Fixed

- **`interrupt` was undone by its own fallback.** When a higher-priority alert cut in, the
  plugin killed the clip that was playing — and a process killed on purpose reports
  `code === null`, which is neither `0` nor `2`, so the `play.ps1` retry handler read it as
  a broken script and **replayed the interrupted clip through the inline path**. The new
  alert and the old one then overlapped. The same happened on unload, where `stop()` killed
  a clip and immediately respawned it. Children we kill are now recorded, and their exit is
  not treated as a failure. Found by adding the coverage below, not by reading the code.
- **Five config surfaces had no test behind them**, so nothing guarded them: a scene
  disabled with `scenes.<name>.enabled = false` (now asserted to read as `off` AND to stay
  silent when its event fires), `watchApprovals: false` (the approval event must not
  speak), an install whose only config file is the legacy one (the plugin must read it —
  and that is the file `on`/`off`/`lang` then write back to), and a `play.ps1` that exits
  non-zero (must fall back to the inline `-EncodedCommand`). The fixtures for the
  resolution-order checks also now copy **real** packaged clips instead of writing the
  string `placeholder`: those files really get played, and undecodable audio made `play.ps1`
  exit non-zero, which silently consumed the one-shot retry warning the last check depends on.
- **The suite now observes what was actually resolved, instead of only the plugin's own
  log prose.** A play used to be reported as `playing <scene>`, which cannot tell the
  Chinese clip from the English one, mp3 from wav, or a user override from the packaged
  file — so a wrong-file regression, a `volume` value lost, or a missing `interrupt` were
  all invisible. The log line now ends with `[<file> via <backend> from <source>]` and the
  checks assert on it: `turn-done.en.mp3` after a language switch, `turn-done.wav` with the
  PowerShell backend, and `from clipsDir` / `from user` / `from package` for the
  documented resolution order.
- **The resolution-order check was tautological.** It called a local `resolveOrderProbe()`
  that searched its own hardcoded two-element array — and the test had just written the
  first element — so it returned the user-level path by construction and passed no matter
  what the plugin did. It is replaced by the observed `from <source>` assertions above, and
  the dead `mp3-only` fixture next to it is gone.
- **The ASR read-back ran with a hardcoded `--lang zh`, including for the eight English
  clips.** The number happened to still be 1.000, but the English set's objective hard gate
  was not the measurement the docs described. The hint now follows each clip, and the eight
  English clips were re-measured with `--lang en`: 1.000 on all eight, transcripts matching
  the intended lines. `qa.mjs asr [--lang <code>]` was added so this can be re-run without
  paying for the Omni scores again.
- **Two tools reported success while running zero checks.** `verify-local-install.mjs` and
  `qa-negative-control.mjs` both exited 0 after printing `skipped (0 checks run)` when
  ffmpeg was absent — on the very machine the first one exists to check. They now exit 2
  and say `NOT VERIFIED`, so "could not check" is no longer the same status as "checked and
  clean".
- **The CI import check could pass vacuously.** Its regex was anchored to a single-quoted,
  single-line `import ... from '...'`, so double quotes, multi-line import lists,
  `export ... from` and dynamic `import()` were all missed — a real third-party dependency
  in any of those shapes would still have reported "node builtins only". The pattern now
  covers all four shapes and fails if it matches nothing at all.
- **A CI assertion that could never fail.** `$output -notmatch 'falls back to PowerShell'`
  tested for the check's own NAME, which is printed whether it passes or fails. It now
  requires a `PASS` line for that check.
- **Three `build.mjs` footguns.** `clip` with no scene name fell through to the same code
  as `build` and therefore ran 16 paid syntheses, overwriting every bundled clip — it now
  refuses and bills nothing. `--dry-run` created the `tmp/`, `preview/` and `clips/`
  directories and wrote one temp file per scene despite promising to write nothing. And
  `audition --lang en` was silently swallowed by the flag parser, so it auditioned every
  candidate instead of the English ones; it is now rejected with an explanation.
- **Every sub-command was unreachable by typing.** `/voice-alerts` on its own worked, so
  the command looked healthy, but `on`, `off`, `status`, `test <scene>` and `lang <zh|en>`
  could not be invoked at all: typing a space after the command name submitted the whole
  line as an ordinary chat message. The command UI's decision table claims a line only when
  its first token is the bare command name — *unless* the registration declares an `input`
  descriptor, in which case arguments are accepted. This registration had none, so adding
  `input: { hint: ... }` is the entire fix. Found from a user report; the field now has a
  check of its own so it cannot be dropped again.
- **`/voice-alerts lang <en>` no longer fails.** The help text spells the syntax
  `lang <zh|en>`, where the angle brackets are placeholder notation — but people copy them
  along, and `<en>` was then rejected as an unknown language while the error echoed the
  brackets back, making it look like a valid value had been refused. A wrapping pair of
  angle brackets, quotes or square brackets is now stripped before the value is judged.
  This is a tolerance rather than a fuzzy match: anything still unrecognised is refused as
  before, and when the input contained brackets the error now says what they are for.

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
- The offline suite grew from 41 to **43 checks**, covering the new event mapping and
  subagent filtering for approvals.

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
  **Superseded in 0.3.0**, which ships both languages. Kept here because it was true for
  this release.
