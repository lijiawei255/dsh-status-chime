# Verification record

This file separates what has been **measured** from what has only been **read**. It exists
because "the feature is implemented" and "the feature was observed working" are different
claims, and the difference matters when you are deciding whether to rely on something.

Environment: DSH Desktop 2.0.x, `@deepseek-ai/dsh` 0.1.5-rc.2, Windows 11.

---

## 1. Event layer

Each scene was checked against the DSH source first, then triggered for real where possible.

| Scene | Trigger | Status |
|---|---|---|
| `turn-done` | `session/event` → `turn/end`, reason `completed`, human-initiated | ✅ observed repeatedly |
| `turn-error` | `turn/end`, reason `error` or `max-tokens` | ✅ observed |
| `needs-input` | `tools/pre-execute` with a tool name in `waitingTools` | ✅ observed repeatedly |
| `job-done` | `jobs.onJobDone`, status `completed` | ✅ observed |
| `goal-complete` | `session/event` → `goal/change`, operation `complete` | ✅ observed |
| `goal-blocked` | `goal/change`, operation `block` | ✅ observed |
| `approval` | `session/event` → `approval/asked` (also the `approval/request` waterfall) | ✅ observed — heard on a real approval request, but **which of the two paths delivered it is unresolved**; they play the same clip. See §2b |
| `job-failed` | `jobs.onJobDone`, status `failed` | ⚠️ **never observed** — see §4 |

"Observed" means the host log contains a `playing <scene>` line **without** the `manual`
suffix that `/voice-alerts test` adds. That distinction is what separates a real event from
a test playback.

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
| `/voice-alerts lang en` selects English | The offline suite asserts the **resolved filename** ends in `.en.mp3`, not merely that the status text changed |
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
| PowerShell path selects `.wav` and plays | ✅ the plugin resolves the wav and `PlaySync` blocks for the clip duration |
| With ffmpeg absent, playback falls back automatically and still works | ✅ forcing `player: auto` with a bogus `ffplayPath` yields `Player: PowerShell SoundPlayer` and a successful playback |
| An explicitly requested but missing ffplay fails loudly | ✅ it reports unavailable instead of silently switching backends |
| Packaged clips resolve with no `clipsDir` configured | ✅ all eight found in `assets/clips/` |
| A user-level file takes precedence over a packaged one | ✅ |

Measured startup overhead of the PowerShell path: roughly **0.4 s** on top of the clip
duration (three runs of a 1.58 s clip took 2.00 / 1.94 / 2.00 s).

## 4. The one defect that could not be reproduced

**`job-failed` does not fire for a background shell command that exits non-zero.**

Measured directly: two background commands were started, one ending `exit 0` and one ending
`exit 7`. Both produced `playing job-done` in the log.

Cause, established by reading the DSH source rather than guessing:

- The job snapshot exposed to `onJobDone` contains
  `id, kind, label, status, detail, startedAt, finishedAt, reported` — **there is no exit
  code field**.
- The producer for background shell commands assigns only `completed` or `killed`
  (`status = aborted ? 'killed' : 'completed'`).
- `failed` is assigned when a background **tool** task reports an error
  (`status: result.isError ? 'failed' : 'completed'`) or when a producer contract is
  violated.

So the scene is correct and does cover tool-task failures, but its trigger has never been
observed here. It is documented as unverified rather than quietly described as working.

For context: DSH's own `desktop-notifications` plugin keys off the same
`status === 'failed'`, so it misses these failures too. This is framework behaviour.

## 5. Replay safety

A resumed, forked or replayed session must not replay alerts.

Verified by reading `dsh-session`, which states that events entering through construction
"were never published on the `session/event` firehose (constructor seeds do not emit)".
Since every scene is driven from `session/event` (plus `jobs.onJobDone`), a resumed session
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

`scripts/selftest.mjs` runs 53 checks against a mock cordis context, with no restart and no
real event required. It covers: the eight scene mappings, the four silent goal operations,
subagent filtering, autonomous-round handling, coalescing and priority, per-scene
throttling, all four `/voice-alerts` verbs, command-name collision handling, asset
resolution order, and backend selection.

It runs against a temporary `DSH_HOME`, so it cannot disturb a real installation.

---

## Summary

| Claim | Confidence |
|---|---|
| The audio clips are correct and audible | **Verified** — all 16 through measurement; the eight **Chinese** clips additionally by listening. The English set has not had the listening pass (see §2) |
| The plugin plays on a clean Windows install with no third-party dependency | **Verified** |
| Seven of eight scenes fire on real events | **Verified** |
| `approval` fired on a real approval request | **Heard it, but the exact path is unresolved** — the `approval/asked` session event and the `approval/request` waterfall play the same clip, so hearing it does not tell the two apart |
| `job-failed` fires on background tool-task failures | **Read from source, never observed** |
| Alert repetition cannot happen on session resume | **Read from source** |
| macOS / Linux playback | **Not implemented** |
