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

The English gradient is monotonic in the same severity order as the Chinese, and every
adjacent pair is at least 22% apart, so urgency remains readable from clip length alone.

An earlier English `turn-error` was 6.55 s against a 6.46 s `job-failed` — a 0.10 s gap that
no listener could resolve, where the Chinese pair differs by 2.02 s (34%). The line was
lengthened and re-measured to 7.90 s. **Word counts are not a proxy for duration; the
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
| The English voice is a native English voice | Three candidates were ranked; two independent runs both placed `loongmary` first and the Chinese voice reading English last |

**Not verified:** that a missing English clip warns rather than silently falling back. The
shipped package always contains the English set, and packaged assets are the last link in
the resolution chain, so the branch cannot be reached without renaming shipped files — a
worse test than the gap it would close.

## 3. Backend layer

Measured with `scripts/selftest.mjs`, which forces each backend through the real code path.

| Check | Result |
|---|---|
| PowerShell path selects `.wav` and plays | ✅ the plugin resolves the wav, and `PlaySync` blocks for the clip duration (1.76 s for a 1.58 s clip) |
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

`scripts/selftest.mjs` runs 50 checks against a mock cordis context, with no restart and no
real event required. It covers: the eight scene mappings, the four silent goal operations,
subagent filtering, autonomous-round handling, coalescing and priority, per-scene
throttling, all four `/voice-alerts` verbs, command-name collision handling, asset
resolution order, and backend selection.

It runs against a temporary `DSH_HOME`, so it cannot disturb a real installation.

---

## Summary

| Claim | Confidence |
|---|---|
| The eight audio clips are correct and audible | **Verified** (measurement + listening) |
| The plugin plays on a clean Windows install with no third-party dependency | **Verified** |
| Seven of eight scenes fire on real events | **Verified** |
| `approval` fired on a real approval request | **Heard it, but the exact path is unresolved** — the `approval/asked` session event and the `approval/request` waterfall play the same clip, so hearing it does not tell the two apart |
| `job-failed` fires on background tool-task failures | **Read from source, never observed** |
| Alert repetition cannot happen on session resume | **Read from source** |
| macOS / Linux playback | **Not implemented** |
