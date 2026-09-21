#!/usr/bin/env node
/**
 * qa-negative-control.mjs — prove the quality gate actually rejects bad audio.
 *
 * A gate that only ever says "pass" is worthless, and the silence floors exist
 * because the previous gate passed a fully silent file: the peak check only looked
 * for clipping, so a clip with a plausible length and no signal sailed through.
 *
 * This injects the defects that matter and asserts the gate names them. It runs
 * entirely offline: the ASR and Omni helpers are pointed at a nonexistent
 * interpreter, so those two checks fail immediately without a network call, which
 * also keeps the run free and deterministic. The assertions are about the checks
 * that do not need a model - the silence floors and the speech-rate verdicts.
 *
 *   node scripts/qa-negative-control.mjs
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(join(HERE, '..'));

function findFfmpeg() {
  for (const c of ['ffmpeg', process.env.VOICE_ALERTS_FFMPEG].filter(Boolean)) {
    const r = spawnSync(c, ['-version'], { windowsHide: true, stdio: 'ignore' });
    if (!r.error && r.status === 0) return c;
  }
  return null;
}

const ffmpeg = findFfmpeg();
if (ffmpeg === null) {
  // Skip rather than fail: this test needs ffmpeg to build its fixtures, and
  // ffmpeg is optional everywhere else in the project. CI runs without it, so a
  // hard failure here would be a false alarm rather than a finding.
  console.log('SKIP  ffmpeg not found; the defect fixtures cannot be synthesised.');
  console.log('      The gate itself is unaffected - ffmpeg is only needed to regenerate audio.');
  console.log('\n==== skipped (0 checks run) ====');
  process.exit(0);
}

const SANDBOX = mkdtempSync(join(tmpdir(), 'qa-negctl-'));
const CLIPS = join(SANDBOX, 'assets', 'clips');
mkdirSync(CLIPS, { recursive: true });

/** A silent clip of the given length: the defect the old gate could not see. */
function silent(name, seconds) {
  const out = join(CLIPS, name);
  const r = spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
    '-i', 'anullsrc=r=24000:cl=mono', '-t', String(seconds), '-b:a', '128k', out],
  { windowsHide: true, stdio: 'ignore' });
  if (r.status !== 0) throw new Error(`could not create ${name}`);
}

/** A quiet-but-present clip: fails BOTH silence floors. */
function veryQuiet(name, seconds) {
  const out = join(CLIPS, name);
  const r = spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
    '-i', `sine=frequency=440:duration=${seconds}`, '-af', 'volume=-46dB', '-b:a', '128k', out],
  { windowsHide: true, stdio: 'ignore' });
  if (r.status !== 0) throw new Error(`could not create ${name}`);
}

/**
 * A high-crest-factor clip: a loud click followed by silence.
 *
 * This is the only fixture that isolates the MEAN floor. The quiet fixture above
 * cannot do it - `sine` already runs near -18 dBFS, so attenuating it by 46 dB
 * leaves the peak at about -64 dB and the peak floor fires first, which is how
 * an earlier version of this test passed its "fails the mean floor" assertion
 * without ever exercising the mean floor. Here the peak stays around -18 dB
 * (well above the -30 dB peak floor) while the average over the whole clip falls
 * to about -42 dB (below the -35 dB mean floor).
 */
function loudClickThenSilence(name) {
  const out = join(CLIPS, name);
  const r = spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
    '-i', 'sine=frequency=1000:duration=0.02', '-af', 'apad=pad_dur=2', '-b:a', '128k', out],
  { windowsHide: true, stdio: 'ignore' });
  if (r.status !== 0) throw new Error(`could not create ${name}`);
}

// Scenes chosen so each fixture maps to a distinct verdict:
//   turn-done     silent, plausible length   -> must fail BOTH silence floors
//   needs-input   quiet but present          -> must fail both floors (peak fires
//                                               first; kept to show a uniformly
//                                               quiet clip is caught)
//   goal-blocked  loud click + silence       -> must fail the MEAN floor while the
//                                               PEAK floor stays satisfied, which is
//                                               the only way to exercise it alone
//   approval      a real shipped clip        -> must pass (no false positive)
//   job-done      real clip, slowed 0.35x    -> must be flagged as a rate outlier
silent('turn-done.mp3', 1.58);
silent('turn-done.wav', 1.58);
veryQuiet('needs-input.mp3', 2.09);
veryQuiet('needs-input.wav', 2.09);
loudClickThenSilence('goal-blocked.mp3');
loudClickThenSilence('goal-blocked.wav');

const REAL = join(ROOT, 'assets', 'clips', 'approval.mp3');
if (!existsSync(REAL)) {
  process.stderr.write(`cannot find a healthy control clip at ${REAL}\n`);
  process.exit(1);
}
copyFileSync(REAL, join(CLIPS, 'approval.mp3'));
// A couple more healthy clips, so the batch median the rate is judged against is
// not degenerate.
for (const scene of ['turn-error', 'goal-complete']) {
  const src = join(ROOT, 'assets', 'clips', `${scene}.mp3`);
  if (existsSync(src)) copyFileSync(src, join(CLIPS, `${scene}.mp3`));
}

// A stretched clip: the speaking rate itself is slowed, so units per second of
// actual speech collapses. Padding with silence would NOT do this - the net rate
// deliberately ignores silence, which is the whole point of measuring net speech.
const jobDoneSrc = join(ROOT, 'assets', 'clips', 'job-done.mp3');
if (existsSync(jobDoneSrc)) {
  const stretched = join(CLIPS, 'job-done.mp3');
  const r = spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', jobDoneSrc,
    // atempo is limited to 0.5..100, so chain two to reach 0.35.
    '-af', 'atempo=0.5,atempo=0.7', '-b:a', '128k', stretched], { windowsHide: true, stdio: 'ignore' });
  if (r.status !== 0) throw new Error('could not create the stretched fixture');
}

writeFileSync(join(SANDBOX, 'assets', 'clips.json'), `${JSON.stringify({
  defaultLanguage: 'zh',
  languages: { en: { voice: 'unused' } },
  clips: {
    'turn-done': { text: '任务完成。', expect: '任务完成' },
    'needs-input': { text: '需要你回答。', expect: '需要你回答' },
    'goal-blocked': { text: '目标受阻，需要你介入处理后才能继续。', expect: '目标受阻' },
    'approval': { text: '有操作等待你批准。', expect: '有操作等待你批准' },
    'turn-error': { text: '任务执行出错，本轮未能完成，请回到 DSH 查看错误详情。', expect: '任务执行出错' },
    'goal-complete': { text: '目标已完成。', expect: '目标已完成' },
    'job-done': { text: '后台任务完成。', expect: '后台任务完成' },
  },
}, null, 2)}\n`, 'utf8');

// No network: a nonexistent interpreter makes the ASR and Omni helpers fail at
// once, so the run is offline, deterministic and free.
const run = spawnSync(process.execPath, [join(HERE, 'qa.mjs'), 'clips', '--root', SANDBOX, '--lang', 'zh'], {
  encoding: 'utf8', windowsHide: true,
  env: { ...process.env, PYTHON: 'no-such-interpreter-for-negative-control',
    VOICE_ALERTS_UTMOS_PYTHON: 'no-such-interpreter-for-negative-control' },
});
const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;

const results = [];
function check(name, ok, detail = '') { results.push({ name, ok, detail }); }

/** The failure list reported for one clip id. */
function failuresFor(id) {
  const block = output.split(`\n${id}\n`)[1];
  if (block === undefined) return null;
  return /failed: (.*)/.exec(block)?.[1] ?? '';
}

/** The rate line reported for one clip id, so the detail does not quote another clip. */
function rateLineFor(id) {
  const block = output.split(`\n${id}\n`)[1];
  return block === undefined ? null : /rate [\d.]+ units\/s[^\n]*/.exec(block)?.[0] ?? '';
}

check('the gate exits non-zero when defects are present', run.status !== 0, `exit ${run.status}`);

const silentFailures = failuresFor('turn-done');
check('a silent clip fails the peak floor',
  silentFailures !== null && /effectively silent/.test(silentFailures),
  silentFailures ?? '(no block found)');
check('a silent clip fails on both the peak and the mean floor',
  silentFailures !== null && (silentFailures.match(/effectively silent/g) ?? []).length === 2,
  silentFailures ?? '(no block found)');

const quietFailures = failuresFor('needs-input');
check('a very quiet clip fails both floors',
  quietFailures !== null && (quietFailures.match(/effectively silent/g) ?? []).length === 2,
  quietFailures ?? '(no block found)');

// The isolation test. A loud click followed by silence has a peak around -18 dB,
// above the -30 dB peak floor, while its average sits near -42 dB, below the -35 dB
// mean floor. Asserting BOTH halves is the point: without the "peak did not fire"
// half, this would pass even if only the peak floor were doing the work.
const crestFailures = failuresFor('goal-blocked');
check('a loud click with a very low average fails the MEAN floor',
  crestFailures !== null && /mean .* effectively silent/.test(crestFailures),
  crestFailures ?? '(no block found)');
check('...while its peak stays above the peak floor, so the mean floor is exercised alone',
  crestFailures !== null && !/peak .* effectively silent/.test(crestFailures),
  crestFailures ?? '(no block found)');

const healthyFailures = failuresFor('approval');
check('a healthy clip does NOT trip the silence floors (no false positive)',
  healthyFailures !== null && !/effectively silent/.test(healthyFailures),
  healthyFailures === '' ? '(no failures)' : (healthyFailures ?? '(no block found)'));

const stretchedRate = rateLineFor('job-done');
check('a stretched clip is flagged as a speech-rate outlier',
  /vs .* median|implausible/.test(stretchedRate ?? ''),
  stretchedRate || '(no rate line)');

const healthyRate = rateLineFor('approval');
check('a healthy clip is NOT flagged as a rate outlier',
  healthyRate !== null && !/vs .* median|implausible/.test(healthyRate),
  healthyRate || '(no rate line)');

check('an unavailable UTMOS is reported, not failed',
  /UTMOS not available/.test(output),
  (/UTMOS not available[^\n]*/.exec(output)?.[0] ?? '(no note)'));

// ── report ────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`);
console.log(`\n==== ${results.length - failed.length}/${results.length} checks passed ====`);
if (failed.length > 0) {
  console.log('\nfull gate output:\n');
  console.log(output.split('\n').slice(0, 40).join('\n'));
}
rmSync(SANDBOX, { recursive: true, force: true });
process.exit(failed.length === 0 ? 0 : 1);
