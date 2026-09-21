# dsh-status-chime

**[中文](README.md) | [English](README.en.md)**

> Spoken status alerts for DeepSeek Harness: when a turn finishes, fails, a background job ends, or the agent starts waiting for you, say it out loud instead of only flashing a taskbar icon.

![platform](https://img.shields.io/badge/platform-Windows%2010%20%2F%2011-lightgrey)
![license](https://img.shields.io/badge/license-MIT-blue)

---

## Why this exists

DSH's built-in notifications are **visual**: a flashing taskbar icon and a system toast. Both carry a hidden assumption — **that you are looking at the screen**.

But the moments that actually need a notification are usually the moments you are not:

- A long run finally finishes
- A background job fails after you have moved on to something else
- The agent stops to ask you a question, and then waits there for half an hour
- A goal gets blocked and needs you before it can continue

So the alert is missed and time is wasted. **Switching to audio turns "I have to keep watching" into "I only have to be within earshot"** — you can go make tea, read something, or work on another machine.

Install it and it works. There is nothing to configure.

## The eight scenes

The durations are **deliberate**: **long = something needs you, short = something ended**.

More precisely it is **three bands**, not "each clip a notch longer than the next":

| Band | Range | Scenes |
|---|---|---|
| Failed / blocked — needs you most | 4.8 – 8.0s | `turn-error`, `job-failed`, `goal-blocked` |
| Waiting for you to act | 3.0s | `approval` |
| Ended (or a simple question) | 1.6 – 2.6s | `job-done`, `goal-complete`, `needs-input`, `turn-done` |

**Clips inside a band sit deliberately close**, because they are the same urgency: `goal-complete` (2.16s) and `needs-input` (2.09s) differ by **0.07s**, and the Chinese set differs by 0.07s too. **Length tells you the band, not which clip.**

| Scene | Fires when | Chinese | English | Urgency |
|---|---|---|---|---|
| `turn-error` | The turn failed, or hit the token ceiling | **7.97s** | 7.90s | failed/blocked — longest |
| `job-failed` | A background job failed | 5.95s | 6.46s | failed/blocked |
| `goal-blocked` | A goal is blocked and needs you | 4.78s | 4.85s | failed/blocked |
| `approval` | An action is waiting for your approval | 3.00s | 3.00s | waiting for you |
| `job-done` | A background job finished | 2.59s | 2.59s | ended |
| `goal-complete` | The goal finished (once, not per round) | 2.16s | 2.16s | ended |
| `needs-input` | The agent stopped to ask you something | 2.09s | 2.09s | a quick question |
| `turn-done` | A turn you started finished normally | 1.58s | 1.92s | ended — shortest |

⚠️ **The two sets have different durations — do not mix them up.** The Chinese and English clips are synthesized separately (different voice, different language), so the order matches but the numbers do not: English `job-failed` is **6.46s** against the Chinese **5.95s**. Both columns are given above; read the one for the language you actually use.

Two **filtering rules** deserve a note, because they are what keeps this plugin from becoming a source of noise:

- **`turn-error` does not check who started the turn.** A failure during an autonomous round still needs to reach you.
- **`turn-done` only speaks for human-initiated turns.** Otherwise a goal that runs 20 rounds would play "task complete" 20 times. Autonomous progress is reported at the **goal** level by `goal-complete` / `goal-blocked`, not per round.

`approval` only fires under the `ask` approval policy; under `never` nothing is waiting for you, so nothing is spoken. It listens on the **`approval/asked` session event**, which is always emitted under `ask`, with the scoped `approval/request` waterfall kept as a fallback. Both paths play the same clip.

Audio samples: GitHub's Markdown cannot embed a player, so the clips are attached to the [Releases](https://github.com/lijiawei255/dsh-status-chime/releases) page, where they can be played directly.

## Two languages: Chinese (default) and English

**One package ships both sets** — all eight scenes in Chinese and in English. Switching does not require reinstalling. The default is Chinese.

```
/voice-alerts lang        # show the current language
/voice-alerts lang en     # switch to English
/voice-alerts lang zh     # back to Chinese
```

The switch is written back to the config file (the `language` field), so it survives a restart. You can also just edit the config:

```json
{ "language": "en" }
```

### The English lines are rewritten, not translated

This matters, because it goes to the core of the design.

A literal translation of the Chinese runs long and flat in English, and **clip length is the only channel this plugin has for conveying urgency**. Once the English lengths drift, judging "do I need to go over there" from the sound alone stops working. So the eight English lines were rewritten for English rather than translated:

| Scene | Chinese | English |
|---|---|---|
| `turn-done` | 任务完成。 | Turn complete. |
| `needs-input` | 需要你回答。 | Waiting for your answer. |
| `goal-complete` | 目标已完成。 | The goal is complete. |
| `job-done` | 后台任务完成。 | The background job has finished. |
| `approval` | 有操作等待你批准。 | An action is waiting for your approval. |
| `goal-blocked` | 目标受阻，需要你介入处理后才能继续。 | The goal is blocked. It needs you before it can continue. |
| `job-failed` | 后台任务失败，请回到 DSH 查看详情。 | The background job failed, and it needs your attention. Check DSH for details. |
| `turn-error` | 任务执行出错，本轮未能完成，请回到 DSH 查看错误详情。 | The turn failed, so this round did not finish. Open DSH to see the error details, then try again. |

The English durations run **1.92s → 7.90s**, monotonic in the same severity order as the Chinese. What the length actually separates is the **three urgency bands**: the step into the failed/blocked band is **38%** (3.00s → 4.85s). **Within a band the clips sit close on purpose** — `goal-complete` (2.16s) against `needs-input` (2.09s) is **0.072s**, and the Chinese set has the same near-tie. Length tells you the band, not which clip.

> ⚠️ One trap worth recording: the English `turn-error` started at 16 words / 6.55s while `job-failed` was 6.46s — a 0.10s gap, **inaudible**. The Chinese pair differs by 2.02s (**25%** of the longer clip; every percentage in this file uses that convention). Lengthening the English error line to 19 words restored a 1.44s gap. **If you edit the copy, re-measure the durations** rather than trusting the word count.

The English set uses `loongmary` (a warm British voice) rather than having the Chinese voice read English. Three candidates were auditioned and ranked (`scripts/qa.mjs rank`; the output lands in `qa/`, which is not version-controlled — a repeat run kept the same order). The Chinese voice reading English scored lowest and was described as noticeably synthetic with unnatural rhythm: **naturalness 4/10, character 5/10** (the two are easy to mix up — `naturalness` is 4, `character` is 5).

`/voice-alerts status` lists each language's clip availability:

```
Clip sets: zh (active): all clips present  |  en: all clips present
```

## Three things to know first

1. **Platform: Windows 10/11.** The guaranteed player is Windows' own PowerShell + `System.Media.SoundPlayer`; there is **no macOS or Linux support**. With ffmpeg installed it prefers `ffplay`, but that is an optional upgrade.
2. **You need DSH Desktop** and a terminal that can run `dsh`. Installing a plugin goes through `dsh plugin`, which shells out to **pnpm** (see the trap below).
3. **The audio needs nothing installed** — all 32 clips, both languages, ship in the package.

### ⚠️ Read once: the package name and the runtime name differ

This is the easiest thing to trip over, so it is worth stating plainly:

| | Name |
|---|---|
| **npm package / GitHub repo** | `dsh-status-chime` |
| **Slash command** | `/voice-alerts` |
| **Log prefix** | `[voice-alerts]` |
| **Config file** | `$DSH_HOME/voice-alerts.config.json` (the primary path) |
| **Clip directory** | `$DSH_HOME/voice-alerts/clips/` |
| **cordis id** | `voice-alerts` |

> There is also a **legacy config location** kept for compatibility: `$DSH_HOME/voice-alerts/voice-alerts.config.json`. The plugin reads **whichever it finds first** (primary path first), so if the primary file already exists, edits to the legacy file are **silently ignored**. `/voice-alerts lang` and `on`/`off` write to the primary path. When in doubt, check the `config <path>` line in the startup log.

**The package was renamed from `dsh-voice-alerts` to `dsh-status-chime` in 0.3.0** (the old name differed by one letter from an unrelated plugin in the community catalog, which the marketplace rules would have hidden). The rename touches **only the package and repository names**: the command, config paths and log prefix are all still `voice-alerts`, so an existing install keeps working.

**When debugging, grep the log for `voice-alerts`, not `dsh-status-chime`.**

## Install

### Option 1: hand it to your agent (recommended)

Send this to your DSH:

> Install `https://github.com/lijiawei255/dsh-status-chime` into my DSH desktop profile, and remind me to restart when it's done.

The repository includes [INSTALL.md](INSTALL.md), which spells out every step. Its purpose is to make **different agents produce the same result** instead of improvising.

### Option 2: run the commands yourself

Replace `<PROFILE>` with your own profile name (usually `desktop`). **Look at what is actually under `$DSH_HOME/profiles/` first** rather than copying someone else's:

```powershell
# straight from GitHub
dsh plugin --profile <PROFILE> add github:lijiawei255/dsh-status-chime

# or clone / download a ZIP first, then point at the local directory
git clone https://github.com/lijiawei255/dsh-status-chime
dsh plugin --profile <PROFILE> add .\dsh-status-chime
```

This installs the package into the profile and registers it as a profile layer (which works because the package declares `dsh.bundle`; this repository already does).

**⚠️ If you hit `ERR_PNPM_ADDING_TO_ROOT`**: the profile carries its own `pnpm-workspace.yaml` declaring `packages: [.]`, so pnpm 9 refuses a plain `add`. Add `-w`:

```powershell
dsh plugin --profile <PROFILE> add -w github:lijiawei255/dsh-status-chime
```

(Measured: pnpm 9 rejects it, pnpm 11.8.0 accepts it, and **pnpm 10 was not tested** - so `-w` is the safer fix.) See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) item 11.

**You must fully restart DSH Desktop afterwards**, otherwise the plugin is not loaded.

### After the restart

In the chat box, run:

```
/voice-alerts status
```

If you see `Voice alerts: on (v0.3.0)`, `Language: zh` and `Scenes (8)`, the install worked. To hear all eight:

```
/voice-alerts
```

### Uninstall

```powershell
dsh plugin --profile <PROFILE> remove dsh-status-chime
```

Uninstalling does **not** delete anything under your `$DSH_HOME`. To remove it all, delete these two:

```powershell
# clips, play.ps1, clips.json
Remove-Item -Recurse -Force "$env:USERPROFILE\.dsh\voice-alerts"
# the runtime config (it is NOT inside that directory - it is a sibling file)
Remove-Item -Force "$env:USERPROFILE\.dsh\voice-alerts.config.json"
```

QA reports are not under `$DSH_HOME` at all - they are written to `qa/report.md` inside the package directory. A **full DSH Desktop restart** is needed for the removal to take effect.

## How it works

```
DSH events  ──▶  lib/index.js  ──▶  coalesce / throttle / priority  ──▶  player  ──▶  audio files
```

**Event sources** (all public host-process events):

| Event | Used for |
|---|---|
| `session/event` → `turn/start` / `user/message` / `turn/end` | Whether the turn was human-initiated, and how it ended |
| `session/event` → `goal/change` | Goal `complete` and `block` |
| `jobs.onJobDone` | Background job `completed` and `failed` |
| `tools/pre-execute` | A tool name in `waitingTools` means the agent is about to wait for you |
| `session/event` → `approval/asked` | **Primary path**: always emitted when the approval policy is `ask` |
| `approval/request` | **Fallback**: the scoped waterfall, also only under `ask`; both play the same clip |

**Playback rules**: several events inside one 400 ms window collapse to the **highest-priority** scene only; the same scene will not repeat within 1.5 s; a new alert interrupts the one playing.

**Zero network at runtime**: the plugin reads local audio files and starts local players. It does not connect out, upload, or phone home.

## The interesting part: using a large model to pre-screen the voice

This is the piece I think is most worth sharing.

Picking a voice for an alert sound is traditionally done by **blind listening**: try ten voices, rewrite the style description twenty times, tire your ears out, and then decide from a vague impression. This project does it differently — **let a model do the first pass and the ranking, and keep the human for the final call among a handful of survivors.**

Three concrete pieces:

**1. A full-modality model as the reviewer (the core idea)**

`tools/qw_local_omni.py` hands **several candidate clips at once** to Qwen-Omni and asks for a cross-comparison with per-dimension scores:

```powershell
python tools/qw_local_omni.py preview/flash-mary-en.mp3 preview/flash-eva-en.mp3 preview/flash-yuanfei-en.mp3 `
  --message "Compare these recordings against each other: rate clarity, naturalness, voice character and cleanliness, and rank them."
```

What comes back is a **ranking**, not a pile of isolated scores — "A is closer to the target than B" is far more useful than "A scored 7". In practice the reasoning is specific:

> A4 is the only one that keeps the clarity and steadiness of a system alert while achieving a low, breathy texture. A2 is mature but not distinctive enough, A5 is a little flat, and A1, A3 and A6 are excluded for being too bright or too young-sounding.

**2. ASR read-back as an objective check**

Sounding pleasant is not enough — TTS can swallow syllables, mispronounce, or spell an abbreviation out letter by letter. `tools/qw_local_asr.py` transcribes the audio and compares it against the intended line by character similarity:

```powershell
python tools/qw_local_asr.py assets/clips/turn-error.mp3 --lang zh
```

This one is a legitimate **hard gate**, because it is mechanically decidable: the intended text is known, and the transcript either matches or it does not. All 16 clips in this project (8 scenes in each of 2 languages) score **1.000**.

**3. Duration as an information channel**

The durations in the table above are not arbitrary. Severity is encoded in the audio itself: **long = something needs you**. That way, even with the phone beside you and the screen out of view, the length alone tells you whether to put down what you are holding.

**The resulting workflow** (two scripts, fully reproducible):

```
scripts/build.mjs audition    produce several candidate voices
      ↓
scripts/qa.mjs rank           cross-ranking by the omni model (no ASR; that happens next)
      ↓
a human listens to the top 2-3 and decides    ← decision load compressed to very little
      ↓
scripts/build.mjs build       batch synthesis + loudness normalisation
      ↓
scripts/qa.mjs clips          quality gate over everything
```

**One lesson worth passing on**: do not make a model's subjective score a hard gate. The same clip was scored "naturalness 6 / character 4" on one run and "naturalness 9 / character 7" on the next, and four clearly different clips once received identical scores. So this project splits the metrics in two: **objective measures (ASR similarity, clipping, clarity, cleanliness) gate the build, and subjective ones (naturalness, character, maturity) only inform the decision**, with the final call left to ears. That division is what makes the workflow stable enough to rely on.

**Three checks added later**, each because a specific hole turned up first:

| Check | Tier | Why it exists |
|---|---|---|
| **Silence floors** (peak >= -30 dB, mean >= -35 dB) | hard gate | The peak check only looked for **clipping**, so a clip with a plausible length and **no signal at all** passed every gate — one of the classic TTS failure modes. Measured on the shipped clips: peak -4.2..-1.9 dB, mean -20.6..-16.6 dB, against -91 dB for true silence. **The two margins are not equal**: the peak floor clears the worst shipped clip by **25.8 dB** (-4.2 against -30), the mean floor by **14.4 dB** (-20.6 against -35) |
| **Net speech rate** (units per second of actual speech) | advisory | The Chinese set speaks **deliberately slowly** (rate 0.95), so the 3.2-5.5 units/s band from human broadcast-speech research would fail **seven of the eight**. What matters here is consistency between clips, because length carries the urgency, so each clip is compared against the **median of its own language**. Clips under 5 units are exempt, or a two-word clip would false-positive |
| **UTMOS** (a trained MOS predictor) | advisory | Gives naturalness a **reproducible** number, which is the gap the unreliable model score left. It must be compared **per language**: it scores every English clip **above** every Chinese one (4.38-4.51 against 3.75-4.28), so a cross-language comparison would read as a defect in the Chinese set |

All three have **negative controls** (`scripts/qa-negative-control.mjs`, offline and free): it injects a fully silent clip, a very quiet one, and a stretched one, then asserts the gates actually report them while a healthy clip is left alone. A gate that only ever says "pass" is worth nothing.

> One detour worth recording: before adding the silence floors, an existing TTS QA tool (`ttsproof`) was tried. It catches clipping and truncation but **not a fully silent file** — its `empty_audio` flag only tests for a missing file or one under 44 bytes, never the content. So that floor is hand-written rather than inherited.

## Configuration

Config file: `$DSH_HOME/voice-alerts.config.json` (`$DSH_HOME` is usually `~/.dsh`).
When the file is absent the built-in defaults apply, **so nothing has to be configured**. It is re-read by modification time, so edits take effect immediately without a restart.

Full template: [`assets/voice-alerts.config.json`](assets/voice-alerts.config.json). Common entries:

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch |
| `volume` | `85` | 0-100, **ffplay only** |
| `minIntervalMs` | `1500` | Repeat-suppression window per scene |
| `coalesceMs` | `400` | Coalescing window; only the top-priority scene inside it plays |
| `interrupt` | `true` | Whether a new alert cuts off the current one |
| `scenes.<scene>.enabled` | `true` | Turn a single scene off |
| `player` | `"auto"` | `auto` / `ffplay` / `powershell` |
| `ffplayPath` | `null` | Explicit ffplay path, for when it is not on PATH |
| `playPs1Path` | `null` | Explicit path to the fallback script `play.ps1` |
| `commandName` | `"voice-alerts"` | Slash command name. A collision with another plugin loses only the command, not the alerts |
| `waitingTools` | `["ask_user_question","exit_plan_mode"]` | A match means "waiting for you"; override if DSH renames a tool |
| `language` | `"zh"` | Spoken language: `zh` / `en`. An unrecognised value falls back to `zh` rather than going silent |
| `watchApprovals` | `true` | Whether an approval request is spoken (only reachable under the `ask` policy) |
| `clipsDir` | `null` | Extra clip directory, highest precedence |

## Commands

| Command | Effect |
|---|---|
| `/voice-alerts` | Play all eight in sequence (in the current language) |
| `/voice-alerts on` / `off` | Toggle immediately (writes back to the config file) |
| `/voice-alerts lang <zh\|en>` | Switch the spoken language; written back to the config |
| `/voice-alerts status` | Show the detected player and whether every scene has audio in each language |
| `/voice-alerts test <scene>` | Play one scene, to check whether an event fires at all |

## Using your own voice

You do not have to use the eight bundled clips. The full flow:

```powershell
# 1. Edit assets/clips.json: lines under clips.<scene>.text, voice under model/voice/instruction
# 2. When changing voice, audition first (list candidates under voiceCandidates)
node scripts/build.mjs audition
node scripts/qa.mjs rank                 # the model ranks them; you pick the final one
# 3. Write the chosen model/voice/instruction back into clips.json, then build
node scripts/build.mjs build
node scripts/qa.mjs clips                # quality gate
```

Generating audio requires **ffmpeg** (normalisation and transcoding), **Python 3** (the QA helpers) and the **Alibaba Cloud Bailian CLI** (TTS/ASR/Omni). Those three are **only needed if you generate your own** — with the bundled clips, nothing has to be installed.

Each clip is produced as both `mp3` and `wav`. **Do not delete the wav files**: the PowerShell fallback player only accepts uncompressed PCM, and it is what guarantees the plugin works on a clean Windows install.

Audio you generate into `$DSH_HOME/voice-alerts/clips/` automatically takes precedence over the packaged files, per file, so you can replace just one scene.

**The filename rule matters** if you want to replace a single English clip:

| Language | Filename |
|---|---|
| Chinese (default) | `<scene>.mp3` / `.wav`, e.g. `turn-done.mp3` |
| English | `<scene>.en.mp3` / `.en.wav`, e.g. `turn-done.en.mp3` |

**The default language keeps the bare name; every other language adds a `.<code>` infix.** So to replace only the English `approval`, drop in `approval.en.mp3` (and `.wav` if you rely on the PowerShell fallback player).

## No sound?

Work through this order; it covers the overwhelming majority of cases. The full list is in [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

1. **Did you restart?** The plugin file is not hot-loaded; a new install or edit needs a full DSH Desktop restart.
2. Check the **Player** line from `/voice-alerts status`. `unavailable` means neither playback path was detected.
3. **The Windows volume mixer has `ffplay` (or `powershell.exe`) muted on its own** — this is the most common cause. Right-click the taskbar volume icon → Open Volume Mixer, and check the matching entry.
4. The wrong output device is selected.
5. That scene is disabled, or `enabled` is `false`.
6. The log says `no <lang> audio for <scene>` (e.g. `no zh audio for turn-done`) → that language's clip file is missing.
7. The log says `throttled <scene>` → the repeat-suppression window caught it. That is expected behaviour.

Log location: `%APPDATA%\DSH Desktop\logs\host\dsh-<date>.log`; search for `voice-alerts`.

⚠️ **One thing to know up front**: **the absence of `ffplay` in the log is not a fault.** ffplay ships with ffmpeg, which is a separate install; it only makes startup faster and gives you a separate volume. Without it the plugin uses the PowerShell player that ships with Windows, and everything still works.

## Platform and dependencies

**Supported: Windows 10 / 11.**

On a clean Windows install **no third-party dependency is needed to make sound**, because the baseline player is Windows PowerShell 5.1 plus the .NET `System.Media.SoundPlayer`, both part of the OS.

| Situation | What is needed |
|---|---|
| Clean Windows 10/11 with only DSH | **Nothing** — the OS player is used, with roughly 0.4 s of startup overhead |
| ffmpeg installed | Nothing to configure; ffplay is used automatically: faster start, and `volume` takes effect |
| Generating your own audio | Additionally ffmpeg + Python 3 + the Bailian CLI |
| Network at runtime | **None** |

Backend selection order:

1. **ffplay** (when detected) — plays mp3 directly and supports an independent volume
2. **Windows PowerShell + SoundPlayer** — ships with the OS, accepts wav only, volume follows the system
   It first tries `-File play.ps1` (an auditable script on disk); if an execution policy or ACL blocks it, it retries once with an inline `-EncodedCommand`
3. Neither available → silent degradation with a single log line

The host process **cannot tell whether the window is focused** (DSH's native bridge exposes only things like `notifyAttention`), so this plugin **always makes sound**, including while you are looking at the window. If that is too much, use `/voice-alerts off` or lower `volume`.

## Verification status

I find it more useful to separate "written" from "verified" than to claim vaguely that
everything works. So, item by item — including an explicit statement of **where the
verification stops**.

The table below is the summary. **The per-item evidence, the measurements, and exactly how
far each check was taken live in [`docs/verification.md`](docs/verification.md)** — go there
to check any individual number.

### Verification boundary (read this first)

**Every conclusion below comes from verification on a single machine:**

| | |
|---|---|
| Operating system | Windows 11 |
| DSH | DSH Desktop 2.0.13, `@deepseek-ai/dsh` **0.1.5-rc.2** |
| Extra software on that machine | ffmpeg, Python 3 and the Alibaba Cloud Bailian CLI are installed |

**What that means:**

- ✅ **Code correctness, event mapping, audio quality** — independent of what that machine
  happens to have installed, so these carry over to your machine.
- ✅ **"Zero dependency on a clean Windows install"** — the baseline player is Windows
  PowerShell 5.1 plus .NET `System.Media.SoundPlayer`, both **operating-system components**
  of Windows 10/11, and the no-ffmpeg case was verified by simulation.
- ⚠️ **DSH version** — verified **only on the version above**. A newer or older DSH that
  changed the event surface could stop some scenes from firing. This is the one genuinely
  unknown variable, and it is not something a test on this machine can remove.
- ⚠️ **Installing from GitHub on someone else's completely clean Windows** — **there was no
  second machine available, so this step has not been measured directly.** CI (below) covers
  "install + load + backend detection" on a clean GitHub-hosted Windows runner, but **a
  runner has no audio device, so it cannot verify that sound reached a speaker**.

If you hit a problem on another DSH version or another machine, please open an issue with the
`[voice-alerts] active …` line from your log — it states the detected player and the config
path, which usually pinpoints the cause immediately.

### Status by layer

| Layer | Status |
|---|---|
| **Events** | 7 of the 8 scenes have been verified by a real trigger: `turn-done`, `turn-error`, `needs-input`, `job-done`, `goal-complete`, `goal-blocked`, `approval` |
| **Audio** | All 16 clips (8 scenes in each of 2 languages) passed the automated quality gate (ASR similarity 1.000, clarity and cleanliness 10/10, no clipping). The **Chinese** set was additionally confirmed by ear, clip by clip, to play through completely; **the English set has not had that listening pass** — it passed the automated gate only |
| **Backend** | Forcing PowerShell selects `.wav` correctly; with no ffmpeg present it falls back and still plays; an explicitly requested but absent ffplay fails loudly instead of switching backends behind your back |
| **Code** | `scripts/selftest.mjs` drives the plugin through a mock context with **55 checks** covering event mapping, filter rules, priority, throttling, the command, name collisions, asset resolution order, and language switching with its fallback |
| **Language** | Chinese is the default; after `lang en` the plugin genuinely resolves the English **file** (the test asserts on the resolved filename, not just the status text); an unrecognised language in the config falls back to Chinese instead of going silent |
| **CI** | `.github/workflows/verify.yml` verifies on a clean `windows-latest`: a real install that registers as a profile layer, BOM-free manifests, node-builtins-only imports, all 32 clips present, **the PowerShell backend still detected with no ffplay**, the 55-check suite, and the privacy scan |

On the `approval` scene specifically: it can only fire under the `ask` approval policy, and
although it was heard on a real approval request, **which of the two paths delivered it is
unresolved** — the `approval/asked` session event and the `approval/request` waterfall play
the same clip, so hearing it does not distinguish them. The behavior of the session-event
path (including subagent filtering) is covered by the offline suite.

What CI does and does not prove is written out at the top of the workflow file — including
the fact that **it cannot prove sound reaches a speaker**.

### One known defect, stated plainly

**`job-failed` is effectively unreachable for a background shell command that exits non-zero.**

Measured: a command run in the background that ended with `exit 7` was recorded by DSH as `completed`, so what played was "background job finished". The reason is that a job snapshot **has no exit code field**, and the producer for background shell commands only ever emits `completed` or `killed`. `failed` is reserved for a background **tool** task reporting an error, or for a producer contract violation.

For what it is worth: **DSH's own `desktop-notifications` keys off the same `status === 'failed'`, so it has exactly the same blind spot** — this is framework behaviour, not an implementation error in this plugin.

The scene is **kept** (it does work for tool-task failures), but its trigger **has never been reproduced**, only checked at the source level. You can confirm the audio itself is fine with `/voice-alerts test job-failed`.

## Repository layout

```
dsh-status-chime/
├── lib/index.js                  # the plugin; the only runtime code
├── cordis.patch.yml              # registers this package as a profile layer (dsh.bundle points here)
├── package.json                  # name, dsh.bundle declaration, engines
├── assets/
│   ├── clips/                    # 8 scenes x 2 languages = 16 clips, mp3 + wav each (32 files)
│   ├── clips.json                # single source of truth for lines, voice and settings
│   ├── voice-alerts.config.json  # config template
│   └── play.ps1                  # PowerShell fallback player (pure ASCII; see the file header)
├── tools/                        # Bailian local-audio helpers (ASR / Omni / UTMOS)
├── scripts/                      # build / qa / selftest / negative control / privacy scan
│   ├── build.mjs                 # synthesise clips (takes --lang)
│   ├── qa.mjs                    # quality gate (takes --lang)
│   ├── selftest.mjs              # offline logic suite, 55 checks
│   ├── qa-negative-control.mjs   # proves the gate actually rejects bad audio
│   ├── verify-local-install.mjs  # verifies an installed single-file copy
│   ├── scan-sensitive.mjs        # privacy / wording scan
│   └── scan-sensitive.verify.mjs # proves the scanner actually catches things
├── docs/verification.md          # the per-item verification record
├── .github/workflows/verify.yml  # CI: install + suite + scan on a clean Windows runner
├── INSTALL.md                    # install steps written for an agent
├── TROUBLESHOOTING.md            # what to do when there is no sound
├── README.md                     # Chinese README
├── CHANGELOG.md
└── LICENSE                       # MIT
```

`qa/`, `preview/` and `tmp/` are scratch directories the scripts write; they are in
`.gitignore` and are not part of the package.

## License

Code and bundled audio are released under **MIT**.

The bundled audio was synthesized with Alibaba Cloud Bailian (Model Studio) text-to-speech. It is not a recording of any person's voice; if you intend to use it, check that your own use is consistent with the terms of the service it was generated with. Nothing here grants rights to the underlying voice model. You do not have to use it at all — `scripts/build.mjs` can generate your own set, and the plugin prefers files you place in `$DSH_HOME/voice-alerts/clips/`.

## Contributing

Before submitting, run both of these. The first confirms no personal path or credential
slipped in; the second confirms the logic suite is still green:

```powershell
node scripts/scan-sensitive.mjs .
node scripts/selftest.mjs
```

`scan-sensitive.mjs` **reports only a file, a line number and a matched category — never the
matched text** — so its output is safe to paste into an issue. Its rule set can be extended
with strings private to your own machine via `$DSH_HOME/voice-alerts.scan.json`, which is not
committed. To confirm it actually catches things, run
`node scripts/scan-sensitive.verify.mjs`: it plants obviously fabricated credential-shaped
values, asserts the scanner reports them, and asserts the report never echoes them.

Issues and pull requests are welcome. Especially welcome: macOS / Linux playback backends
(the backend layer is Windows-specific today).
