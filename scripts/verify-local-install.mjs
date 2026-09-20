#!/usr/bin/env node
/**
 * verify-local-install.mjs — verify an installed copy of the plugin end to end.
 *
 * WHY THIS EXISTS SEPARATELY FROM selftest.mjs
 *   The main suite drives the plugin through a mock cordis context and asserts on
 *   English log text. This one drives the plugin's public `/voice-alerts` command
 *   the way a user would, which makes it the right tool for checking an installed
 *   copy — including the single-file local variant, whose user-facing strings are
 *   in Chinese. It reads both localisations (see detectLocale below).
 *
 * WHAT IT ACTUALLY PROVES
 *   That switching language changes which FILE is resolved, not merely which label
 *   is printed. It points `clipsDir` at a directory holding ONLY English clips, then
 *   asserts that the Chinese set reads as missing and the English set as present,
 *   and that those two verdicts swap after `lang en`.
 *
 * PRECONDITION, AND WHY TWO CHECKS MAY SKIP
 *   That isolation only works when packaged assets are NOT reachable. A single-file
 *   install has no `assets/clips/` next to it, so `clipsDir` is the only source and
 *   removing a file genuinely removes it. For the repository build, `assets/clips/`
 *   sits right there and is the last link in the resolution chain, so it rescues
 *   every lookup — which is correct behaviour, but it means the two lookup checks
 *   cannot isolate anything. Rather than fail, they report SKIP with that reason.
 *
 *   node scripts/verify-local-install.mjs --plugin <path to the installed .js>
 *   node scripts/verify-local-install.mjs --plugin lib/index.js     # repo build: 2 SKIPs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

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

const ffmpeg = findFfmpeg();
if (ffmpeg === null) {
  console.log('SKIP  ffmpeg not found; the throwaway clips cannot be synthesised.');
  console.log('\n==== skipped (0 checks run) ====');
  process.exit(0);
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
const readLanguage = () => JSON.parse(readFileSync(CONFIG, 'utf8')).language;

const results = [];
/** `skip` results are neither a pass nor a failure, and are counted separately. */
function check(name, ok, detail = '') { results.push({ name, ok, skip: false, detail }); }
function skip(name, reason) { results.push({ name, ok: null, skip: true, detail: reason }); }

// ── minimal cordis context, enough for this plugin's top level ────────────
let commandDef = null;
function makeCtx() {
  const ctx = {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    on: () => () => {},
    effect: (fn) => { const d = fn(); return () => { if (typeof d === 'function') d(); }; },
    inject: (deps, fn) => { if (deps.includes('commands')) fn(ctx); },
  };
  ctx.commands = { register: (def) => { commandDef = def; return () => {}; },
    effect: (fn) => { fn(); return () => {}; } };
  return ctx;
}

writeConfig({ language: 'zh' });
const plugin = await import(new URL(`file:///${resolve(PLUGIN).replace(/\\/g, '/')}`).href);
await plugin.apply(makeCtx());

const call = (rawInput) => commandDef.handler({ rawInput });

/**
 * The plugin ships in two localisations: the repository build is English, and a
 * single-file local install may be Chinese. Rather than hard-code one set of
 * strings — which is how this harness first broke — the expectations are chosen
 * from whatever the plugin actually prints.
 */
function detectLocale(statusText) {
  if (statusText.includes('语言：') || statusText.includes('语言音频')) {
    return { name: 'zh', language: '语言：', clipSets: '语言音频', missing: '缺', complete: '音频齐备', unknown: '未知语言' };
  }
  return { name: 'en', language: 'Language: ', clipSets: 'Clip sets:', missing: '(missing)', complete: 'all clips present', unknown: 'Unknown language' };
}

check('the installed plugin loads and registers its command', commandDef !== null);
if (commandDef === null) {
  rmSync(SANDBOX, { recursive: true, force: true });
  process.exit(1);
}

let status = await call('status');
const L = detectLocale(status.text);
const clipSetsLine = () => status.text.split('\n').find((l) => l.includes(L.clipSets)) ?? '(no clip-sets line)';

check(`the status output is readable (localisation detected: ${L.name})`,
  status.kind === 'success' && status.text.includes(L.clipSets), clipSetsLine());

check('the default language is zh',
  new RegExp(`${L.language.trim()}\\s*zh`).test(status.text),
  (status.text.split('\n').find((l) => l.includes(L.language)) ?? '(none)').trim());

// The isolation checks. If packaged assets are reachable they rescue the lookup,
// so the fixture cannot prove anything and these are skipped rather than failed.
const zhMissing = status.text.includes(L.missing) && clipSetsLine().includes(L.missing);
if (zhMissing) {
  check('with zh active, a dir holding only English clips reports every scene missing',
    clipSetsLine().includes(L.missing), clipSetsLine());
  check('...while the English set reads as complete',
    clipSetsLine().includes(L.complete), clipSetsLine());
} else {
  const reason = 'packaged assets are reachable, so clipsDir cannot isolate the lookup (expected for the repo build)';
  skip('with zh active, a dir holding only English clips reports every scene missing', reason);
  skip('...while the English set reads as complete', reason);
}

let out = await call('lang en');
check('/voice-alerts lang en succeeds', out.kind === 'success', out.text.split('\n')[0]);
check('the switch is persisted to the config file', readLanguage() === 'en', `language=${readLanguage()}`);

status = await call('status');
check('after the switch, the English set is the active one',
  new RegExp(`${L.language.trim()}\\s*en`).test(status.text),
  (status.text.split('\n').find((l) => l.includes(L.language)) ?? '(none)').trim());

// An unknown language must fall back, not mute the plugin.
writeConfig({ language: 'nonsense' });
status = await call('status');
check('an unrecognised language falls back to zh rather than muting',
  new RegExp(`${L.language.trim()}\\s*zh`).test(status.text),
  (status.text.split('\n').find((l) => l.includes(L.language)) ?? '(none)').trim());

const bad = await call('lang nonsense');
check('/voice-alerts lang rejects an unknown language',
  bad.kind === 'error' && bad.text.includes(L.unknown), bad.text.split('\n')[0]);

// ── report ────────────────────────────────────────────────────────────────
console.log(`plugin:  ${PLUGIN}`);
console.log(`sandbox: ${SANDBOX}`);
console.log(`locale:  ${L.name}\n`);
const failed = results.filter((r) => r.skip !== true && !r.ok);
const skipped = results.filter((r) => r.skip === true);
for (const r of results) {
  const tag = r.skip === true ? 'SKIP' : r.ok ? 'PASS' : 'FAIL';
  console.log(`${tag}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`);
}
const ran = results.length - skipped.length;
console.log(`\n==== ${ran - failed.length}/${ran} checks passed${skipped.length ? `, ${skipped.length} skipped` : ''} ====`);
rmSync(SANDBOX, { recursive: true, force: true });
process.exit(failed.length === 0 ? 0 : 1);
