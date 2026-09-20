# Troubleshooting: there is no sound

Work down this list in order. It is sorted by how often each cause actually happens.

First, find the log:

```
%APPDATA%\DSH Desktop\logs\host\dsh-<date>.log
```

Search it for `voice-alerts`. What you find there splits the problem in half immediately:

| Log line | Meaning |
|---|---|
| `[voice-alerts] active v0.3.0 …` | The plugin loaded. If this line is missing entirely, see **1**. |
| `playing <scene>` | The plugin started a player for that scene. If you still hear nothing, see **2** and **3**. |
| `no <lang> audio for <scene>` | That language's clip file is missing. See **6**. |
| `throttled <scene>` | The repeat-suppression window caught it. Normal behaviour. |
| `neither ffplay nor Windows PowerShell is available` | See **2**. |

---

## 1. Did you restart DSH Desktop?

**The plugin code is not hot-loaded.** Installing it, or editing it, has no effect on a
running DSH Desktop. You must fully quit and reopen the application.

Check by running `/voice-alerts status` in the chat box:

- `Voice alerts: on (v0.3.0)` → the new code is loaded.
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
Whether pnpm 10 works was not tested. The reliable fix is the `-w` flag, which works
regardless of version, since `dsh plugin` forwards arguments verbatim:

```powershell
dsh plugin --profile <PROFILE> add -w <package>
```

Note that this is a pnpm/DSH interaction, not a defect in this plugin: the same command
fails for any package.

## 12. `build.mjs` regenerated the bundled clips when I only meant to look

An older copy of this repository defaulted a bare `node scripts/build.mjs` to the build
mode, so running it to see what the tool does triggered a real synthesis run and
**overwrote every file in `assets/clips/`**, including the ones committed to the repo.
There was no help text and no confirmation.

Fixed: a bare invocation now prints usage and generates nothing. If you are on an older
clone, either update, or use `git checkout assets/clips` to restore the shipped audio.

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

## Still stuck?

Open an issue with:

1. The `[voice-alerts] active …` line from the log (it states the detected player and config
   path)
2. The output of `/voice-alerts status`
3. The `playing` / `no <lang> audio for` / `throttled` lines around the moment you expected sound
4. Whether you have ffmpeg installed
