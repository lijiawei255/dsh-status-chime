# Troubleshooting: there is no sound

Work down this list in order. It is sorted by how often each cause actually happens.

First, get at the log. The plugin writes to the **host process log**, which is stdout — so how
you read it depends on how DSH was launched:

| How you run it | Where the `[voice-alerts] …` lines are |
|---|---|
| Any build, chat UI | Run `/voice-alerts status`. It reports the loaded version, the detected player, the config path and the per-language clip state — no log file needed, and its `Voice alerts: on (v0.4.0)` line is what proves which code is actually on disk |
| CLI (`dsh`) started from a terminal | On stdout, in that terminal |
| Official desktop app | Piped to the shell's own stdout; **there is no per-day host log file in this build**. The shell writes only crash reports, to `%APPDATA%\@deepseek-ai\dsh-desktop\logs\crash-*.log` |

Earlier builds — and third-party shells — did write `%APPDATA%\<shell>\logs\host\dsh-<date>.log`.
If that file exists on your machine it is still worth reading; if it does not, that is expected
now rather than a fault. (Measured on the official 0.1.7-rc.2 desktop build: the string
`logs/host` appears nowhere in `app.asar`, and the host's stdout is piped to the shell with
`child.stdout.pipe(process.stdout)` while only crash reports are persisted.)

Search whatever you have for `voice-alerts`. What you find there splits the problem in half immediately:

| Log line | Meaning |
|---|---|
| `[voice-alerts] active v0.4.0 …` | The plugin loaded. If this line is missing entirely, see **1**. |
| `playing <scene>` | The plugin started a player for that scene. If you still hear nothing, see **2** and **3**. |
| `no <lang> audio for <scene>` | That language's clip file is missing. See **6**. |
| `throttled <scene>` | The repeat-suppression window caught it. Normal behaviour. |
| `neither ffplay nor Windows PowerShell is available` | See **2**. |

---

## 1. Did you restart DSH Desktop?

**The plugin code is not hot-loaded.** Installing it, or editing it, has no effect on a
running DSH Desktop. You must fully quit and reopen the application.

Check by running `/voice-alerts status` in the chat box:

- `Voice alerts: on (v0.4.0)` → the new code is loaded.
- Unknown command → the plugin is not loaded at all. Restart, and check for the
  `[voice-alerts] active` line in the log afterwards.

## 2. What does `/voice-alerts status` say about the player?

```
Player: unavailable (no sound possible)
```

means neither playback path could be found. That is unusual on Windows 10/11, because the
baseline path is part of the OS. Check that
`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe` exists.

If it says `PowerShell SoundPlayer (...)` or `ffplay (...)`, a player **was** found, so move
to the next step.

> ⚠️ **`ffplay` missing from the log is not a fault.** ffplay ships with ffmpeg, which is a
> separate install. It only makes startup faster and allows an independent volume. Without
> it the plugin uses the PowerShell player that ships with Windows, and everything still
> works.

## 3. Is the application muted in the Windows volume mixer? (most common)

This is the single most frequent cause of "the log says it played, but I heard nothing".

Windows gives each application its own volume slider, and **two different applications are
involved here** depending on which player was chosen:

- with ffmpeg installed → look for **`ffplay`**
- without ffmpeg → look for **`powershell.exe`** (or **Windows PowerShell**)

Right-click the volume icon in the taskbar → **Open Volume Mixer** (or Settings → System →
Sound → Volume mixer) and check that the relevant entry is not muted and is not at zero.

Note that the PowerShell path also **follows the system volume**: it has no volume control
of its own. If the system volume is low, the alert is quiet.

## 4. Is the right output device selected?

If you have speakers, headphones and a monitor with speakers, the alert may be playing into
a device you are not listening to. Check the default output device in Windows sound
settings.

## 5. Is that scene disabled?

Check `$DSH_HOME/voice-alerts.config.json`:

- `enabled` must be `true` (the master switch)
- `scenes.<scene>.enabled` must not be `false`

`/voice-alerts status` prints a line listing every scene as `on` or `off`, so you can see
this at a glance. `/voice-alerts off` writes `enabled: false`, so if alerts went quiet after
you ran something, check for that.

## 6. Is the clip file missing?

The log will say:

```
no zh audio for <scene>; looked in: <dir1> | <dir2> | <dir3>
```

The plugin resolves each clip through three levels, in order:

1. `clipsDir` from the config
2. `$DSH_HOME/voice-alerts/clips/`
3. `<package>/assets/clips/`

The paths it searched are printed, so check whether the file is actually in one of them.
Each scene needs **both** `<scene>.mp3` and `<scene>.wav`; the wav is what the PowerShell
fallback plays.

If you only have some files, that is fine and intended: resolution is per file, so a single
override in `$DSH_HOME/voice-alerts/clips/` replaces just that one scene.

## 7. Is it being throttled?

```
throttled <scene> (300ms < 1500ms)
```

The same scene will not repeat inside `minIntervalMs` (default 1500 ms). This is deliberate
— it stops a burst of events from machine-gunning the same clip. Wait, or lower
`minIntervalMs`.

Related: several events inside `coalesceMs` (default 400 ms) collapse to a single
highest-priority scene, so sometimes you hear one alert where you expected two. That is also
deliberate.

## 8. The alert plays while I am at the computer and it is annoying

Expected: the host process cannot tell whether the DSH window is focused, so alerts always
play. Options:

- `/voice-alerts off` (and `on` to restore)
- lower `volume` — **note this only affects ffplay**; the PowerShell player follows the
  system volume
- disable individual scenes under `scenes` in the config
- raise `minIntervalMs`

## 9. `/voice-alerts` says the command does not exist

Two possibilities:

- The plugin is not loaded (see **1**).
- Another plugin already registered a command with the same name. The DSH command registry
  rejects duplicates, and this plugin deliberately downgrades that to a warning rather than
  failing: the log will contain
  `could not register /voice-alerts (likely taken by another plugin); the rest of the plugin still works`.
  Alerts still play; only the command is missing. Set `commandName` in the config to
  something else to get it back.

## 10. A scene never fires

Check the verification table in the README first — one scene, `job-failed`, is known to be
unreachable for background shell commands, which is framework behaviour rather than a
plugin bug.

If **both** `job-done` and `job-failed` are dead while the other six scenes work, check which
background-job API your DSH exposes. The plugin logs one of these on load:

| Log line | Meaning |
|---|---|
| `jobs: listening on the settled stream ({ owners: 'all' })` | DSH ≥ 0.1.7, the current path. Job scenes are live. |
| `this dsh exposes only jobs.onJobDone (the pre-0.1.7 API)` | DSH ≤ 0.1.6, the fallback path. Also live — but see below. |
| `neither jobs.events.subscribe nor jobs.onJobDone exists on this dsh` | A DSH whose job event surface changed again. Job scenes are off; everything else still works. Please open an issue with this line. |

For any other scene, confirm the audio path independently:

```
/voice-alerts test <scene>
```

If that plays but the real event does not fire, the problem is the event, not the audio.
Useful things to check:

- `turn-done` only fires for turns **you** started. An autonomous round completing is
  intentionally silent; goal-level clips cover that case instead.
- `goal-complete` / `goal-blocked` need an actual goal. If you do not use goals, they never
  fire.
- `needs-input` depends on the tool names in `waitingTools`. If DSH renamed a tool, update
  that array in the config.
- `approval` is only reachable under the `ask` approval policy; under `never` nothing is
  waiting for you, so it never fires.

## 11. `dsh plugin add` fails with `ERR_PNPM_ADDING_TO_ROOT`

Installation runs through pnpm, and a DSH profile carries its own `pnpm-workspace.yaml`
declaring `packages: [.]`. That makes the profile look like a workspace root, so pnpm 9
refuses a plain `add`:

```
ERR_PNPM_ADDING_TO_ROOT  Running this command will add the dependency to the workspace
root … if you really meant it, make it explicit by running this command again with the -w flag
```

**Measured, not inferred:** pnpm **9** rejects the command; pnpm **11.8.0** accepts it as-is.
Whether pnpm 10 works was not tested. The documented fix is the `-w` flag, since
`dsh plugin` forwards arguments verbatim:

```powershell
dsh plugin --profile <PROFILE> add -w <package>
```

⚠️ **`-w` on pnpm 9 is not verified by this project.** This repository's own CI runs pnpm
11 and *refuses* pnpm below 10, so the combination users on pnpm 9 would need — `-w` on
pnpm 9 — is never exercised here. If `-w` does not work for you on pnpm 9, upgrading pnpm
is the path that is actually tested.

Note that this is a pnpm/DSH interaction, not a defect in this plugin: the same command
fails for any package.

## 12. A bare script invocation did something expensive when I only meant to look

**`build.mjs`**: an older copy defaulted a bare `node scripts/build.mjs` to the build mode, so
running it to see what the tool does triggered a real synthesis run and **overwrote every file
in `assets/clips/`**, including the ones committed to the repo. There was no help text and no
confirmation. Fixed: a bare invocation prints usage and generates nothing. If you are on an
older clone, either update, or use `git checkout assets/clips` to restore the shipped audio.

**`qa.mjs`**: the same trap, and it survived the fix above for longer. A bare
`node scripts/qa.mjs` defaulted to the `clips` mode, which sends all 16 clips to the **paid**
ASR and Omni endpoints. Nothing is overwritten, but it costs money and quota — and it is
exactly the thing you would run to find out how the script works. Fixed the same way: a bare
invocation prints usage, exits 0, and bills nothing.

Both now list their subcommands when run without one. If you are on an older clone and want
to be safe, always pass a subcommand explicitly.

## 13. I switched to English (or Chinese) and some scenes went silent

```
/voice-alerts status
```

Look at the `Clip sets` line:

```
Clip sets: zh (active): all clips present  |  en: missing turn-done, job-failed
```

Both languages ship in the package, so a missing set usually means someone generated a
partial set into `$DSH_HOME/voice-alerts/clips/`, or is running an old version from before
the second language existed.

Resolution order is per file: config `clipsDir`, then `$DSH_HOME/voice-alerts/clips/`, then
the packaged `assets/clips/`. A file present in your user directory **shadows** the packaged
one, so a stale or half-generated override can hide a good packaged clip. Remove the
offending user file, or regenerate with:

```powershell
node scripts/build.mjs build --lang en
```

Also note that a `language` value that is not `zh` or `en` **falls back to Chinese** rather
than muting the plugin, so a typo in the config looks like "my English setting did nothing"
— check the `Language:` line in `status` rather than assuming the setting took.

## 14. The command runs with no arguments, but typing `on` / `off` / `status` / `test` / `lang` does nothing

Symptom: `/voice-alerts` on its own works (you hear eight alerts and get a status reply),
but the moment you add a space and a word, nothing happens — the line is submitted as an
ordinary chat message instead of running the command.

**On versions before 0.3.0 this was a real bug**: the command was registered without an
`input` descriptor, and DSH's command UI claims a line whose first token is the bare
command name only when that descriptor is present. Without it, anything containing a space
fell through to "send as a message", so every sub-command was unreachable. Upgrading and
restarting fixes it. If you are on 0.3.0 or later and still see this, it is one of the two
character traps below.

**Trap 1 — a full-width slash.** With a Chinese IME active, `/` is easy to type as `／`
(U+FF0F). DSH checks the first character against an ASCII `/`, so the line is not a command
at all:

```
／voice-alerts lang en     ← not a command
/voice-alerts lang en      ← correct
```

**Trap 2 — a capital letter in the command name.** The name must match `/^[a-z][a-z0-9_-]*$/`,
so `/Voice-Alerts` or `/Voice-alerts` is not recognised:

```
/Voice-Alerts lang en      ← not a command
/voice-alerts lang en      ← correct
```

Picking the command from the autocomplete list avoids both traps, because the list inserts
the exact lowercase name.

Everything else is accepted. The whole remainder of the line is passed through as the
command's input, so a second word, several spaces, a tab, or extra trailing words all
work:

```
/voice-alerts lang en
/voice-alerts test goal-blocked
/voice-alerts lang  en
/voice-alerts lang EN          (case-folded)
/voice-alerts lang <en>        (the brackets are placeholder notation; tolerated)
```

## Still stuck?

Open an issue with:

1. The `[voice-alerts] active …` line from the log (it states the detected player and config
   path)
2. The output of `/voice-alerts status`
3. The `playing` / `no <lang> audio for` / `throttled` lines around the moment you expected sound
4. Whether you have ffmpeg installed
