/**
 * dsh-status-chime — spoken status alerts for DeepSeek Harness.
 *
 * WHY THIS EXISTS
 *   DSH's built-in desktop notifications use a flashing taskbar icon and a system
 *   toast. Both require you to be looking at the screen, which you often are not:
 *   long runs finish, background jobs end, and turns start waiting for an answer
 *   while you are somewhere else. This plugin speaks instead, so "I have to keep
 *   watching" becomes "I only have to be within earshot".
 *
 * EIGHT SCENES, WITH A DELIBERATE DURATION GRADIENT
 *   Long clip = something needs you. Short clip = something ended.
 *
 *   turn-error     7.97s  turn failed, or hit the token ceiling
 *   job-failed     5.95s  background job failed          (see VERIFICATION below)
 *   goal-blocked   4.78s  a goal is blocked and needs you
 *   approval       3.00s  an action is waiting for your approval
 *   job-done       2.59s  background job finished
 *   goal-complete  2.16s  the goal finished (fires once, not per round)
 *   needs-input    2.09s  the agent stopped to ask you something
 *   turn-done      1.58s  a turn you started finished normally
 *
 * TWO LANGUAGES, ONE PACKAGE
 *   Every scene ships in Chinese and English, selected with the `language`
 *   setting or `/voice-alerts lang <zh|en>`. Chinese is the default. The English
 *   lines are written for English rather than translated: a literal rendering of
 *   the Chinese runs long and flat in English, and the duration gradient above
 *   is the whole point, so the English set was rewritten to keep it. Durations
 *   for English run 1.92s -> 7.90s, monotonic in the same order as Chinese.
 *   What separates is the three urgency bands, not each clip from its neighbour:
 *   the step into the failed/blocked band is 38%, while clips inside a band sit
 *   close on purpose (goal-complete 2.16s against needs-input 2.09s, 0.07s, the
 *   same near-tie the Chinese set has). Length tells you the band.
 *   The default language keeps the bare `<scene>.mp3` filename; other languages
 *   use `<scene>.<code>.mp3`, so an existing install and any hand-placed user
 *   override keep working after upgrading.
 *
 * WHERE IT HOOKS
 *   Everything below is a public host-process event, and each one was checked
 *   against the DSH source rather than guessed.
 *
 *   `session/event` -> `turn/start` / `user/message` / `turn/end`
 *     Tracks whether the current turn was started by a human. `turn-done` only
 *     fires for human-initiated turns, so an autonomous goal that runs 20 rounds
 *     does not play the same clip 20 times. `turn-error` deliberately does NOT
 *     check the initiator: a failure during an autonomous round is exactly when
 *     you need to be told.
 *     The full set of `turn/end` reasons is:
 *       completed | aborted | blocked | error | max-tokens | interrupted
 *
 *   `session/event` -> `goal/change`
 *     Goal mutations are appended to the session event stream, which is why an
 *     ordinary session listener sees them (they are not delivered to an
 *     agent-scoped listener). The operation set is:
 *       create | edit | pause | resume | complete | block
 *     Only `complete` and `block` are spoken; the rest stay silent on purpose.
 *
 *   `ctx.jobs.events.subscribe({ owners: 'all' }, listener)` -> `settled`
 *     The job registry's commit stream. Only `settled` matters here, and of its
 *     two flags: `awaited` (some waiting caller already collected the result)
 *     and `cause: 'teardown'` (the owner is being destroyed, not the work
 *     ending) both stay silent. Status `completed` speaks, `failed` speaks,
 *     `killed` does not.
 *     The pre-0.1.7 API, `jobs.onJobDone(snapshot)`, is still honoured when the
 *     newer one is absent, so an older host keeps its job scenes. Both are
 *     probed at load time and whichever is found is logged.
 *     NOTE the framework limitation documented under VERIFICATION: a job
 *     snapshot carries no exit code, and the producer for background shell
 *     commands only ever settles `completed` or `killed`.
 *
 *   `tools/pre-execute` -> tool name present in `waitingTools`
 *     Means the agent is about to stop and wait for a human. This listener only
 *     observes; it always calls next().
 *
 *   `session/event` -> `approval/asked`
 *     Emitted whenever an approval request is raised under the `ask` policy, so
 *     it is the reliable "an action is waiting for you" signal. It cannot fire
 *     under the `never` policy — and under `never` nothing is waiting for you
 *     anyway.
 *
 *   `approval/request` (fallback) -> scoped waterfall, also only under `ask`.
 *     Kept as a second path because the waterfall is not guaranteed to reach a
 *     root-level listener; both paths play the same `approval` clip.
 *
 * REPLAY SAFETY
 *   `session/event` does not re-fire for a replayed, forked, or resumed session:
 *   dsh-session states that events entering through construction "were never
 *   published on the `session/event` firehose (constructor seeds do not emit)".
 *   Resuming a session therefore cannot replay alerts.
 *
 * VERIFICATION STATUS — please read before trusting a scene
 *   Verified by a real trigger (7 of 8):
 *     turn-done, turn-error, needs-input, job-done, goal-complete, goal-blocked,
 *     approval
 *       approval was heard on a real approval request, but which of its two paths
 *       delivered it is unresolved: `approval/asked` and `approval/request` play
 *       the same clip, so hearing it does not distinguish them.
 *   Written from the source but never observed firing:
 *     job-failed
 *       A background shell command that exits non-zero is recorded by DSH as
 *       `completed`: the status is `completed` unless the process was killed,
 *       `failed` is reserved for a background *tool* task that reports an error
 *       or for a producer contract violation. This is framework behaviour, not
 *       a bug in this plugin, and it is unchanged in DSH 0.1.7. What 0.1.7 does
 *       add is an observable one: `job.detail` now carries `exit code: N`, so
 *       the non-zero exits are visible in the log even though the status is not
 *       `failed`. That string is deliberately NOT parsed here — it is
 *       human-facing text, and making it a contract would break silently the
 *       next time it is reworded. The scene is kept because it does work for
 *       tool-task failures, but its trigger has not been reproduced here.
 *   Every clip can still be heard with `/voice-alerts test <scene>`, which
 *   exercises the audio path without needing the event to occur.
 *
 * PLAYBACK BACKEND — no third-party dependency on Windows 10/11
 *   On a clean Windows machine the guaranteed path is Windows PowerShell 5.1 +
 *   System.Media.SoundPlayer, both shipped with the OS. That player only accepts
 *   uncompressed PCM WAV, which is why every scene ships a .wav next to its .mp3.
 *   ffplay (from ffmpeg, NOT shipped with Windows) is used when present: it starts
 *   faster and supports an independent volume.
 *   The PowerShell path first tries `-File play.ps1`, which is auditable; if that
 *   exits non-zero, usually because a policy or ACL blocked the script file, it
 *   retries once with an `-EncodedCommand` payload that needs no file on disk.
 *   If nothing is available the plugin degrades silently to a single log line.
 *
 *   play.ps1 MUST stay pure ASCII. Windows PowerShell 5.1 reads .ps1 files as
 *   ANSI/GBK on CJK systems unless the file carries a UTF-8 BOM, so non-ASCII
 *   comments get mis-decoded and the playback call is silently swallowed.
 *
 * ASSET RESOLUTION (three levels, per file)
 *   1. `clipsDir` from the config, when set
 *   2. $DSH_HOME/voice-alerts/clips/     — your own generated overrides
 *   3. <package>/assets/clips/           — the shipped defaults
 *   Resolution is per file, so replacing one scene only requires that one file.
 *
 * CONFIG
 *   $DSH_HOME/voice-alerts.config.json, hot-read by mtime.
 *   The legacy location $DSH_HOME/voice-alerts/voice-alerts.config.json is still
 *   honoured so an existing single-file install keeps working.
 *
 * FAIL-SAFE
 *   Every listener and every playback swallows its own errors. A missing clip or
 *   a missing player can never break a turn.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'voice-alerts';

/** Every service is injected optionally, so a missing one only removes an event source. */
export const inject = [];

/** Logged at startup, so you can confirm which code on disk actually loaded. */
const VERSION = '0.4.0';

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh');
const USER_DIR = join(DSH_HOME, 'voice-alerts');
const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url));
/** Shipped defaults, resolved relative to this file rather than to the process cwd. */
const PACKAGE_ASSETS = join(PLUGIN_DIR, '..', 'assets');

const CONFIG_CANDIDATES = [
  join(DSH_HOME, 'voice-alerts.config.json'),
  join(USER_DIR, 'voice-alerts.config.json'),
];

/**
 * Scene table. A larger `priority` wins: within one coalescing window only the
 * highest-priority scene is spoken, and a higher-priority alert interrupts one
 * already playing.
 *
 * Kept in descending priority order. Nothing reads the order — priority is
 * explicit and every consumer sorts or filters by it — but `Object.keys()` does
 * drive the order scenes are listed in the "unknown scene" error, so a table that
 * is not in priority order reads as a mistake and invites a real one.
 */
const SCENES = {
  'turn-error': { priority: 50, label: 'turn failed' },
  'goal-blocked': { priority: 45, label: 'goal blocked' },
  'job-failed': { priority: 40, label: 'job failed' },
  'approval': { priority: 35, label: 'approval waiting' },
  'needs-input': { priority: 30, label: 'waiting for you' },
  'goal-complete': { priority: 25, label: 'goal complete' },
  'job-done': { priority: 20, label: 'job finished' },
  'turn-done': { priority: 10, label: 'turn finished' },
};

/**
 * Order used by the bare `/voice-alerts` command: shortest clip first, so a
 * preview starts with the routine ones and ends on the longest, most alarming
 * one. Keep this list sorted by duration — `approval` (3.00s) sits after
 * `job-done` (2.59s) for that reason, not because of its priority.
 */
const PREVIEW_ORDER = [
  'turn-done', 'needs-input', 'goal-complete', 'job-done',
  'approval', 'goal-blocked', 'job-failed', 'turn-error',
];

/** Tool names that mean the agent is about to wait for a human. */
const DEFAULT_WAITING_TOOLS = ['ask_user_question', 'exit_plan_mode'];

/**
 * Languages the shipped clips cover.
 *
 * The default language keeps the bare `<scene>.mp3` name so that an existing
 * install, and any hand-placed override in the user clips directory, keeps
 * working untouched. Every other language gets a `.<code>` infix.
 */
const LANGUAGES = ['zh', 'en'];
const DEFAULT_LANGUAGE = 'zh';

/**
 * The configured language, or the default when the value is missing or unknown.
 *
 * Deliberately forgiving: an unrecognised code must not silence the plugin, so
 * it falls back to the default rather than resolving no clips at all.
 */
function currentLanguage(config) {
  const value = typeof config.language === 'string' ? config.language.trim().toLowerCase() : '';
  return LANGUAGES.includes(value) ? value : DEFAULT_LANGUAGE;
}

/** Filename stem for a scene in a language. */
function clipBaseName(scene, language) {
  return language === DEFAULT_LANGUAGE ? scene : `${scene}.${language}`;
}

const DEFAULTS = {
  enabled: true,
  commandName: 'voice-alerts',
  player: 'auto',
  ffplayPath: null,
  playPs1Path: null,
  clipsDir: null,
  volume: 85,
  minIntervalMs: 1500,
  coalesceMs: 400,
  interrupt: true,
  watchApprovals: true,
  language: DEFAULT_LANGUAGE,
  waitingTools: DEFAULT_WAITING_TOOLS,
  scenes: Object.fromEntries(Object.keys(SCENES).map((key) => [key, { enabled: true }])),
};

/** The one playing child; a single clip plays at a time. */
let activeChild = null;
let activeScene = null;

/**
 * Children WE killed, so their exit is not mistaken for a play.ps1 failure.
 *
 * A process killed on purpose reports `code === null`, which is neither 0 nor 2, so the
 * retry handler in `spawnViaPowershell` used to treat an interrupted clip as a broken
 * play.ps1 and replay it through the inline path. That undermined `interrupt`: the new,
 * higher-priority alert was cut in, and the old one immediately came back underneath it.
 * The same applied on unload, where `stop()` would kill a clip and then respawn it.
 */
const deliberatelyKilled = new WeakSet();

/** Kill a child we own, recording that the exit is expected. */
function killChild(child) {
  if (child === null) return;
  deliberatelyKilled.add(child);
  try {
    child.kill();
  } catch {
    /* already gone */
  }
}

/** Keys already warned about, so a broken setup cannot flood the log. */
const warned = new Set();

function warnOnce(ctx, key, message) {
  if (warned.has(key)) return;
  warned.add(key);
  ctx.logger?.warn?.(`[${name}] ${message}`);
}

// ── config ────────────────────────────────────────────────────────────────
let configCache = { path: null, at: 0, value: null };

/** Prefer the current location, fall back to the legacy one. */
function configPath() {
  for (const candidate of CONFIG_CANDIDATES) if (existsSync(candidate)) return candidate;
  return CONFIG_CANDIDATES[0];
}

function loadConfig(ctx) {
  const path = configPath();
  try {
    if (!existsSync(path)) return { ...DEFAULTS };
    const stamp = statSync(path).mtimeMs;
    if (configCache.value !== null && configCache.path === path && configCache.at === stamp) {
      return configCache.value;
    }
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const value = {
      ...DEFAULTS,
      ...raw,
      scenes: { ...DEFAULTS.scenes, ...(raw.scenes ?? {}) },
      waitingTools: Array.isArray(raw.waitingTools) && raw.waitingTools.length > 0
        ? raw.waitingTools.filter((tool) => typeof tool === 'string')
        : DEFAULT_WAITING_TOOLS,
    };
    configCache = { path, at: stamp, value };
    return value;
  } catch (error) {
    warnOnce(ctx, 'config', `could not parse the config, using defaults: ${String(error)}`);
    return { ...DEFAULTS };
  }
}

function writeConfig(patch) {
  const path = configPath();
  let current = {};
  try {
    if (existsSync(path)) current = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    current = {};
  }
  const next = { ...current, ...patch };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  configCache = { path: null, at: 0, value: null };
  return next;
}

// ── asset resolution ──────────────────────────────────────────────────────
function clipCandidates(config, scene, extension, language = currentLanguage(config)) {
  const file = `${clipBaseName(scene, language)}.${extension}`;
  const list = [];
  if (typeof config.clipsDir === 'string' && config.clipsDir) {
    list.push(join(config.clipsDir, file));
  }
  list.push(join(USER_DIR, 'clips', file));
  list.push(join(PACKAGE_ASSETS, 'clips', file));
  return list;
}

/** First existing candidate wins; null when the clip is nowhere to be found. */
function resolveClip(config, scene, extension, language = currentLanguage(config)) {
  for (const candidate of clipCandidates(config, scene, extension, language)) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Which level a resolved clip came from — for the log line, and for the tests.
 *
 * The position in the candidate list is the only reliable way to say which copy
 * won. Saying it is what makes "a user-level file takes precedence over the
 * packaged one" a checkable claim; before this, that claim was asserted by a
 * probe that re-implemented the search itself and therefore passed no matter
 * what the plugin actually did.
 */
function clipSource(config, scene, extension, language, file) {
  const hasClipsDir = typeof config.clipsDir === 'string' && config.clipsDir.length > 0;
  const names = hasClipsDir ? ['clipsDir', 'user', 'package'] : ['user', 'package'];
  const index = clipCandidates(config, scene, extension, language).indexOf(file);
  return index >= 0 ? names[index] : 'unknown';
}

function resolvePlayPs1(config) {
  const list = [];
  if (typeof config.playPs1Path === 'string' && config.playPs1Path) list.push(config.playPs1Path);
  list.push(join(USER_DIR, 'play.ps1'));
  list.push(join(PACKAGE_ASSETS, 'play.ps1'));
  for (const candidate of list) if (existsSync(candidate)) return candidate;
  return null;
}

// ── playback backend ──────────────────────────────────────────────────────
let playerCache = null;

function powershellPath() {
  const root = process.env.SystemRoot;
  if (root) {
    const full = join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (existsSync(full)) return full;
  }
  return 'powershell.exe';
}

/**
 * Probe once and cache. ffplay is the optional upgrade; Windows PowerShell is the
 * baseline that ships with the OS.
 */
function resolvePlayer(ctx, config) {
  if (playerCache !== null && config.player === playerCache.configured) return playerCache;
  const configured = config.player;

  if (configured !== 'powershell') {
    const exe = typeof config.ffplayPath === 'string' && config.ffplayPath ? config.ffplayPath : 'ffplay';
    const probe = spawnSync(exe, ['-version'], { windowsHide: true, timeout: 5000, stdio: 'ignore' });
    if (!probe.error && probe.status === 0) {
      playerCache = { kind: 'ffplay', exe, configured };
      return playerCache;
    }
    if (configured === 'ffplay') {
      warnOnce(ctx, 'ffplay-missing', `ffplay was requested but did not respond (${exe}); nothing will play.`);
      playerCache = { kind: 'none', configured };
      return playerCache;
    }
  }

  const shell = powershellPath();
  if (shell === 'powershell.exe' || existsSync(shell)) {
    playerCache = { kind: 'powershell', exe: shell, configured };
    return playerCache;
  }

  warnOnce(ctx, 'no-player', 'neither ffplay nor Windows PowerShell is available; alerts will stay silent.');
  playerCache = { kind: 'none', configured };
  return playerCache;
}

/** Remember the child, and clear it as soon as it settles. */
function trackChild(ctx, child, scene) {
  activeChild = child;
  activeScene = scene;
  child.on('error', (error) => {
    warnOnce(ctx, `player-error:${scene}`, `player process failed (${scene}): ${String(error)}`);
  });
  const clear = () => {
    if (activeChild === child) {
      activeChild = null;
      activeScene = null;
    }
  };
  child.on('exit', clear);
  child.on('close', clear);
  child.unref();
  return child;
}

function spawnQuiet(ctx, exe, argv, env, scene) {
  try {
    // An argument array, never a shell string: paths with spaces or brackets are safe.
    const child = spawn(exe, argv, { stdio: 'ignore', windowsHide: true, env: env ?? process.env });
    return trackChild(ctx, child, scene);
  } catch (error) {
    warnOnce(ctx, `spawn:${scene}`, `could not start the player (${scene}): ${String(error)}`);
    return null;
  }
}

/**
 * PowerShell fallback.
 *   Try `-File play.ps1` first, because a file on disk can be audited.
 *   If it exits non-zero, usually an execution-policy or ACL block, retry once
 *   with `-EncodedCommand`, which is self-contained and reads no script file.
 *   The clip path travels through the environment to avoid any quoting problem.
 */
function spawnViaPowershell(ctx, config, shell, file, scene) {
  const env = { ...process.env, VOICE_ALERTS_CLIP: file };
  const encoded = () => Buffer.from(
    '$p = New-Object System.Media.SoundPlayer $env:VOICE_ALERTS_CLIP; $p.PlaySync()',
    'utf16le',
  ).toString('base64');

  const spawnEncoded = () => spawnQuiet(
    ctx, shell,
    ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded()],
    env, scene,
  );

  const ps1 = resolvePlayPs1(config);
  if (ps1 === null) return spawnEncoded();

  const child = spawnQuiet(
    ctx, shell,
    ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', ps1, file],
    env, scene,
  );
  if (child === null) return null;
  child.once('exit', (code) => {
    // 2 means the file was missing (already checked above); 0 means it played.
    if (code === 0 || code === 2) return;
    // We killed this one ourselves: an interrupted clip must NOT be restarted, or
    // `interrupt` would be defeated by its own fallback (see `deliberatelyKilled`).
    if (deliberatelyKilled.has(child)) return;
    warnOnce(ctx, 'ps-file-fallback', `play.ps1 exited with code ${code}; retrying once with -EncodedCommand.`);
    spawnEncoded();
  });
  return child;
}

/**
 * Start one clip.
 * @returns the child process, or null when nothing can be played.
 *
 * `resolved`, when passed, receives the file name that was actually chosen and
 * the backend that will play it. Callers put both in the log line, which is what
 * makes "which file did it pick?" answerable from the log — and testable. Only the
 * BASE name is recorded: the full path would write the user's home directory into
 * every playback line.
 */
function spawnPlayer(ctx, config, scene, interrupt, resolved = null) {
  const player = resolvePlayer(ctx, config);
  if (player.kind === 'none') return null;

  // ffplay plays mp3; SoundPlayer only accepts uncompressed PCM WAV.
  const extension = player.kind === 'ffplay' ? 'mp3' : 'wav';
  const file = resolveClip(config, scene, extension);
  if (file === null) {
    const language = currentLanguage(config);
    warnOnce(
      ctx,
      `clip-missing:${scene}:${language}`,
      `no ${language} audio for ${scene}; looked in: ${clipCandidates(config, scene, extension).join(' | ')}`,
    );
    return null;
  }
  if (resolved !== null) {
    resolved.file = basename(file);
    resolved.backend = player.kind;
    resolved.source = clipSource(config, scene, extension, currentLanguage(config), file);
  }

  if (activeChild !== null) {
    if (!interrupt) return null;
    killChild(activeChild);
    activeChild = null;
  }

  if (player.kind === 'ffplay') {
    return spawnQuiet(
      ctx, player.exe,
      ['-nodisp', '-autoexit', '-loglevel', 'quiet', '-volume', String(config.volume), '-i', file],
      null, scene,
    );
  }
  return spawnViaPowershell(ctx, config, player.exe, file, scene);
}

function stopPlayback() {
  if (activeChild === null) return;
  killChild(activeChild);
  activeChild = null;
  activeScene = null;
}

// ── coalescing, throttling, priority ──────────────────────────────────────

/**
 * The bracket suffix carried by every play log line: which file was chosen, which
 * backend will play it, which resolution level it came from, and — for ffplay, the only
 * backend that takes one — the configured volume.
 *
 * The volume is included because it is otherwise unobservable: it is passed straight into
 * the ffplay argument list, so "did the configured volume actually reach the player?"
 * could not be answered from outside. On the PowerShell path there is nothing to report,
 * since that player follows the system volume.
 */
function playDetail(config, resolved) {
  const volume = resolved.backend === 'ffplay' ? `, vol ${config.volume}` : '';
  return `${resolved.file} via ${resolved.backend} from ${resolved.source}${volume}`;
}

function createDispatcher(ctx) {
  const pending = new Set();
  let timer = null;
  const lastPlayedAt = new Map();

  const flush = () => {
    timer = null;
    const config = loadConfig(ctx);
    if (!config.enabled) {
      pending.clear();
      return;
    }
    const chosen = [...pending]
      .filter((scene) => config.scenes?.[scene]?.enabled !== false)
      .sort((a, b) => (SCENES[b]?.priority ?? 0) - (SCENES[a]?.priority ?? 0))[0];
    pending.clear();
    if (chosen === undefined) return;

    const now = Date.now();
    const last = lastPlayedAt.get(chosen) ?? 0;
    if (now - last < config.minIntervalMs) {
      ctx.logger?.info?.(`[${name}] throttled ${chosen} (${now - last}ms < ${config.minIntervalMs}ms)`);
      return;
    }
    lastPlayedAt.set(chosen, now);
    const resolved = {};
    if (spawnPlayer(ctx, config, chosen, config.interrupt !== false, resolved) !== null) {
      ctx.logger?.info?.(`[${name}] playing ${chosen} (${SCENES[chosen]?.label ?? ''}) [${playDetail(config, resolved)}]`);
    }
  };

  return {
    /** Record one event; after the coalescing window only the top scene plays. */
    emit(scene) {
      if (!SCENES[scene]) return;
      pending.add(scene);
      if (timer !== null) return;
      const config = loadConfig(ctx);
      timer = setTimeout(flush, Math.max(0, config.coalesceMs));
      timer.unref?.();
    },
    /** Play one scene immediately, bypassing coalescing and throttling. */
    playDirect(scene, interrupt = true) {
      const config = loadConfig(ctx);
      if (!config.enabled) {
        ctx.logger?.info?.(`[${name}] disabled, skipped ${scene}`);
        return null;
      }
      const resolved = {};
      const child = spawnPlayer(ctx, config, scene, interrupt, resolved);
      // Logged too: otherwise "test produced no sound" cannot be told apart from
      // "nothing was played" when reading the log. The file name and backend are
      // included so the log answers "which file did it actually pick?".
      if (child !== null) ctx.logger?.info?.(`[${name}] playing ${scene} (${SCENES[scene]?.label ?? ''}, manual) [${playDetail(config, resolved)}]`);
      return child;
    },
    stop: stopPlayback,
  };
}

/** Play scenes back to back by chaining on exit, without blocking the caller. */
function playSequence(dispatcher, scenes) {
  const next = (index) => {
    if (index >= scenes.length) return;
    const child = dispatcher.playDirect(scenes[index], true);
    if (child !== null) {
      child.once('exit', () => setTimeout(() => next(index + 1), 350));
      child.once('error', () => next(index + 1));
      return;
    }
    setTimeout(() => next(index + 1), 150);
  };
  next(0);
}

// ── event wiring ──────────────────────────────────────────────────────────
function trackSessions(ctx, dispatcher) {
  ctx.inject(['sessions'], (sessionsCtx) => {
    sessionsCtx.effect(() => {
      /** sessionId -> { turn, userInitiated } */
      const openTurns = new Map();

      const onEvent = (session, event) => {
        try {
          if (session?.header?.origin === 'subagent') return;
          const sessionId = String(session?.header?.id ?? '');

          // Goal mutations arrive on the session stream; see the header comment
          // for why an agent-scoped listener would miss them.
          if (event.type === 'goal/change') {
            const operation = event.data?.operation;
            if (operation === 'complete') dispatcher.emit('goal-complete');
            else if (operation === 'block') dispatcher.emit('goal-blocked');
            return;
          }

          // An approval request under the `ask` policy is written to the session
          // stream as `approval/asked`. This is the reliable signal: it is emitted
          // whenever the policy is `ask`, regardless of which approval scope the
          // request came from, so a root-level listener always sees it.
          if (event.type === 'approval/asked') {
            if (loadConfig(ctx).watchApprovals !== false) dispatcher.emit('approval');
            return;
          }

          if (event.type === 'turn/start') {
            openTurns.set(sessionId, { turn: event.data?.turn, userInitiated: false });
            return;
          }
          if (event.type === 'user/message') {
            const open = openTurns.get(sessionId);
            if (open !== undefined && event.data?.source?.kind === 'user') open.userInitiated = true;
            return;
          }
          if (event.type !== 'turn/end') return;

          const open = openTurns.get(sessionId);
          if (open === undefined || open.turn !== event.data?.turn) return;
          openTurns.delete(sessionId);

          const kind = event.data?.reason?.kind;
          if (kind === 'error' || kind === 'max-tokens') {
            // Failure does not check the initiator: an autonomous round that dies
            // is exactly what you need to hear about.
            dispatcher.emit('turn-error');
          } else if (kind === 'completed' && open.userInitiated) {
            // Completion only speaks for human-initiated turns.
            dispatcher.emit('turn-done');
          }
        } catch (error) {
          ctx.logger?.warn?.(`[${name}] session event handler failed: ${String(error)}`);
        }
      };

      const stopEvents = sessionsCtx.on('session/event', onEvent);
      const stopDisposed = sessionsCtx.on('session/disposed', (session) => {
        openTurns.delete(String(session?.header?.id ?? ''));
      });
      return () => {
        stopDisposed();
        stopEvents();
      };
    }, 'voice-alerts: session turn and goal tracking');
  });
}

/**
 * Background-job alerts.
 *
 * Two host APIs, one behaviour, because this plugin is installed on hosts of
 * different ages:
 *
 *   DSH >= 0.1.7  `ctx.jobs.events.subscribe({ owners: 'all' }, listener)`
 *                 The job registry's commit stream. `settled` is the only type
 *                 that matters; `registered`, `progress`, `stopping`, `output`
 *                 and `removed` are ignored. Two of `settled`'s fields also
 *                 suppress the alert, both mirroring what the host's own job
 *                 reporter does: `awaited` means a waiting caller already
 *                 collected the result, and `cause: 'teardown'` means the job's
 *                 owner is being destroyed rather than the work ending.
 *
 *   DSH <= 0.1.6  `ctx.jobs.onJobDone(snapshot)` — removed in 0.1.7.
 *
 * The newer API is preferred, so a host carrying both is read once, through the
 * stream. Whichever one is found is logged, because "which API is this build
 * actually using?" is otherwise unanswerable from outside — and when neither is
 * present the plugin says so once instead of failing silently.
 */
function trackJobs(ctx, dispatcher) {
  ctx.inject(['jobs'], (jobsCtx) => {
    jobsCtx.effect(() => {
      const events = jobsCtx.jobs?.events;

      if (typeof events?.subscribe === 'function') {
        const unsubscribe = events.subscribe({ owners: 'all' }, (event) => {
          try {
            if (event?.type !== 'settled') return;
            // A caller already collected this settlement; the host's own notice
            // skips it for the same reason (see @deepseek-ai/dsh-tool-jobs).
            if (event.awaited === true) return;
            // The owner is being torn down — a session archived, or the host
            // itself going away. Nothing ended that you would want to hear about.
            if (event.cause === 'teardown') return;
            // See VERIFICATION in the header: a non-zero shell exit still
            // settles `completed`, because a job view carries no exit code.
            const status = event.job?.status;
            if (status === 'completed') dispatcher.emit('job-done');
            else if (status === 'failed') dispatcher.emit('job-failed');
          } catch (error) {
            ctx.logger?.warn?.(`[${name}] job event handler failed: ${String(error)}`);
          }
        });
        ctx.logger?.info?.(`[${name}] jobs: listening on the settled stream ({ owners: 'all' })`);
        // The subscription is an effect of the jobs service's context; returning
        // its disposer keeps the plugin's own teardown honest.
        return () => unsubscribe();
      }

      if (typeof jobsCtx.jobs?.onJobDone === 'function') {
        jobsCtx.jobs.onJobDone((snapshot) => {
          try {
            if (snapshot?.status === 'completed') dispatcher.emit('job-done');
            else if (snapshot?.status === 'failed') dispatcher.emit('job-failed');
          } catch (error) {
            ctx.logger?.warn?.(`[${name}] job event handler failed: ${String(error)}`);
          }
        });
        warnOnce(ctx, 'jobs-legacy', 'this dsh exposes only jobs.onJobDone (the pre-0.1.7 API); job alerts still work');
        return () => {};
      }

      warnOnce(ctx, 'jobs-none', 'neither jobs.events.subscribe nor jobs.onJobDone exists on this dsh; job alerts are disabled');
      return () => {};
    }, 'voice-alerts: background job alerts');
  });
}

function trackToolGates(ctx, dispatcher) {
  ctx.on('tools/pre-execute', (exec, next) => {
    try {
      const config = loadConfig(ctx);
      const waiting = new Set(config.waitingTools ?? DEFAULT_WAITING_TOOLS);
      if (waiting.has(exec?.name)) {
        // A subagent has no human answerer, so it should stay quiet.
        if (exec?.agent?.session?.header?.origin !== 'subagent') dispatcher.emit('needs-input');
      }
    } catch (error) {
      ctx.logger?.warn?.(`[${name}] tool gate observer failed: ${String(error)}`);
    }
    return next();
  });

  // Fallback only: the primary signal is the `approval/asked` session event
  // handled in trackSessions. This scoped waterfall fires under the `ask` policy
  // too, but it is not guaranteed to reach a root-level listener.
  ctx.on('approval/request', (request, next) => {
    try {
      if (loadConfig(ctx).watchApprovals === true && request?.agent?.session?.header?.origin !== 'subagent') {
        dispatcher.emit('approval');
      }
    } catch (error) {
      ctx.logger?.warn?.(`[${name}] approval observer failed: ${String(error)}`);
    }
    return next();
  });
}

// ── slash command ─────────────────────────────────────────────────────────
function statusText(ctx, config) {
  const player = resolvePlayer(ctx, config);
  const playerText = player.kind === 'ffplay'
    ? `ffplay (${player.exe}, volume ${config.volume})`
    : player.kind === 'powershell'
      ? `PowerShell SoundPlayer (${player.exe}; volume follows the system)`
      : 'unavailable (no sound possible)';
  const ps1 = resolvePlayPs1(config);
  const extension = player.kind === 'ffplay' ? 'mp3' : 'wav';
  const language = currentLanguage(config);
  const clipLines = Object.keys(SCENES).map((scene) => {
    const found = resolveClip(config, scene, extension);
    return `${scene}=${config.scenes?.[scene]?.enabled === false ? 'off' : 'on'}${found === null ? ' (missing)' : ''}`;
  });
  // Report every language, not just the active one: "the English clips are
  // missing" is the useful thing to see when English is what you asked for.
  const languageLines = LANGUAGES.map((code) => {
    const missing = Object.keys(SCENES).filter((scene) => resolveClip(config, scene, extension, code) === null);
    return `${code}${code === language ? ' (active)' : ''}: ${missing.length === 0 ? 'all clips present' : `missing ${missing.join(', ')}`}`;
  });
  return [
    `Voice alerts: ${config.enabled ? 'on' : 'off'} (v${VERSION})`,
    `Language: ${language}`,
    `Player: ${playerText}`,
    `Fallback script: ${ps1 ?? 'not found; using an inline -EncodedCommand instead'}`,
    `Coalescing ${config.coalesceMs}ms, per-scene throttle ${config.minIntervalMs}ms, interrupt ${config.interrupt !== false ? 'on' : 'off'}`,
    `Waiting-for-you tools: ${(config.waitingTools ?? DEFAULT_WAITING_TOOLS).join(', ')}`,
    `Approval listener: ${config.watchApprovals === true ? 'on' : 'off'}`,
    `Clip sets: ${languageLines.join('  |  ')}`,
    `Scenes (${Object.keys(SCENES).length}): ${clipLines.join('  ')}`,
    `Usage: /${config.commandName ?? 'voice-alerts'} [on|off|status|lang <zh|en>|test <scene>]`,
  ].join('\n');
}

function registerCommand(ctx, dispatcher) {
  ctx.inject(['commands'], (commandsCtx) => {
    const loaded = loadConfig(ctx);
    const commandName = typeof loaded.commandName === 'string' && loaded.commandName
      ? loaded.commandName
      : 'voice-alerts';
    try {
      commandsCtx.effect(() => commandsCtx.commands.register({
        name: commandName,
        description: `Voice alert control: /${commandName} to preview all, on|off to toggle, lang <zh|en>, test <scene>, status`,
        // Declaring `input` is what makes arguments reachable at all. The command
        // UI's decision table only claims a line whose first token is the bare
        // command name; for a command WITHOUT this field it returns undefined the
        // moment a space appears, and the line is submitted as an ordinary message
        // instead. So omitting this silently restricted the plugin to the bare
        // preview and made on/off/status/test/lang impossible to type.
        input: { hint: `on | off | status | test <scene> | lang <${LANGUAGES.join('|')}> — leave empty to preview every alert` },
        handler: (invocation) => {
          try {
            const input = String(invocation?.rawInput ?? '').trim();
            const [verb, ...rest] = input.split(/\s+/).filter(Boolean);
            const current = loadConfig(ctx);

            if (verb === undefined) {
              playSequence(dispatcher, PREVIEW_ORDER.filter((scene) => current.scenes?.[scene]?.enabled !== false));
              return Promise.resolve({
                kind: 'success',
                text: `Playing all ${PREVIEW_ORDER.length} alerts in sequence.\n${statusText(ctx, current)}`,
              });
            }
            if (verb === 'on' || verb === 'off') {
              writeConfig({ enabled: verb === 'on' });
              if (verb === 'off') dispatcher.stop();
              return Promise.resolve({ kind: 'success', text: `Voice alerts turned ${verb}.` });
            }
            if (verb === 'status') {
              return Promise.resolve({ kind: 'success', text: statusText(ctx, current) });
            }
            if (verb === 'lang' || verb === 'language') {
              const raw = rest[0] ?? '';
              // The help text spells this `lang <zh|en>`, where the angle brackets only
              // mark a placeholder — but people copy them along, and then `<en>` gets
              // rejected as an unknown language. Strip a wrapping pair of brackets or
              // quotes before judging. Anything still unrecognised is refused exactly
              // as before, so this stays a tolerance and not a fuzzy match.
              const requested = raw.replace(/^[<\s"'\[]+|[>\s"'\]]+$/g, '').toLowerCase();
              if (rest.length === 0) {
                return Promise.resolve({
                  kind: 'success',
                  text: `Language: ${currentLanguage(current)}. Available: ${LANGUAGES.join(' / ')}.`
                    + `\nSwitch with /${commandName} lang <${LANGUAGES.join('|')}>`,
                });
              }
              if (!LANGUAGES.includes(requested)) {
                const hint = /[<>]/.test(raw)
                  ? '\n(The angle brackets are placeholder notation only - write the language code itself, e.g. lang en.)'
                  : '';
                return Promise.resolve({
                  kind: 'error',
                  text: `Unknown language "${raw}". Available: ${LANGUAGES.join(' / ')}${hint}`,
                });
              }
              // Warn rather than refuse when the clips are absent: the setting is
              // still valid, and the user may be about to drop the files in.
              const extension = resolvePlayer(ctx, current).kind === 'ffplay' ? 'mp3' : 'wav';
              const missing = Object.keys(SCENES)
                .filter((scene) => resolveClip(current, scene, extension, requested) === null);
              writeConfig({ language: requested });
              const note = missing.length === 0
                ? ''
                : `\nWarning: no ${requested} audio for ${missing.join(', ')}; those scenes will stay silent.`;
              return Promise.resolve({
                kind: 'success',
                text: `Language set to ${requested}.${note}`,
              });
            }
            if (verb === 'test') {
              const scene = rest[0];
              if (scene === undefined || !SCENES[scene]) {
                return Promise.resolve({
                  kind: 'error',
                  text: `Unknown scene "${scene ?? ''}". Available: ${Object.keys(SCENES).join(' / ')}`,
                });
              }
              const child = dispatcher.playDirect(scene);
              return Promise.resolve({
                kind: child === null ? 'error' : 'success',
                text: child === null
                  ? `Could not play ${scene}: the clip is missing, alerts are off, or no player is available.`
                  : `Playing ${scene} (${SCENES[scene].label}).`,
              });
            }
            return Promise.resolve({
              kind: 'error',
              text: `Usage: /${commandName} (preview all) | /${commandName} on|off | /${commandName} status | /${commandName} lang <${LANGUAGES.join('|')}> | /${commandName} test <scene>`,
            });
          } catch (error) {
            return Promise.resolve({ kind: 'error', text: `voice-alerts command failed: ${String(error)}` });
          }
        },
      }), 'voice-alerts: slash command');
    } catch (error) {
      // A name collision must not take the whole plugin down; only the control
      // surface is lost.
      ctx.logger?.warn?.(
        `[${name}] could not register /${commandName} (likely taken by another plugin); the rest of the plugin still works: ${String(error)}`,
      );
    }
  });
}

// ── entry point ───────────────────────────────────────────────────────────
export function apply(ctx) {
  let config;
  try {
    config = loadConfig(ctx);
  } catch (error) {
    ctx.logger?.warn?.(`[${name}] could not read the config, plugin stopped: ${String(error)}`);
    return;
  }

  const dispatcher = createDispatcher(ctx);
  const player = resolvePlayer(ctx, config);

  let voice = '(not recorded)';
  try {
    // Prefer the user's own clips.json when one exists, since that is the file
    // whose voice actually produced the audio being played; fall back to the
    // packaged copy, which is all a fresh install has.
    const clipsPath = [join(USER_DIR, 'clips.json'), join(PACKAGE_ASSETS, 'clips.json')]
      .find((candidate) => existsSync(candidate));
    const clips = clipsPath === undefined
      ? null
      : JSON.parse(readFileSync(clipsPath, 'utf8'));
    if (clips?.model && clips?.voice) voice = `${clips.model} / ${clips.voice}`;
  } catch {
    /* a missing clips.json does not affect playback */
  }

  ctx.logger?.info?.(
    `[${name}] active v${VERSION} — ${config.enabled ? 'on' : 'off'}; voice ${voice}; ` +
    `player ${player.kind}${player.kind === 'ffplay' || player.kind === 'powershell' ? `(${player.exe})` : ''}; ` +
    `${Object.keys(SCENES).length} scenes; config ${configPath()}`,
  );

  trackSessions(ctx, dispatcher);
  trackJobs(ctx, dispatcher);
  trackToolGates(ctx, dispatcher);
  registerCommand(ctx, dispatcher);

  // Release the player on unload so no orphan process is left behind.
  // (cordis has no 'dispose' event; cleanup belongs on ctx.effect's disposer.)
  //
  // The log line is not decoration: without it there is no way to tell from outside
  // whether the disposer ran at all, which is exactly what the offline suite asserts.
  ctx.effect(() => () => {
    try {
      dispatcher.stop();
      ctx.logger?.info?.(`[${name}] released the player on unload`);
    } catch {
      /* ignore */
    }
  }, 'voice-alerts: release the player process');
}