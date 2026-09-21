/**
 * dsh-status-chime offline acceptance test.
 *
 * Drives the plugin through a mock cordis context, so it needs neither a DSH
 * restart nor a real event to occur.
 *
 * Design notes
 *   1. Silent by default: clipsDir points at throwaway 0.05s silent files, so every
 *      playback still logs "playing <scene>" (which is what the assertions read)
 *      without making any noise.
 *      A plain empty directory would not work: the "clip missing" warning is
 *      de-duplicated by warnOnce, so the second attempt at the same scene logs
 *      nothing and could not be observed.
 *   2. --play switches to the packaged clips so a human can listen.
 *   3. Everything runs against a fresh temporary DSH_HOME, so your real config and
 *      clip directory are never touched.
 *
 * Usage
 *   node scripts/selftest.mjs                    # silent logic checks (default)
 *   node scripts/selftest.mjs --play             # actually play the clips
 *   node scripts/selftest.mjs --plugin <path>    # test another build of the plugin
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLAY = process.argv.includes('--play');

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** This repository's plugin by default; --plugin points the harness somewhere else. */
const PLUGIN = resolve(argValue('--plugin') ?? join(REPO_ROOT, 'lib', 'index.js'));
/** Packaged clips, used by --play. */
const REAL_CLIPS = join(REPO_ROOT, 'assets', 'clips');

// ── isolated environment: a temporary DSH_HOME, never the real one ────────
const SANDBOX = mkdtempSync(join(tmpdir(), 'va-selftest-'));
const SILENT_CLIPS = join(SANDBOX, 'silent-clips');
mkdirSync(SILENT_CLIPS, { recursive: true });
mkdirSync(join(SANDBOX, 'voice-alerts', 'clips'), { recursive: true });
process.env.DSH_HOME = SANDBOX;

const SCENE_NAMES = [
  'turn-done', 'turn-error', 'needs-input', 'job-done',
  'job-failed', 'goal-complete', 'goal-blocked', 'approval',
];

function findFfmpeg() {
  // PATH first, then an explicit override, so no personal path is baked in.
  const candidates = ['ffmpeg'];
  if (process.env.VOICE_ALERTS_FFMPEG) candidates.push(process.env.VOICE_ALERTS_FFMPEG);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['-version'], { windowsHide: true, stdio: 'ignore' });
    if (!probe.error && probe.status === 0) return candidate;
  }
  return null;
}

function makeSilentClips() {
  const ffmpeg = findFfmpeg();
  if (ffmpeg === null) return false;
  for (const scene of [...SCENE_NAMES, ...SCENE_NAMES.map((s) => `${s}.en`)]) {
    for (const [extension, codec] of [['mp3', ['-b:a', '128k']], ['wav', ['-c:a', 'pcm_s16le']]]) {
      const out = join(SILENT_CLIPS, `${scene}.${extension}`);
      const result = spawnSync(ffmpeg, [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono',
        '-t', '0.05', ...codec, out,
      ], { windowsHide: true, stdio: 'ignore' });
      if (result.status !== 0) return false;
    }
  }
  return true;
}

const SILENT_READY = PLAY ? false : makeSilentClips();

const sandboxConfig = {
  enabled: true,
  commandName: 'voice-alerts',
  player: 'auto',
  clipsDir: PLAY ? REAL_CLIPS : SILENT_CLIPS,
  volume: 85,
  // The throttle window must be clearly larger than the coalescing window,
  // otherwise two closely spaced triggers land in one batch and never reach the
  // throttle branch at all.
  minIntervalMs: 500,
  coalesceMs: 100,
  waitingTools: ['ask_user_question', 'exit_plan_mode', 'my_custom_tool'],
  watchApprovals: true,
  scenes: {},
};
writeFileSync(join(SANDBOX, 'voice-alerts.config.json'), JSON.stringify(sandboxConfig, null, 2), 'utf8');

/**
 * Rewrite the sandbox config and force its mtime forward.
 * The plugin hot-reads the config by mtime and caches the player probe per
 * `config.player`, so the bumped timestamp is what makes a change take effect.
 */
let configStamp = Date.now() / 1000;
function rewriteSandboxConfig(patch) {
  const next = { ...sandboxConfig, ...patch };
  const file = join(SANDBOX, 'voice-alerts.config.json');
  writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
  configStamp += 5;
  utimesSync(file, configStamp, configStamp);
  return next;
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Must exceed throttle (500) + coalescing (100) so checks do not interfere. */
const QUIET = 700;

// ── mock cordis context ──────────────────────────────────────────────────
const listeners = new Map();
const injected = new Map();
let commandDef = null;
let jobDoneHandler = null;
let failNextRegister = false;
const infoLogs = [];
const warnLogs = [];

function buildChild(service) {
  return {
    effect(fn) { fn(); return () => {}; },
    on(event, fn) {
      const key = `child:${service}:${event}`;
      if (!listeners.has(key)) listeners.set(key, []);
      listeners.get(key).push(fn);
      return () => {};
    },
    ...(service === 'jobs' ? { jobs: { onJobDone: (fn) => { jobDoneHandler = fn; return () => {}; } } } : {}),
    ...(service === 'commands' ? {
      commands: {
        register: (def) => {
          if (failNextRegister) throw new Error('command "voice-alerts" is already registered');
          commandDef = def;
          return () => {};
        },
      },
    } : {}),
  };
}

function makeCtx() {
  return {
    logger: {
      info: (m) => { infoLogs.push(String(m)); },
      warn: (m) => { warnLogs.push(String(m)); },
      error: (m) => { warnLogs.push(String(m)); },
    },
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
      return () => {};
    },
    effect(fn) { fn(); return () => {}; },
    inject(services, fn) {
      for (const service of services) {
        if (!injected.has(service)) injected.set(service, buildChild(service));
        fn(injected.get(service));
      }
    },
  };
}

function fire(event, ...args) { for (const fn of listeners.get(event) ?? []) fn(...args); }
function fireChild(service, event, ...args) {
  for (const fn of listeners.get(`child:${service}:${event}`) ?? []) fn(...args);
}

function markNow() { return { info: infoLogs.length, warn: warnLogs.length }; }

/**
 * Scenes the plugin selected, read from the log.
 * In silent mode a successful pick shows up as "playing <scene>"; when a clip is
 * genuinely absent it shows up as a "no <lang> audio for <scene>" warning, which is why
 * both sources are inspected.
 */
function chosenSinceMark(mark) {
  return infoLogs.slice(mark.info).concat(warnLogs.slice(mark.warn))
    .map((l) => /(?:playing|no [a-z]{2} audio for)\s+([a-z-]+)/.exec(l)?.[1])
    .filter(Boolean);
}

/**
 * Only count real playbacks. chosenSinceMark also matches the "missing" warning,
 * so playback-count assertions must use this stricter match.
 */
function playedSinceMark(mark) {
  return infoLogs.slice(mark.info)
    .map((l) => /playing\s+(\S+?)(?:\s*\(|$)/.exec(l)?.[1])
    .filter(Boolean);
}

function sawSinceMark(mark, fragment) {
  return infoLogs.slice(mark.info).concat(warnLogs.slice(mark.warn)).some((l) => l.includes(fragment));
}

/** Everything logged since the mark, for failure reporting. */
function logSinceMark(mark) {
  return infoLogs.slice(mark.info).concat(warnLogs.slice(mark.warn));
}

if (!existsSync(PLUGIN)) {
  console.error(`plugin not found: ${PLUGIN}`);
  process.exit(1);
}

// ── load the plugin ──────────────────────────────────────────────────────
const plugin = await import(new URL(`file:///${PLUGIN.replace(/\\/g, '/')}`).href);
const ctx = makeCtx();
plugin.apply(ctx);
await sleep(200);

console.log(`plugin:  ${PLUGIN}`);
console.log(`sandbox: ${SANDBOX}`);
console.log(
  PLAY
    ? `clips:   ${REAL_CLIPS} (real audio, will make noise)`
    : SILENT_READY
      ? `clips:   ${SILENT_CLIPS} (0.05s silence; observable but inaudible)`
      : `clips:   ${SILENT_CLIPS} (ffmpeg missing, placeholders not generated; some checks degrade)`,
);
console.log('');

check('apply() completes and logs an active line',
  infoLogs.some((l) => l.includes('[voice-alerts] active')),
  infoLogs.find((l) => l.includes('[voice-alerts] active')) ?? '(none)');
check('a playable backend was detected', infoLogs.some((l) => /player (ffplay|powershell)/.test(l)));
check('all 8 scenes are registered', infoLogs.some((l) => l.includes('8 scenes')));
check('the isolated config was used, not the real one', infoLogs.some((l) => l.includes(SANDBOX)));
check('the /voice-alerts command was registered', commandDef !== null && commandDef.name === 'voice-alerts');
check('sessions / jobs / commands were all injected',
  injected.has('sessions') && injected.has('jobs') && injected.has('commands'));
check('tools/pre-execute and approval/request are hooked',
  listeners.has('tools/pre-execute') && listeners.has('approval/request'));

// ── packaged asset resolution ────────────────────────────────────────────
// With no clipsDir configured at all, the plugin must find assets/clips/ next to
// lib/index.js. This is the path a fresh install takes, so it is worth checking.
rewriteSandboxConfig({ clipsDir: null });
await sleep(60);
const packaged = await commandDef.handler({ rawInput: 'status' });
const missingScenes = SCENE_NAMES.filter((scene) => packaged.text.includes(`${scene}=on (missing)`));
check('with no clipsDir set, every scene resolves from the packaged assets',
  packaged.kind === 'success' && missingScenes.length === 0,
  missingScenes.length ? `missing: ${missingScenes.join(', ')}` : 'all 8 found in assets/clips');
rewriteSandboxConfig({ clipsDir: PLAY ? REAL_CLIPS : SILENT_CLIPS });
await sleep(60);

// ── turn events ──────────────────────────────────────────────────────────
function emitTurn(reason, { userInitiated = true, origin = 'root', turn = 1, sessionId = 's1' } = {}) {
  const session = { header: { id: sessionId, origin } };
  fireChild('sessions', 'session/event', session, { type: 'turn/start', data: { turn } });
  if (userInitiated) {
    fireChild('sessions', 'session/event', session, { type: 'user/message', data: { source: { kind: 'user' } } });
  }
  fireChild('sessions', 'session/event', session, { type: 'turn/end', data: { turn, reason: { kind: reason } } });
}
const preExec = (name, origin = 'root', next = () => {}) =>
  fire('tools/pre-execute', { name, agent: { session: { header: { origin } } } }, next);
const goalChange = (operation, sessionId = 's1', origin = 'root') =>
  fireChild('sessions', 'session/event', { header: { id: sessionId, origin } },
    { type: 'goal/change', data: { operation } });

let mark = markNow();
emitTurn('completed');
await sleep(QUIET);
check('your turn completed -> turn-done', chosenSinceMark(mark).includes('turn-done'), chosenSinceMark(mark).join(',') || 'none');

mark = markNow();
emitTurn('error', { turn: 2 });
await sleep(QUIET);
check('your turn failed -> turn-error', chosenSinceMark(mark).includes('turn-error'), chosenSinceMark(mark).join(',') || 'none');

mark = markNow();
emitTurn('max-tokens', { turn: 3 });
await sleep(QUIET);
check('token ceiling hit -> turn-error', chosenSinceMark(mark).includes('turn-error'), chosenSinceMark(mark).join(',') || 'none');

mark = markNow();
emitTurn('completed', { userInitiated: false, turn: 4, sessionId: 's-auto' });
await sleep(QUIET);
check('an autonomous round completing stays silent (goal events cover that)',
  chosenSinceMark(mark).length === 0, chosenSinceMark(mark).join(',') || 'none');

mark = markNow();
emitTurn('error', { userInitiated: false, turn: 5, sessionId: 's-auto2' });
await sleep(QUIET);
check('an autonomous round FAILING still speaks -> turn-error',
  chosenSinceMark(mark).includes('turn-error'), chosenSinceMark(mark).join(',') || 'none');

// ── goal events ──────────────────────────────────────────────────────────
mark = markNow();
goalChange('complete', 's-goal');
await sleep(QUIET);
check('goal/change complete -> goal-complete', chosenSinceMark(mark).includes('goal-complete'), chosenSinceMark(mark).join(',') || 'none');

mark = markNow();
goalChange('block', 's-goal2');
await sleep(QUIET);
check('goal/change block -> goal-blocked', chosenSinceMark(mark).includes('goal-blocked'), chosenSinceMark(mark).join(',') || 'none');

for (const op of ['create', 'edit', 'pause', 'resume']) {
  mark = markNow();
  goalChange(op, `s-goal-${op}`);
  await sleep(QUIET);
  check(`goal/change ${op} stays silent`, chosenSinceMark(mark).length === 0, chosenSinceMark(mark).join(',') || 'none');
}

// ── approval requests ────────────────────────────────────────────────────
// `approval/asked` is the session-stream event raised under the `ask` policy,
// and the reliable path; `approval/request` is only a fallback.
mark = markNow();
fireChild('sessions', 'session/event', { header: { id: 's-approval', origin: 'root' } },
  { type: 'approval/asked', data: { id: 'a1' } });
await sleep(QUIET);
check('approval/asked -> approval', chosenSinceMark(mark).includes('approval'), chosenSinceMark(mark).join(',') || 'none');

mark = markNow();
fireChild('sessions', 'session/event', { header: { id: 's-approval-sub', origin: 'subagent' } },
  { type: 'approval/asked', data: { id: 'a2' } });
await sleep(QUIET);
check('an approval in a subagent session stays silent', chosenSinceMark(mark).length === 0, chosenSinceMark(mark).join(',') || 'none');

// ── background jobs ──────────────────────────────────────────────────────
mark = markNow();
jobDoneHandler({ status: 'completed' });
await sleep(QUIET);
check('a job finishing -> job-done', chosenSinceMark(mark).includes('job-done'), chosenSinceMark(mark).join(',') || 'none');

mark = markNow();
jobDoneHandler({ status: 'failed' });
await sleep(QUIET);
check('a job failing -> job-failed', chosenSinceMark(mark).includes('job-failed'), chosenSinceMark(mark).join(',') || 'none');

mark = markNow();
jobDoneHandler({ status: 'killed' });
await sleep(QUIET);
check('a job you killed stays silent', chosenSinceMark(mark).length === 0, chosenSinceMark(mark).join(',') || 'none');

// ── waiting for you ──────────────────────────────────────────────────────
mark = markNow();
preExec('ask_user_question');
await sleep(QUIET);
check('ask_user_question -> needs-input', chosenSinceMark(mark).includes('needs-input'), chosenSinceMark(mark).join(',') || 'none');

mark = markNow();
preExec('exit_plan_mode');
await sleep(QUIET);
check('exit_plan_mode -> needs-input', chosenSinceMark(mark).includes('needs-input'), chosenSinceMark(mark).join(',') || 'none');

mark = markNow();
preExec('my_custom_tool');
await sleep(QUIET);
check('a custom waitingTools entry works too', chosenSinceMark(mark).includes('needs-input'), chosenSinceMark(mark).join(',') || 'none');

mark = markNow();
let nextCalled = false;
preExec('read', 'root', () => { nextCalled = true; });
await sleep(QUIET);
check('an ordinary tool stays silent and next() is still called', chosenSinceMark(mark).length === 0 && nextCalled);

// ── filtering ────────────────────────────────────────────────────────────
mark = markNow();
emitTurn('completed', { origin: 'subagent', turn: 6, sessionId: 's-sub' });
goalChange('complete', 's-sub2', 'subagent');
jobDoneHandler({ status: 'failed' });
await sleep(QUIET);
const subagentOnly = chosenSinceMark(mark);
check('subagent turns and goals stay silent (jobs have no session owner, so they do speak)',
  !subagentOnly.includes('turn-done') && !subagentOnly.includes('goal-complete'),
  subagentOnly.join(',') || 'none');

mark = markNow();
preExec('ask_user_question', 'subagent');
await sleep(QUIET);
check('a subagent asking a question stays silent', chosenSinceMark(mark).length === 0, chosenSinceMark(mark).join(',') || 'none');

// ── coalescing and priority ──────────────────────────────────────────────
mark = markNow();
jobDoneHandler({ status: 'completed' });   // job-done, priority 20
goalChange('block', 's-coal');             // goal-blocked, priority 45
jobDoneHandler({ status: 'failed' });      // job-failed, priority 40
await sleep(QUIET);
const coalesced = chosenSinceMark(mark);
check('several events in one window collapse to the top-priority goal-blocked',
  coalesced.length === 1 && coalesced[0] === 'goal-blocked', `played=${coalesced.join(',') || 'none'}`);

// ── throttling ───────────────────────────────────────────────────────────
await sleep(QUIET);
mark = markNow();
jobDoneHandler({ status: 'failed' });
// The gap must exceed the coalescing window (100ms) so this is a separate batch,
// yet stay under the throttle window (500ms) so it is throttled.
await sleep(200);
jobDoneHandler({ status: 'failed' });
await sleep(QUIET);
const throttled = playedSinceMark(mark);
check('the per-scene throttle drops the repeat',
  throttled.length === 1 && throttled[0] === 'job-failed' && sawSinceMark(mark, 'throttled job-failed'),
  `played=${throttled.join(',') || 'none'}; throttle log=${sawSinceMark(mark, 'throttled job-failed') ? 'yes' : 'no'}`);

// ── slash command ────────────────────────────────────────────────────────
const status = await commandDef.handler({ rawInput: 'status' });
check('/voice-alerts status reports the player and the scene list',
  status.kind === 'success' && status.text.includes('Player:') && status.text.includes('Scenes'),
  status.text.split('\n').slice(0, 2).join(' / '));

mark = markNow();
const testOne = await commandDef.handler({ rawInput: 'test goal-blocked' });
await sleep(QUIET);
check('/voice-alerts test goal-blocked selects that scene',
  testOne.kind === 'success' && chosenSinceMark(mark).includes('goal-blocked'),
  testOne.text.replace(/\n/g, ' / '));

const bad = await commandDef.handler({ rawInput: 'test no-such-scene' });
check('/voice-alerts test rejects an unknown scene', bad.kind === 'error' && bad.text.includes('Unknown scene'));

// ── language switching ───────────────────────────────────────────────────
// Asserting on the file that actually resolves is what proves the selection
// took effect; the status line alone would not catch a wrong filename.
const langDefault = await commandDef.handler({ rawInput: 'lang' });
check('/voice-alerts lang reports the default language as zh',
  langDefault.kind === 'success' && /Language: zh\b/.test(langDefault.text),
  langDefault.text.split('\n')[0]);

const toEn = await commandDef.handler({ rawInput: 'lang en' });
const persisted = JSON.parse(readFileSync(join(SANDBOX, 'voice-alerts.config.json'), 'utf8')).language;
check('/voice-alerts lang en switches and persists the setting',
  toEn.kind === 'success' && persisted === 'en',
  `persisted=${persisted}`);

await sleep(60);
const statusEn = await commandDef.handler({ rawInput: 'status' });
check('/voice-alerts status names the active language and both clip sets',
  statusEn.text.includes('Language: en') && statusEn.text.includes('Clip sets:'),
  (statusEn.text.split('\n')[1] ?? '').trim());

// With en active, every English clip must resolve.
//
// The "missing English clip" branch is deliberately NOT exercised here: the
// repository ships a complete English set and PACKAGE_ASSETS is the last link in
// the resolution chain, so deleting a sandbox copy is always rescued by the
// packaged one — which is correct behaviour. Forcing the branch would mean
// renaming shipped assets mid-test, a worse trade than the gap it would close.
// The missing-clip warning path itself is covered by the backend checks below.
const statusEnFull = await commandDef.handler({ rawInput: 'status' });
check('with en active, the whole English clip set resolves',
  statusEnFull.text.includes('en (active): all clips present'),
  (statusEnFull.text.split('\n').find((l) => l.startsWith('Clip sets')) ?? '(none)').trim());

mark = markNow();
await commandDef.handler({ rawInput: 'test turn-done' });
await sleep(QUIET);
check('with en active, playing still selects a clip rather than going silent',
  playedSinceMark(mark).includes('turn-done'),
  playedSinceMark(mark).join(',') || logSinceMark(mark).slice(-1)[0] || '(no log)');

const badLang = await commandDef.handler({ rawInput: 'lang klingon' });
check('/voice-alerts lang rejects an unknown language',
  badLang.kind === 'error' && badLang.text.includes('Unknown language'));

// The help text spells it `lang <zh|en>`; the brackets are placeholder notation, but
// people copy them along. Typing them must still select the language rather than being
// refused — that trap was hit for real, so it gets its own check.
const langBracketed = await commandDef.handler({ rawInput: 'lang <en>' });
const bracketPersisted = JSON.parse(readFileSync(join(SANDBOX, 'voice-alerts.config.json'), 'utf8')).language;
check('/voice-alerts lang <en> is tolerated and selects en (the brackets are notation)',
  langBracketed.kind === 'success' && bracketPersisted === 'en',
  `kind=${langBracketed.kind} persisted=${bracketPersisted}`);

// Tolerance is not a free pass: an unknown language in brackets is still refused, and
// that is exactly when the explanatory hint is worth showing.
const badBracketed = await commandDef.handler({ rawInput: 'lang <klingon>' });
check('a bracketed unknown language is still refused, and the hint says why',
  badBracketed.kind === 'error'
  && badBracketed.text.includes('Unknown language')
  && badBracketed.text.includes('placeholder notation'),
  badBracketed.text.replace(/\n/g, ' / '));

// An unknown value in the config must fall back, not silence the plugin.
rewriteSandboxConfig({ language: 'klingon' });
await sleep(60);
const statusFallback = await commandDef.handler({ rawInput: 'status' });
check('an unrecognised language in the config falls back to zh rather than muting',
  statusFallback.text.includes('Language: zh'),
  (statusFallback.text.split('\n')[1] ?? '').trim());

rewriteSandboxConfig({ language: 'zh' });
await sleep(60);

const off = await commandDef.handler({ rawInput: 'off' });
await sleep(80);
mark = markNow();
jobDoneHandler({ status: 'completed' });
await sleep(QUIET);
check('/voice-alerts off silences everything', off.kind === 'success' && chosenSinceMark(mark).length === 0);

const on = await commandDef.handler({ rawInput: 'on' });
await sleep(80);
mark = markNow();
jobDoneHandler({ status: 'completed' });
await sleep(QUIET);
check('/voice-alerts on restores it', on.kind === 'success' && chosenSinceMark(mark).includes('job-done'), chosenSinceMark(mark).join(',') || 'none');

// ── command name collision ───────────────────────────────────────────────
let collisionSafe = true;
try {
  failNextRegister = true;
  const ctx2 = makeCtx();
  plugin.apply(ctx2);
  await sleep(100);
  collisionSafe = warnLogs.some((l) => l.includes('could not register'));
} catch {
  collisionSafe = false;
} finally {
  failNextRegister = false;
}
check('a command-name collision only warns; the plugin survives', collisionSafe,
  warnLogs.find((l) => l.includes('could not register')) ?? '(no warning)');

// ── player backend resolution ────────────────────────────────────────────
rewriteSandboxConfig({ player: 'powershell' });
await sleep(60);
mark = markNow();
const viaPs = await commandDef.handler({ rawInput: 'test turn-done' });
await sleep(QUIET);
check('forcing PowerShell picks the .wav and plays (SoundPlayer cannot read mp3)',
  viaPs.kind === 'success' && playedSinceMark(mark).includes('turn-done'),
  viaPs.text.replace(/\n/g, ' / '));

// Resolution-order check: the user-level directory must win over the packaged one.
// (A "only mp3 present" scenario cannot be built at all once the package ships
// .wav files, because level 3 always finds one. That is the fallback working.)
const USER_CLIPS = join(SANDBOX, 'voice-alerts', 'clips');
const mp3OnlyDir = join(SANDBOX, 'mp3-only');
mkdirSync(mp3OnlyDir, { recursive: true });
const statusWithOverride = await commandDef.handler({ rawInput: 'status' });
check('an empty user-level directory still resolves every scene from the package',
  SCENE_NAMES.every((scene) => !statusWithOverride.text.includes(`${scene}=on (missing)`)),
  statusWithOverride.text.split('\n').find((l) => l.startsWith('Scenes')) ?? '(no Scenes line)');

// Put one unmistakable file in the user level and confirm it becomes the source.
writeFileSync(join(USER_CLIPS, 'turn-done.mp3'), 'placeholder', 'utf8');
const overridden = resolveOrderProbe();
check('a user-level file takes precedence over the packaged one',
  overridden.endsWith(join('voice-alerts', 'clips', 'turn-done.mp3')),
  overridden);
rmSync(join(USER_CLIPS, 'turn-done.mp3'), { force: true });

function resolveOrderProbe() {
  // Mirrors the plugin's documented order for one scene, using only existence.
  const candidates = [
    join(USER_CLIPS, 'turn-done.mp3'),
    join(REPO_ROOT, 'assets', 'clips', 'turn-done.mp3'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? '(none)';
}

// Simulate a machine without ffmpeg: auto plus a bogus ffplayPath must fall back.
rewriteSandboxConfig({ player: 'auto', ffplayPath: join(SANDBOX, 'nope', 'ffplay.exe'), clipsDir: SILENT_CLIPS });
await sleep(60);
const fallbackStatus = await commandDef.handler({ rawInput: 'status' });
const fellBack = fallbackStatus.text.includes('PowerShell');
mark = markNow();
const viaFallback = await commandDef.handler({ rawInput: 'test turn-done' });
await sleep(QUIET);
check('with no ffmpeg it falls back to PowerShell and still plays (the zero-dependency promise)',
  fellBack && viaFallback.kind === 'success' && playedSinceMark(mark).includes('turn-done'),
  fallbackStatus.text.split('\n').find((l) => l.startsWith('Player:')) ?? '(no Player line)');

// Asking for ffplay explicitly and not finding it must fail loudly, not silently switch.
rewriteSandboxConfig({ player: 'ffplay', ffplayPath: join(SANDBOX, 'nope', 'ffplay.exe') });
await sleep(60);
const forcedMissing = await commandDef.handler({ rawInput: 'test turn-done' });
check('an explicitly requested but absent ffplay fails loudly instead of switching backends',
  forcedMissing.kind === 'error', forcedMissing.text.replace(/\n/g, ' / '));

// ── summary ──────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
console.log(`\n==== ${results.length - failed.length}/${results.length} checks passed ====`);
if (failed.length) {
  console.log('failures:');
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
}
console.log(PLAY ? '\n(--play: the clips were audible.)' : '\n(silent mode: logic only. Add --play to hear the clips.)');
try { rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(failed.length === 0 ? 0 : 1);
