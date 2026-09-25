# Changelog

All notable changes to this project are documented here.
The format loosely follows [Keep a Changelog](https://keepachangelog.com/), and this project
uses [Semantic Versioning](https://semver.org/).

## [0.4.0] — 2026-09-25

### Fixed

- **`scripts/verify-local-install.mjs` skipped the two checks it exists for on the install it
  exists for.** The skip condition asked whether the Clip-sets line contained `(missing)` —
  the marker the *Scenes* line uses — while that line's own wording is `missing`, so the test
  could never match. The result was two silent SKIPs on the single-file install, where the
  isolation the fixture builds actually works; the evidence was sitting in the skipped line's
  own detail text. The condition now probes `<plugin dir>/../assets/clips`, the directory the
  plugin itself resolves to, and the skip reason names the path it checked. Measured: the
  installed copy goes from 8/8 with 2 skipped to **10/10 with none**, while the repository
  build keeps its two honest SKIPs.
- **The two background-job scenes were dead on DSH 0.1.7.** 0.1.7 removed
  `jobs.onJobDone`, which was the only job API 0.3.0 knew, so `job-done` and `job-failed`
  stopped firing — **and nothing was logged**, because the `TypeError` is raised inside an
  `ctx.inject` callback and cordis contains a failing plugin per fiber. The plugin now
  subscribes to 0.1.7's `ctx.jobs.events.subscribe({ owners: 'all' })` commit stream and
  reads `settled`, preferring it whenever it exists.
  - Only `settled` counts. `registered`, `progress`, `stopping`, `output` and `removed` are
    ignored, so nothing speaks while a job is still running.
  - Two of `settled`'s fields suppress the alert, matching the host's own job reporter:
    `awaited` (a waiting caller already collected the result) and `cause: 'teardown'` (the
    owner is being destroyed). Without those, every shutdown would speak and every
    `job_wait` would double-report.
  - `jobs.onJobDone` is kept as a fallback branch, taken only when `events.subscribe` is
    absent, so 0.1.5/0.1.6 hosts keep their job scenes. Which branch is in use is logged at
    load time; when neither API exists the plugin warns once and keeps its other scenes.

### Added

- **`scripts/sync-profile.mjs`**, which makes "the local single-file install matches this
  repository" a checkable claim instead of a promise. `--check` (default) compares size and
  SHA-256 and prints `PARITY` or `DRIFT`; `--apply` copies and prints the restart reminder.
  `--all` extends the mirror to the audio: `assets/clips/**` and `assets/play.ps1` into
  `$DSH_HOME/voice-alerts/`, plus a comparison of the published `assets/clips.json` against
  the private `$DSH_HOME/voice-alerts/clips.json` that prints **differing field paths and
  never their values**.
- **`docs/mirror-policy.md`**, stating the rule the two previous entries exist to enforce:
  code and audio are mirrored byte for byte, wording is the only sanctioned difference, and
  the private master is authoritative. It also records the two honest limits — CI cannot run
  the wording gate because a GitHub runner has no `$DSH_HOME`, and the local rule file needs
  a positive control so a broken loader is not mistaken for a clean tree.
- The `clips.json` comparison classifies each differing path and requires the **functional**
  count to be **0** (model, voice, rate, pitch, volume, format, sampleRate, `loudnorm`, every
  spoken line). A non-zero count exits 3, and the classification is conservative: an
  unclassified field counts as functional, so a new key cannot slip through as "wording".
  Measured on the current pair: 50 paths differ, 0 of them functional — the shipped audio,
  voice and synthesis settings are identical, which is the machine-checkable form of "the
  clips were not regenerated for publication".
- The READMEs now carry an **Awesome DSH Plugin** badge and a "Listed in" / 「收录」
  section, recording that the plugin is listed in
  [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
  under the `notify` category
  ([#5553](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/5553), merged).

### Changed

- **Two passages about the voice were reworded into neutral terms.** They quoted a model's
  audition review verbatim, and that quote carried descriptive wording this project does not
  publish. The assessment itself is unchanged — which candidate won, and on what grounds —
  only the register is. **No audio was regenerated**: the 32 clips in `assets/clips/` are the
  ones that were auditioned, and `sync-profile.mjs --all` now asserts that the manifest fields
  determining them are identical to the private master's.
- A forbidden-word list now lives **outside every clone**, in
  `$DSH_HOME/voice-alerts.scan.json`, and is applied by `scripts/scan-sensitive.mjs`. The
  scanner already reported file, line and category without echoing the match, so nothing about
  the private wording can become a second copy of itself through a CI log or an issue paste.
- **Verification baseline moved from `@deepseek-ai/dsh` 0.1.5-rc.2 to 0.1.7-rc.2**, the
  version DSH Desktop ships. CI's `DSH_TEST_VERSION` moved with it — pinned to the exact
  version on purpose, because npm's `latest` dist-tag is still `0.1.5-rc.3` while 0.1.7-rc.2
  sits under `next`.
- The offline suite grew from 63 to **76 checks**: the job stream's filter, its two
  suppressing fields, the five event types that must stay silent, and a freshly applied
  plugin instance per API generation (new stream, legacy callback, and neither).
- The `job-failed` blind spot is documented **against 0.1.7** rather than 0.1.5: a job still
  has no exit-code field and a non-zero shell exit still settles `completed`. 0.1.7 does add
  `detail: 'exit code: N'`, which is recorded as an observable but deliberately **not
  parsed** — it is human-facing text, and treating it as a contract would break silently the
  next time it is reworded.
- `TROUBLESHOOTING.md` item 10 now names the three load-time job-API log lines, and the file's
  opening "where is the log" section was **rewritten rather than re-pathed**. It used to point
  at `%APPDATA%\...\logs\host\dsh-<date>.log`; the official desktop build writes no such file
  (measured: `logs/host` appears nowhere in its `app.asar`, the host's stdout is piped to the
  shell with `child.stdout.pipe(process.stdout)`, and only `logs\crash-*.log` reports are
  persisted). The section now says where the lines actually are — stdout for a CLI launch,
  `/voice-alerts status` in the chat UI on every build — and records that earlier or
  third-party shells did write that file.
- **`job-done` was re-observed on 0.1.7 by ear**, on the mirrored build: a real background job
  (started and deliberately never waited on, so `awaited` was false) played the Chinese clip
  when it settled. `docs/verification.md` §1 records that this one entry is auditory rather than
  log-backed, and why: there is no host log file to read on the current build.
- `package.json` `engines.dsh` stays at `>=0.1.5-rc.1` and still describes the real floor
  (both job APIs are supported). Note that DSH itself does **not** read `engines`: 0.1.7's
  plugin compatibility gate evaluates `peerDependencies` against the runtime version and
  grants exemptions through the profile's `compatibility.json`. No `peerDependencies` are
  declared here on purpose — a peer on `@deepseek-ai/dsh` would let pnpm's
  `auto-install-peers` pull a second copy of the core into a user's profile.

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
- The offline suite grew from 41 to **63 checks** across this and the previous release:
  43 for the approval scene, 50 with the seven language checks, 52 with the two
  bracketed-language checks, 53 with the command-input guard, 55 with the observed
  asset-resolution and resolved-file checks, 60 with the config-surface checks, and 63 with
  the volume and unload checks — see Fixed.

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

- **`volume` and the unload path are now checked, and both needed the log to become
  observable.** The volume is passed straight into the ffplay argument list, so "did the
  configured volume reach the player?" could not be answered from outside at all; play lines
  now carry `, vol <n>` when ffplay is what plays. Two checks result, and both run on either
  backend rather than skipping: the PowerShell path must **not** claim a volume (that player
  follows the system volume), and when ffplay is used the configured number must be the one
  reported. On a runner without ffplay the second check still exercises the "no false claim"
  branch and says so in its detail line.
- **The mock discarded `ctx.effect`'s disposer**, so "the plugin releases the player when it
  is unloaded" was untestable in either direction — and the plugin's registration is on the
  ROOT context, which had its own discarding `effect`. Both now keep the returned disposer,
  the unload path logs `released the player on unload`, and the suite runs every disposer
  and asserts that line. The suite is 63 checks.
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
