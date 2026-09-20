# INSTALL.md — install steps written for an agent

> **Audience: an AI agent installing this plugin on a user's machine.**
> This file exists because "install this plugin for me" otherwise produces a different
> result every time. Follow the steps in order and do not improvise.
>
> **Audience note for humans:** you probably want [README.md](README.md) instead. This
> file is the same install, written as precise instructions so an agent gets it right.

Verified against: DSH Desktop 2.0.x with `@deepseek-ai/dsh` 0.1.5-rc.2, on Windows 10/11.

---

## What you are installing

A DSH plugin that speaks a short spoken alert when a turn finishes or fails, a background
job ends, or the agent starts waiting for a human. It is a **profile-level bundle**: it
declares `dsh.bundle.patch` in its `package.json`, so installing it registers it as a
profile layer automatically.

**Platform:** Windows 10/11 only. It plays audio by launching a local player process. It
needs **no third-party runtime dependency** — the baseline player is Windows PowerShell 5.1
plus .NET `System.Media.SoundPlayer`, both part of Windows. `ffplay`, if present, is used
instead for a faster start.

**Cost:** none. The runtime is fully offline.

---

## Step 1 — Determine the profile name

DSH keeps one directory per profile under `$DSH_HOME/profiles/` (`$DSH_HOME` is normally
`~/.dsh`).

- If the user names a profile, use it.
- Otherwise inspect `$DSH_HOME/profiles/` and pick the one the user actually runs. On DSH
  Desktop this is usually **`desktop`**. Do not assume `web`.

Record this as `<PROFILE>` for the remaining steps.

## Step 2 — Install the package

```powershell
dsh plugin --profile <PROFILE> add github:lijiawei255/dsh-status-chime
```

If the user prefers a local copy (offline machine, or they want to modify it):

```powershell
git clone https://github.com/lijiawei255/dsh-status-chime
dsh plugin --profile <PROFILE> add .\dsh-status-chime
```

**Verify the install registered the bundle**, because this is where a silent failure
happens. Read `<PROFILE>/package.json` and confirm that:
- `dependencies` contains `dsh-status-chime`
- **`dsh.profile.bundles` also contains `dsh-status-chime`**

The second one is the important one: a package that is merely a dependency is *not* loaded
as a profile layer. If `dsh` printed

```
dsh: warning: dsh-status-chime declares no dsh.bundle — installed as a plain dependency, not a profile layer
```

then the package was read incorrectly (a truncated download, or a `package.json` that lost
its `dsh` block). Re-install rather than hand-editing files.

⚠️ **If you ever write `<PROFILE>/package.json` yourself, use UTF-8 without a BOM.**
DSH reads that file with `JSON.parse`. PowerShell 5.1's `Set-Content -Encoding UTF8` adds a
BOM, which makes DSH fail to start with `SyntaxError: Unexpected token ''`. Write it with:

```powershell
[IO.File]::WriteAllText($path, $json, (New-Object Text.UTF8Encoding($false)))
```

## Step 3 — Tell the user to restart, and mean it

**The plugin is not hot-loaded.** Editing or adding a plugin file does not take effect in a
running DSH Desktop. The user must **fully quit and reopen DSH Desktop**.

Do not report success before this restart happens. Say explicitly:

> Installation is done. Please fully quit and reopen DSH Desktop — the plugin only loads at
> startup. After restarting, run `/voice-alerts status` in the chat box; you should see
> `Voice alerts: on (v0.3.0)`.

Only the config file (`$DSH_HOME/voice-alerts.config.json`) is hot-read. The plugin code is
not.

## Step 4 — Verify after the restart

Ask the user what `/voice-alerts status` prints, or check the log.

Expected: `Voice alerts: on`, `Language: zh`, and `Scenes (8)` with every scene marked `on`
and none marked `(missing)`. The `Clip sets` line should show both languages complete:

```
Clip sets: zh (active): all clips present  |  en: all clips present
```

Both languages ship in the package, so nothing has to be downloaded. Chinese is the
default; switch with `/voice-alerts lang en` (written back to the config, so it sticks).

To let the user hear it immediately:

```
/voice-alerts
```

plays all eight clips in sequence, in the current language.

## Step 5 — Confirm it actually reaches the speakers

The clip can play while the user hears nothing. Before declaring success, ask them to
confirm they heard the eight clips. If they heard nothing, the most likely cause is the
**Windows volume mixer muting `ffplay` or `powershell.exe` individually** — see
[TROUBLESHOOTING.md](TROUBLESHOOTING.md).

Note also that **`ffplay` being absent from the log is not a fault.** ffplay ships with
ffmpeg, which is a separate install. Without it the plugin uses the PowerShell player that
ships with Windows, and everything still works.

---

## Optional — let the user hear the event-driven alerts right away

These produce a **real** event, not a test playback:

| To hear | Do this |
|---|---|
| `needs-input` | Ask the user a question with `ask_user_question`; the clip plays as the question is presented |
| `turn-done` | Any normal turn the user starts will end with this clip |
| `job-done` | Start any background job; the clip plays when it finishes |
| `goal-complete` / `goal-blocked` | Create a goal, then set its phase to `complete` or `blocked` |
| `turn-error` | Hard to provoke deliberately; see below |

**`turn-error`** only fires when a turn genuinely ends in `error` or `max-tokens`. Do not
break the user's setup to test it. If they want to see it, the safe route is to have them
switch the model to a provider that is unreachable from their current region for one
message, then switch back. Otherwise verify the audio alone with
`/voice-alerts test turn-error`.

**`job-failed`** cannot be triggered by a background shell command exiting non-zero; DSH
records that as `completed`. See the README's verification section.

---

## Uninstall

1. Remove the entry from `$DSH_HOME/profiles/<PROFILE>/cordis.patch.yml` if one was added
   by hand, or run `dsh plugin --profile <PROFILE> remove dsh-status-chime`.
2. Confirm `dsh-status-chime` is gone from both `dependencies` and `dsh.profile.bundles` in
   the profile's `package.json`.
3. Restart DSH Desktop.

`$DSH_HOME/voice-alerts/` (user-generated clips) and `$DSH_HOME/voice-alerts.config.json`
are not part of the package and can be left in place or deleted.

---

## Things not to do

- **Do not claim the plugin is installed before the user restarts DSH Desktop.** It is not
  active until then.
- **Do not edit files inside the DSH installation directory** (`resources/app`). Everything
  belongs under `$DSH_HOME`.
- **Do not add `ffplay`/`ffmpeg` as a requirement.** It is optional by design.
- **Do not hand-write `<PROFILE>/package.json` with a BOM** (see Step 2).
- **Do not report success on the log line alone.** Ask the user whether they heard it.
