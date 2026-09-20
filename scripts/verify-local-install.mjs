/**
 * Verify an installed (single-file) copy of the plugin, in the language it speaks.
 *
 * The main suite asserts on English log text, so it cannot judge the Chinese
 * variant that a single-file install uses. This harness instead drives the public
 * `/voice-alerts` command and reads the status text, which is the same surface a
 * user sees.
 *
 * The decisive check is file resolution: point `clipsDir` at a directory holding
 * ONLY English clips. With the language set to zh every scene must be reported
 * missing, and with en every scene must be reported present. That proves the
 * language actually selects a different file rather than only changing a label.
 *
 *   node scripts/verify-local-install.mjs --plugin <path to installed .js>
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const PLUGIN = argValue('--plugin');
if (!PLUGIN || !existsSync(PLUGIN)) {
  process.stderr.write('usage: node scripts/verify-local-install.mjs --plugin <path to installed plugin .js>\n');
  process.exit(1);
}

const SCENES = ['turn-done', 'turn-error', 'needs-input', 'job-done', 'job-failed',
  'goal-complete', 'goal-blocked', 'approval'];

function findFfmpeg() {
  for (const c of ['ffmpeg', process.env.VOICE_ALERTS_FFMPEG].filter(Boolean)) {
    const r = spawnSync(c, ['-version'], { windowsHide: true, stdio: 'ignore' });
    if (!r.error && r.status === 0) return c;
  }
  return null;
}

const SANDBOX = mkdtempSync(join(tmpdir(), 'va-local-'));
const ONLY_EN = join(SANDBOX, 'only-en');
mkdirSync(ONLY_EN, { recursive: true });
mkdirSync(join(SANDBOX, 'voice-alerts', 'clips'), { recursive: true });
process.env.DSH_HOME = SANDBOX;

// English-only clip set, so "zh resolves nothing" is an unambiguous signal.
const ffmpeg = findFfmpeg();
if (ffmpeg === null) {
  process.stderr.write('ffmpeg is required to synthesise the throwaway clips\n');
  process.exit(1);
}
for (const scene of SCENES) {
  for (const ext of ['mp3', 'wav']) {
    const out = join(ONLY_EN, `${scene}.en.${ext}`);
    const codec = ext === 'mp3' ? ['-b:a', '128k'] : ['-c:a', 'pcm_s16le'];
    const r = spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
      '-i', 'anullsrc=r=24000:cl=mono', '-t', '0.05', ...codec, out], { windowsHide: true, stdio: 'ignore' });
    if (r.status !== 0) {
      process.stderr.write(`could not create ${out}\n`);
      process.exit(1);
    }
  }
}

const CONFIG = join(SANDBOX, 'voice-alerts.config.json');
function writeConfig(patch) {
  writeFileSync(CONFIG, `${JSON.stringify({ enabled: true, commandName: 'voice-alerts',
    player: 'auto', clipsDir: ONLY_EN, volume: 85, minIntervalMs: 500, coalesceMs: 100,
    waitingTools: ['ask_user_question'], watchApprovals: true, scenes: {}, ...patch }, null, 2)}\n`, 'utf8');
}

const results = [];
function check(name, ok, detail = '') { results.push({ name, ok, detail }); }

// ── minimal cordis context, enough for this plugin's top level ────────────
const logs = [];
function makeCtx() {
  const ctx = {
    logger: { info: (m) => logs.push(String(m)), warn: (m) => logs.push(String(m)),
      error: (m) => logs.push(String(m)) },
    on: () => () => {},
    effect: (fn) => { const d = fn(); return () => { if (typeof d === 'function') d(); }; },
    inject: (deps, fn) => { if (deps.includes('commands')) fn(ctx); },
  };
  ctx.commands = { register: (def) => { commandDef = def; return () => {}; },
    effect: (fn) => { fn(); return () => {}; } };
  return ctx;
}
let commandDef = null;

writeConfig({ language: 'zh' });
const plugin = await import(new URL(`file:///${resolve(PLUGIN).replace(/\\/g, '/')}`).href);
await plugin.apply(makeCtx());

check('the installed plugin loads and registers its command', commandDef !== null);
if (commandDef === null) { rmSync(SANDBOX, { recursive: true, force: true }); process.exit(1); }

const call = (rawInput) => commandDef.handler({ rawInput });

// With zh active and only English files available, everything must read as missing.
let status = await call('status');
check('default language is zh', /语言：zh/.test(status.text), (status.text.split('\n')[1] ?? '').trim());
check('with zh active, a dir holding only English clips reports every scene missing',
  /zh（当前）：缺/.test(status.text),
  (status.text.split('\n').find((l) => l.startsWith('语言音频')) ?? '(none)').trim());
check('...while the English set reads as complete',
  /en：音频齐备/.test(status.text),
  (status.text.split('\n').find((l) => l.startsWith('语言音频')) ?? '(none)').trim());

// Switch language and the missing/present verdicts must swap. That is what proves
// the language selects a different FILE.
let out = await call('lang en');
check('/voice-alerts lang en succeeds', out.kind === 'success', out.text.split('\n')[0]);
check('the switch is persisted to the config file',
  JSON.parse(readFileSync(CONFIG, 'utf8')).language === 'en',
  `language=${JSON.parse(readFileSync(CONFIG, 'utf8')).language}`);

status = await call('status');
check('after the switch, the English set is the active one',
  /en（当前）：音频齐备/.test(status.text),
  (status.text.split('\n').find((l) => l.startsWith('语言音频')) ?? '(none)').trim());

// An unknown language must fall back, not mute the plugin.
writeConfig({ language: 'nonsense' });
status = await call('status');
check('an unrecognised language falls back to zh rather than muting',
  /语言：zh/.test(status.text), (status.text.split('\n')[1] ?? '').trim());

const bad = await call('lang nonsense');
check('/voice-alerts lang rejects an unknown language',
  bad.kind === 'error' && bad.text.includes('未知语言'), bad.text.split('\n')[0]);

// ── report ────────────────────────────────────────────────────────────────
console.log(`plugin:  ${PLUGIN}`);
console.log(`sandbox: ${SANDBOX}\n`);
const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`);
}
console.log(`\n==== ${results.length - failed.length}/${results.length} checks passed ====`);
if (failed.length > 0) {
  console.log('failures:');
  for (const f of failed) console.log(`  - ${f.name}`);
}
rmSync(SANDBOX, { recursive: true, force: true });
process.exit(failed.length === 0 ? 0 : 1);
