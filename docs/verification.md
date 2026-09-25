# Verification record

This file separates what has been **measured** from what has only been **read**. It exists
because "the feature is implemented" and "the feature was observed working" are different
claims, and the difference matters when you are deciding whether to rely on something.

Environment: DSH Desktop (official build), `@deepseek-ai/dsh` 0.1.7-rc.2, Windows 11.

This record was first written against 0.1.5-rc.2. Where a finding changed with the host
version it says so in place, rather than being quietly restated — the 0.1.7 job-event
migration in §4 is the one entry that did.

---

## 1. Event layer

Each scene was checked against the DSH source first, then triggered for real where possible.

| Scene | Trigger | Status |
|---|---|---|
| `turn-done` | `session/event` → `turn/end`, reason `completed`, human-initiated | ✅ observed repeatedly |
| `turn-error` | `turn/end`, reason `error` or `max-tokens` | ✅ observed |
| `needs-input` | `tools/pre-execute` with a tool name in `waitingTools` | ✅ observed repeatedly |
| `job-done` | `jobs.events.subscribe` → `settled`, status `completed` | ✅ **re-observed on 0.1.7 after the migration**, by ear — see below |
| `goal-complete` | `session/event` → `goal/change`, operation `complete` | ✅ observed |
| `goal-blocked` | `goal/change`, operation `block` | ✅ observed |
| `approval` | `session/event` → `approval/asked` (also the `approval/request` waterfall) | ✅ observed — heard on a real approval request, but **which of the two paths delivered it is unresolved**; they play the same clip. See §2b |
| `job-failed` | `jobs.events.subscribe` → `settled`, status `failed` | ⚠️ **never observed** — see §4 |

"Observed" means the host log contains a `playing <scene>` line **without** the `manual`
suffix that `/voice-alerts test` adds. That distinction is what separates a real event from
a test playback.

**One entry now departs from that definition, and it needs saying rather than hiding.**
`job-done`'s re-observation on 0.1.7 is **auditory**: a real background job (a 4-second
command, started and deliberately never waited on, so `awaited` was false) was started on the
mirrored build and the Chinese clip was heard when it settled. It is not backed by a log line
because the official desktop build writes no host log to read — see the note under §4. The
earlier `job-done` observation, on 0.1.5-rc.2, was the log-line kind.

How the two harder ones were triggered:

- **`turn-error`** — the model was switched to a provider known to be unreachable from the
  current region, and one message was sent. The turn genuinely ended with reason `error`.
  No code was modified to make this happen.
- **`goal-complete` / `goal-blocked`** — a real goal was created and then moved through
  `blocked` and `complete` using the goal tools, exercising the actual `goal/change`
  operations.

### Filter rules, also observed

| Rule | Evidence |
|---|---|
| `goal/change` with `create` / `edit` / `pause` / `resume` stays silent | Creating a goal produced **no** playback line in the log |
| `turn-done` ignores autonomous rounds | A round with no user message produced no playback |
| Subagent-origin sessions are skipped | Covered by the offline suite (§3) |

## 2. Audio layer

Both language sets were synthesized through Bailian TTS, normalised with `ffmpeg loudnorm`,
and passed the quality gate (`scripts/qa.mjs clips --lang zh|en`):

| Check | Result |
|---|---|
| ASR character similarity against the intended line | **1.000 on all 16 clips** |
| Clarity, cleanliness (hard gates) | 10 / 10 on all 16 clips |
| Peak level, no clipping | between −4.2 dB and −1.9 dB |
| Chinese duration gradient | 7.97 / 5.95 / 4.78 / 3.00 / 2.59 / 2.16 / 2.09 / 1.58 s |
| English duration gradient | 7.90 / 6.46 / 4.85 / 3.00 / 2.59 / 2.16 / 2.09 / 1.92 s |

**The English ASR figure needed a correction, and here it is.** `runAsr()` hardcoded
`--lang zh` for every clip, English ones included, so the English set's "objective hard
gate" was not the measurement this row presents it as. The hint now follows each clip, and
the eight English clips were re-measured with `--lang en`
(`node scripts/qa.mjs asr --lang en`, one paid request per clip): **1.000 on all eight**,
transcripts matching the intended lines. `qa.mjs asr [--lang <code>]` was added so this can
be re-run without paying for the Omni scores a second time. The Chinese eight were unaffected
by the bug and were not re-run.

The English gradient is monotonic in the same severity order as the Chinese. What the
length actually separates is the **three urgency bands**, not each clip from its neighbour:

| Step | Gap |
|---|---|
| Ended band (≤3.00s) → failed/blocked band (≥4.85s) | **38%** |
| Within the failed/blocked band (4.85 → 6.46 → 7.90s) | 25% / 18% |
| Within the ended band (1.92 → 2.09 → 2.16 → 2.59 → 3.00s) | 8% / 3% / 17% / 14% |

The closest pair is `goal-complete` 2.16s against `needs-input` 2.09s — **0.072s**, well
under the 0.10s gap elsewhere in this file called inaudible. That is not an English
regression: the Chinese set has the same pair at 0.07s. Two clips of the same urgency are
deliberately close, and no claim is made that every adjacent pair is distinguishable.

An earlier English `turn-error` was 6.55 s against a 6.46 s `job-failed` — a 0.10 s gap that
no listener could resolve, where the Chinese pair differs by 2.02 s (25% of the longer clip; the
percentages in this document all use that convention). The line was lengthened and re-measured to 7.90 s. **Word counts are not a proxy for duration; the
durations are what was checked.**

A human also listened to all eight Chinese clips and confirmed each played through
completely. The English set has **not** had that listening pass — it passed the automated
gate only.

## 2b. Language layer

| Claim | How it was checked |
|---|---|
| Chinese is the default | `clips.json` `defaultLanguage` is `zh`; the bare `<scene>.mp3` name is what resolves with no config |
| `/voice-alerts lang en` selects English | The offline suite asserts the **resolved file name** — `turn-done.en.mp3`, or `.en.wav` when the PowerShell backend is what will play it; the extension is derived from the backend that actually started, not hardcoded, because the CI runner has no ffplay. A scene-name-only check could not tell `turn-done.en.mp3` from `turn-done.mp3` |
| The playback log names what was chosen | Every play line ends with `[<file> via <backend> from <source>]`, where `<source>` is `clipsDir`, `user` or `package`. The three resolution levels are asserted from it, which is what makes "a user-level file takes precedence" checkable — before, it was "checked" by a local probe that searched its own hardcoded array and passed by construction |
| The switch survives a restart | `lang en` writes `language` into the config file; the suite re-reads the file and asserts the value |
| An unknown language does not mute the plugin | Setting `language: "klingon"` falls back to Chinese; asserted via `status` |
| An unknown language is rejected on the command | `/voice-alerts lang klingon` returns an error naming the allowed values |
| The English voice is a native English voice | Three candidates were ranked (`scripts/qa.mjs rank`); a run placed `loongmary` first and the Chinese voice reading English last, with `naturalness 4 / character 5`. A repeat run kept the same order, but `qa/` is not version-controlled, so no ranking artifact ships with the repo |

**Not verified:** that a missing English clip warns rather than silently falling back. The
shipped package always contains the English set, and packaged assets are the last link in
the resolution chain, so the branch cannot be reached without renaming shipped files — a
worse test than the gap it would close.

## 2c. Audio quality gate

Three checks were added after finding a specific hole, and all three were calibrated against
the shipped clips rather than copied from a paper.

**Silence floors (hard gate).** The peak check only looked for clipping, so a clip of **pure
silence with a plausible length** passed every gate. Measured levels:

| | peak | mean |
|---|---|---|
| Shipped clips (16) | −4.2 … −1.9 dB | −20.6 … −16.6 dB |
| A fully silent file | −91 dB | −91 dB |
| **Floors applied** | **≥ −30 dB** | **≥ −35 dB** |

**Margins, computed per floor:** the peak floor clears the worst shipped clip by **25.8 dB**
(−4.2 dB against −30 dB), the mean floor by **14.4 dB** (−20.6 dB against −35 dB). Both are
comfortable, and they are not the same margin.

An existing tool, `ttsproof` (v0.4.0), was evaluated first. It catches clipping and
truncation, but **not a fully silent file**: its source sets `empty_audio` only when the file
is missing or ≤ 44 bytes, never by inspecting the samples. That is why this floor is
hand-written.

**Net speech rate (advisory).** A fixed band does not fit: the Chinese clips are synthesized
slowly on purpose (rate 0.95), and the 3.2–5.5 units/s range from human broadcast-speech
research **would fail seven of the eight**. Each clip is compared against the median of its
own language instead. Clips below 5 units are exempt, because a two-word clip's rate is too
noisy: the English `turn-done` measures 1.74 units/s, a −42% deviation, and flagging it
would be a false positive.

Measured on the shipped set — Chinese median 2.97 (range 2.53–3.85), English median 3.02
(range 1.74–3.32). Exactly one clip is flagged: `goal-blocked` at **+30% vs the median**,
which independently reproduces a review finding from an earlier session.

**UTMOS (advisory).** Gives naturalness a reproducible number. It **must** be compared per
language: every English clip scores above every Chinese one (4.38–4.51 against 3.75–4.28),
so a cross-language comparison would read as a defect in the Chinese set. The predictor
appears to prefer the native-English voice, and UTMOS was trained largely on English data.
It is advisory, not a gate: a predicted MOS is not a listening test.

**Negative controls** (`scripts/qa-negative-control.mjs`) — offline, no API calls. It runs
**10 assertions across the fixtures below**; some rows cover a pair of assertions each (each
silence fixture is checked against both floors, and both a stretched and a healthy clip are
checked for a rate flag), which is why the table has fewer rows than the check count:

| Injected defect | Expected | Result |
|---|---|---|
| Fully silent, plausible length | hard fail on **both** floors | ✅ `peak -91 dB is effectively silent` + the mean floor |
| Uniformly quiet (440 Hz sine at −46 dB) | fail **both** floors | ✅ `peak -64.3 dB` + `mean -67.6 dB` — the peak fires first, so this fixture cannot isolate the mean floor |
| **Loud click, then silence** (20 ms burst, high crest factor) | fail the **mean** floor while the peak floor stays satisfied | ✅ `mean -41.5 dB is effectively silent`, with no peak failure — **this is the fixture that exercises the mean floor alone** |
| Healthy shipped clip | no silence-floor trip | ✅ no false positive |
| Speech slowed to 0.35× | rate outlier | ✅ `0.93 units/s (implausible)` |
| Healthy shipped clip | no rate flag | ✅ `2.99 units/s` |
| UTMOS not installed | reported, never failed | ✅ `UTMOS not available (…)` |

The crest-factor fixture exists because the earlier version of this test did **not** isolate
what it claimed: an attenuated sine has its peak below the peak floor too, so the assertion
"fails the mean floor" passed on the strength of the **peak** floor alone and the mean floor
was never exercised. The assertion now checks both halves — the mean fires *and* the peak
does not — so the isolation is real rather than assumed.

**Not verified:** that the gates catch every TTS failure mode. They catch silence, quiet
clips, clipping, truncation, wrong or missing words, and gross rate drift. They do not
detect wrong prosody, wrong emotion, or a wrong-but-plausible reading — those remain a
human judgement.

## 3. Backend layer

Measured with `scripts/selftest.mjs`, which forces each backend through the real code path.

| Check | Result |
|---|---|
| PowerShell path selects `.wav` | ✅ asserted from the play log itself: `turn-done.wav via powershell`. (That `PlaySync` blocks for the clip duration is the script's own doing and is not among these assertions) |
| With ffmpeg absent, playback falls back automatically and still works | ✅ forcing `player: auto` with a bogus `ffplayPath` yields `Player: PowerShell SoundPlayer` and a successful playback |
| An explicitly requested but missing ffplay fails loudly | ✅ it reports unavailable instead of silently switching backends |
| A `play.ps1` that exits non-zero falls back to the inline `-EncodedCommand` | ✅ a script containing `exit 3` produces `play.ps1 exited with code 3; retrying once with -EncodedCommand.` |
| Interrupting a clip does **not** replay it | ✅ **this was a real defect, found by adding the check above and not by reading the code.** A deliberately killed child exits with no code, which is neither 0 nor 2, so the retry handler read the interruption as a failed script and replayed the clip that had just been cut off — so `interrupt` was partly undone by its own fallback, and `stop()` on unload did the same. Children the plugin kills are now recorded and skipped |
| Packaged clips resolve with no `clipsDir` configured | ✅ all eight found in `assets/clips/` |
| A user-level file takes precedence over a packaged one | ✅ asserted from the play log's `from user` marker — and `from clipsDir` when an explicit directory is set. Before this, the claim rested on a probe that searched its own hardcoded array and therefore passed whatever the plugin did |

Measured startup overhead of the PowerShell path: roughly **0.4 s** on top of the clip
duration (three runs of a 1.58 s clip took 2.00 / 1.94 / 2.00 s).

## 4. The one defect that could not be reproduced, and the API migration around it

**`job-failed` does not fire for a background shell command that exits non-zero.**

Measured directly (on 0.1.5-rc.2): two background commands were started, one ending `exit 0`
and one ending `exit 7`. Both produced `playing job-done` in the log.

Cause, established by reading the DSH source rather than guessing, and **re-established
against 0.1.7-rc.2** because the access path to this data changed:

- A job has three terminal statuses — `completed`, `killed`, `failed` (`JobStatus` in
  `@deepseek-ai/dsh-jobs`), and **no exit-code field on the job view**.
- The producer for background shell commands assigns only `completed` or `killed`
  (`@deepseek-ai/dsh-tool-bash`/`-pwsh`: `status = signal ? 'killed' : 'completed'`, with the
  exit code formatted into the human-readable `detail`).
- `failed` is assigned when a background **tool** task reports an error, for a producer
  contract violation, or when a teardown cancel force-fails the record.

So the scene is correct and does cover tool-task failures, but its trigger has never been
observed here. It is documented as unverified rather than quietly described as working.

**What 0.1.7 changed.** `jobs.onJobDone` was removed. The registry now announces every commit
on `ctx.jobs.events.subscribe({ owners }, listener)` as
`registered | progress | stopping | output | settled | removed`, and `settled` carries
`{ job, cause: 'producer' | 'kill' | 'teardown', awaited }`. 0.3.0 knew only the removed API,
so on 0.1.7 **both job scenes were dead and nothing was logged** — the `TypeError` is thrown
inside an `ctx.inject` callback, and cordis contains a failing plugin per fiber. That silence
is the reason this section exists in the record rather than only in the changelog.

0.4.0 subscribes to the stream and prefers it when present, keeping `onJobDone` as a fallback
for 0.1.5/0.1.6 hosts. Two of `settled`'s fields suppress the alert, matching what the host's
own job reporter does: `awaited` (a waiting caller already collected the result) and
`cause: 'teardown'` (the owner is being destroyed, so the work did not "end" in any sense
worth speaking about). Both are asserted by the offline suite, along with the four event
types and the `output` frame that must stay silent.

**Not verified on a real host:** the fallback branch, which is exercised against a mock host
in §7 rather than a genuine 0.1.5/0.1.6 installation — no such host was available.

**Where the log is, and where it is not.** Re-observing `job-done` on 0.1.7 turned up a
documentation error worth recording, because it changes how *any* log line in this file can be
read on the current build. The official desktop shell does not write a per-day host log: the
string `logs/host` appears nowhere in its `app.asar`, the host's stdout is piped to the shell
with `child.stdout.pipe(process.stdout)`, and only crash reports are persisted — to
`%APPDATA%\@deepseek-ai\dsh-desktop\logs\crash-*.log`. So `[voice-alerts] …` lines are visible
when the CLI runs in a terminal, and in the chat UI through `/voice-alerts status`, but not as
a file in the desktop app. TROUBLESHOOTING.md said otherwise and now says this.

**The one observable 0.1.7 adds** is `detail: 'exit code: N'` on shell jobs, so a non-zero
exit is now visible in the log even though the status is `completed`. It is deliberately not
parsed: it is human-facing text, and promoting it to a contract would break silently the next
time it is reworded.

## 5. Replay safety

A resumed, forked or replayed session must not replay alerts.

Verified by reading `dsh-session`, which states that events entering through construction
"were never published on the `session/event` firehose (constructor seeds do not emit)".
Since every scene is driven from `session/event` (plus the job commit stream), a resumed session
cannot re-trigger a clip.

## 6. Plugin loading behaviour

Worth recording because it affects how you develop and install this plugin:

- **The plugin file is not hot-loaded.** Editing `lib/index.js` produced no new
  `[voice-alerts] active` line until DSH Desktop was fully restarted. Only the config file
  is re-read by mtime.
- **`dsh plugin add` registers the profile layer automatically — if the package declares
  `dsh.bundle`.** Measured on a throwaway profile copy:
  - without a `dsh.bundle` block: `dependencies` gains the package, `dsh.profile.bundles`
    does not, and dsh prints
    `declares no dsh.bundle — installed as a plain dependency, not a profile layer`
  - with `dsh.bundle.patch` declared: `dsh.profile.bundles` gains the package automatically
- **A BOM in the profile's `package.json` breaks startup.** DSH parses it with
  `JSON.parse`; PowerShell 5.1's `Set-Content -Encoding UTF8` writes a BOM, producing
  `SyntaxError: Unexpected token ''`.

## 7. What is covered by the offline suite

`scripts/selftest.mjs` runs 76 checks against a mock cordis context, with no restart and no
real event required. It covers: the eight scene mappings, the four silent goal operations,
subagent filtering, autonomous-round handling, coalescing and priority, per-scene
throttling, all four `/voice-alerts` verbs, command-name collision handling, asset
resolution order, backend selection, and — new in 0.4.0 — **the job commit stream**: the
`{ owners: 'all' }` filter, the two suppressing fields (`awaited`, `cause: 'teardown'`), the
five event types that must stay silent, and the probing of both API generations.

The two API generations each get a **freshly applied plugin instance**, because the whole
point of the probe is that the plugin picks whichever API the host actually has. The suite
also drives the third case — neither API present — and asserts that the plugin warns once and
keeps its other seven scenes, instead of throwing inside the inject callback where the host's
containment would hide it.

It runs against a temporary `DSH_HOME`, so it cannot disturb a real installation.

## 8. Keeping a single-file local install identical to this repository

The bundle install (`dsh plugin add`) always loads `lib/index.js` from the package, so it
cannot drift. A **single-file local install** — one `<name>.js` inside a profile, wired in
through the profile's `cordis.patch.yml` as `name: './<name>.js'` — has nothing linking it
back to this repository, and it did drift: the local copy behind this record was three
commits and one host-API migration behind, while still printing the same version number.
A version string cannot detect that; a hash can.

`scripts/sync-profile.mjs --check` compares the two files by size and SHA-256 and prints
`PARITY` or `DRIFT`; `--apply` copies and prints the restart reminder, since plugin code is
not hot-loaded. It reads nothing else — not the profile's `package.json`, not the contents of
`cordis.patch.yml` (it only asks whether that file names the plugin, because an unreferenced
copy is installed but inactive), and never `$DSH_HOME/voice-alerts/**`.

**Measured:** `--check` reported `DRIFT` for the drifted copy that prompted this tool
(44782 B / sha256 `00c6599dc8a5…` in the repository against 37393 B / sha256 `1348605136df…`
installed), and `PARITY` after the sync. `--all` additionally reports `ASSETS PARITY` for the
33 audio files and `clips.json WORDING 50 wording path(s) differ (expected), 0 functional
path(s) differ` — the machine-checkable form of "the clips were not regenerated".

The functional half is `scripts/verify-local-install.mjs --plugin <installed file>`, which
drives the installed copy through its public command interface: **10/10 checks pass, none
skipped**. That number is new, and it is a fix rather than a recount: the two lookup-isolation
checks used to skip on the single-file install as well — the artifact they exist for — because
the skip condition compared the Clip-sets line against the marker the *Scenes* line uses
(`(missing)` against `missing`), a test that could never match. The condition now probes
`<plugin dir>/../assets/clips`, the directory the plugin itself resolves to, so the repository
build still reports its two honest SKIPs (naming the path that was checked) and the single-file
install gets the full ten.

---

## Summary

| Claim | Confidence |
|---|---|
| The audio clips are correct and audible | **Verified** — all 16 through measurement; the eight **Chinese** clips additionally by listening. The English set has not had the listening pass (see §2) |
| The plugin plays on a clean Windows install with no third-party dependency | **Verified** |
| Seven of eight scenes fire on real events | **Verified** — including `job-done` **re-verified on 0.1.7 after the migration**, by ear (see §1) |
| Both job-event API generations work | **The 0.1.7 stream: verified on a real host. The `onJobDone` fallback: mock only** — no 0.1.5/0.1.6 host was available to measure it on |
| A local single-file install matches this repository | **Verified** — `sync-profile.mjs --check` prints `PARITY` for the plugin file and `PARITY` for the 33 audio assets, and `verify-local-install.mjs` passes 10/10 against the installed file |
| `approval` fired on a real approval request | **Heard it, but the exact path is unresolved** — the `approval/asked` session event and the `approval/request` waterfall play the same clip, so hearing it does not tell the two apart |
| `job-failed` fires on background tool-task failures | **Read from source, never observed** |
| Alert repetition cannot happen on session resume | **Read from source** |
| macOS / Linux playback | **Not implemented** |
