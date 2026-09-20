#!/usr/bin/env node
/**
 * build.mjs — generate the alert audio for dsh-status-chime.
 *
 * Data flow
 *   assets/clips.json  (the single source of truth: line, voice, settings)
 *     -> bl speech synthesize        (Alibaba Cloud Bailian TTS)
 *          -> ffmpeg loudnorm        (normalise every clip to the same loudness)
 *               -> assets/clips/<scene>.mp3  and  .wav
 *
 *   Both formats are produced on purpose:
 *     .mp3  for ffplay
 *     .wav  for the PowerShell / System.Media.SoundPlayer fallback, which only
 *           accepts uncompressed PCM. That fallback is what makes the plugin work
 *           on a Windows machine with nothing else installed, so the .wav files
 *           are not optional.
 *
 * Usage
 *   node scripts/build.mjs voices                # list the candidates from clips.json
 *   node scripts/build.mjs audition              # synth every candidate -> preview/
 *   node scripts/build.mjs audition <id>         # synth one candidate
 *   node scripts/build.mjs build                 # synth all scenes -> assets/clips/
 *   node scripts/build.mjs clip <scene>          # rebuild one scene
 *   node scripts/build.mjs build --dry-run       # print the commands without running them
 *
 * Options
 *   --root <dir>          project root (defaults to the repository this script lives in)
 *   VOICE_ALERTS_FFMPEG   explicit ffmpeg path; otherwise ffmpeg comes from PATH
 *
 * Why this calls bailian.mjs through node instead of the `bl` shim
 *   Going through cmd.exe puts the text and punctuation through a shell quoting
 *   layer. `node <cli> <argv...>` passes a clean argument array, and the spoken
 *   line travels in a UTF-8 file via --text-file, so no encoding or escaping
 *   problem can reach the API.
 *
 * Requirements (only for regeneration; the shipped clips need none of this)
 *   - Alibaba Cloud Bailian CLI, authenticated, credentials in ~/.bailian/config.json
 *   - ffmpeg on PATH
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const ROOT = resolve(argValue('--root') ?? join(HERE, '..'));
const CLIPS_JSON = join(ROOT, 'assets', 'clips.json');
const TMP_DIR = join(ROOT, 'tmp');
const PREVIEW_DIR = join(ROOT, 'preview');
const CLIPS_DIR = join(ROOT, 'assets', 'clips');

/**
 * The real Bailian entry point; the `bl` shim runs exactly this file.
 * Node is used directly rather than the .cmd shim so that arguments — including the
 * Chinese text and punctuation — never pass through a shell quoting layer.
 * Set VOICE_ALERTS_BAILIAN_CLI when npm's global prefix is somewhere unusual.
 */
const BAILIAN_CLI = process.env.VOICE_ALERTS_BAILIAN_CLI ?? join(
  process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'),
  'npm', 'node_modules', 'bailian-cli', 'dist', 'bailian.mjs',
);

const args = process.argv.slice(2);
const mode = args[0] ?? 'build';
const dryRun = args.includes('--dry-run');

/**
 * First non-flag argument after the subcommand.
 * Flags have to be filtered out: `build --dry-run` otherwise reads "--dry-run" as a
 * scene name.
 */
function positional(index) {
  const rest = args.slice(1).filter((a) => !a.startsWith('--'));
  return rest[index];
}

const log = (message) => { process.stdout.write(`${message}\n`); };
function fail(message) {
  process.stderr.write(`[build] ${message}\n`);
  process.exit(1);
}

for (const dir of [TMP_DIR, PREVIEW_DIR, CLIPS_DIR]) mkdirSync(dir, { recursive: true });

if (!existsSync(CLIPS_JSON)) fail(`missing source of truth: ${CLIPS_JSON}`);
const config = JSON.parse(readFileSync(CLIPS_JSON, 'utf8'));

// ── process helpers ───────────────────────────────────────────────────────
function run(exe, argv, { quiet = false } = {}) {
  if (dryRun) {
    log(`  [dry-run] ${exe} ${argv.map((a) => (a.includes(' ') ? JSON.stringify(a) : a)).join(' ')}`);
    return { status: 0, stdout: '', stderr: '' };
  }
  const result = spawnSync(exe, argv, { encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  if (result.error) return { status: -1, stdout: '', stderr: String(result.error) };
  if (!quiet && result.status !== 0) {
    log(`  ! ${exe} exited ${result.status}`);
    if (result.stderr) log(`    stderr: ${result.stderr.trim().slice(0, 500)}`);
    if (result.stdout) log(`    stdout: ${result.stdout.trim().slice(0, 500)}`);
  }
  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function resolveFfmpeg() {
  if (!existsSync(BAILIAN_CLI)) fail(`Bailian CLI not found: ${BAILIAN_CLI}`);
  const candidates = ['ffmpeg'];
  if (process.env.VOICE_ALERTS_FFMPEG) candidates.push(process.env.VOICE_ALERTS_FFMPEG);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['-version'], { encoding: 'utf8', windowsHide: true });
    if (!probe.error && probe.status === 0) return candidate;
  }
  return null;
}

/** Synthesize one clip through Bailian TTS. The line travels in a UTF-8 file. */
function synthesize({ id, model, voice, text, instruction, rate, pitch, volume, format, sampleRate, language, out }) {
  const textFile = join(TMP_DIR, `${id}.txt`);
  writeFileSync(textFile, text, 'utf8');

  const argv = [
    BAILIAN_CLI,
    'speech', 'synthesize',
    '--text-file', textFile,
    '--model', model,
    '--voice', voice,
    '--out', out,
    '--format', format,
    '--sample-rate', String(sampleRate),
  ];
  if (instruction) argv.push('--instruction', instruction);
  if (rate !== undefined && rate !== null) argv.push('--rate', String(rate));
  if (pitch !== undefined && pitch !== null) argv.push('--pitch', String(pitch));
  if (volume !== undefined && volume !== null) argv.push('--volume', String(volume));
  if (language) argv.push('--language', language);

  log(`  -> synthesizing ${id} (${model} / ${voice})`);
  const result = run(process.execPath, argv);
  if (result.status !== 0) return false;
  if (!dryRun && !existsSync(out)) {
    log(`  ! the command succeeded but produced no file: ${out}`);
    return false;
  }
  return true;
}

/** Normalise loudness, then emit both the mp3 and the wav. */
function normalize(ffmpeg, { raw, mp3, wav, loudnorm }) {
  const filter = `loudnorm=I=${loudnorm.I}:TP=${loudnorm.TP}:LRA=${loudnorm.LRA}`;
  const okMp3 = run(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', raw, '-af', filter,
    '-ar', String(config.sampleRate), '-ac', '1', '-b:a', '128k', mp3]).status === 0;
  const okWav = run(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', raw, '-af', filter,
    '-ar', String(config.sampleRate), '-ac', '1', '-c:a', 'pcm_s16le', wav]).status === 0;
  return okMp3 && okWav;
}

function ffprobeDuration(ffmpeg, file) {
  const ffprobe = ffmpeg.replace(/ffmpeg(\.exe)?$/i, (m) => (m.toLowerCase().endsWith('.exe') ? 'ffprobe.exe' : 'ffprobe'));
  const result = run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { quiet: true });
  const value = Number.parseFloat(result.stdout.trim());
  return Number.isFinite(value) ? value : null;
}

// ── subcommands ───────────────────────────────────────────────────────────
function cmdVoices() {
  const candidates = config.voiceCandidates ?? [];
  log(`Voice candidates (${candidates.length}):`);
  for (const candidate of candidates) {
    const chosen = config.chosenCandidate === candidate.id ? '  <- selected' : '';
    log(`  ${String(candidate.id).padEnd(20)} ${String(candidate.model).padEnd(26)} ${String(candidate.voice).padEnd(18)} ${candidate.label}${chosen}`);
  }
  log(`\nLocked in: model=${config.model ?? '(none)'}  voice=${config.voice ?? '(none)'}`);
}

function cmdAudition(only) {
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) fail('ffmpeg not found; it is needed for loudness normalisation and transcoding.');
  const candidates = config.voiceCandidates ?? [];
  const list = only ? candidates.filter((c) => c.id === only) : candidates;
  if (list.length === 0) fail(`no candidate matched: ${only ?? '(all)'}`);

  const done = [];
  for (const candidate of list) {
    const raw = join(TMP_DIR, `${candidate.id}.raw.mp3`);
    const synthesized = synthesize({
      id: candidate.id,
      model: candidate.model,
      voice: candidate.voice,
      text: config.auditionText,
      instruction: candidate.instruction ?? config.instruction,
      rate: candidate.rate ?? config.rate,
      pitch: candidate.pitch ?? config.pitch,
      volume: config.volume,
      format: config.format,
      sampleRate: config.sampleRate,
      language: config.language,
      out: raw,
    });
    if (!synthesized) continue;
    const mp3 = join(PREVIEW_DIR, `${candidate.id}.mp3`);
    const wav = join(PREVIEW_DIR, `${candidate.id}.wav`);
    if (!normalize(ffmpeg, { raw, mp3, wav, loudnorm: config.loudnorm })) {
      log(`  ! normalisation failed: ${candidate.id}`);
      continue;
    }
    const seconds = ffprobeDuration(ffmpeg, mp3);
    log(`  ok ${candidate.id}  ${seconds === null ? '?' : seconds.toFixed(2) + 's'}  ${mp3}`);
    done.push(candidate.id);
  }
  writeFileSync(join(PREVIEW_DIR, 'index.json'), `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    auditionText: config.auditionText,
    instruction: config.instruction,
    rate: config.rate,
    candidates: done,
  }, null, 2)}\n`, 'utf8');
  log(`\n${done.length}/${list.length} audition clips written to ${PREVIEW_DIR}`);
  log(`Order: ${done.join(' -> ')}`);
}

function cmdBuild(only) {
  if (!config.model || !config.voice) {
    fail('clips.json has no locked-in model/voice yet. Run `audition`, then write the choice into model/voice.');
  }
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) fail('ffmpeg not found; it is needed for loudness normalisation and transcoding.');

  const names = only ? [only] : Object.keys(config.clips);
  for (const scene of names) {
    const spec = config.clips[scene];
    if (!spec) fail(`clips.json has no such scene: ${scene}`);
    const raw = join(TMP_DIR, `${scene}.raw.mp3`);
    const synthesized = synthesize({
      id: scene,
      model: config.model,
      voice: config.voice,
      text: spec.text,
      instruction: config.instruction,
      rate: config.rate,
      pitch: config.pitch,
      volume: config.volume,
      format: config.format,
      sampleRate: config.sampleRate,
      language: config.language,
      out: raw,
    });
    if (!synthesized) { log(`  ! synthesis failed: ${scene}`); continue; }
    const mp3 = join(CLIPS_DIR, `${scene}.mp3`);
    const wav = join(CLIPS_DIR, `${scene}.wav`);
    if (!normalize(ffmpeg, { raw, mp3, wav, loudnorm: config.loudnorm })) { log(`  ! normalisation failed: ${scene}`); continue; }
    const seconds = ffprobeDuration(ffmpeg, mp3);
    log(`  ok ${String(scene).padEnd(14)} ${seconds === null ? '?' : seconds.toFixed(2) + 's'}  ${mp3}`);
  }
  log(`\nOutput directory: ${CLIPS_DIR}`);
}

switch (mode) {
  case 'voices':
    cmdVoices();
    break;
  case 'audition':
    cmdAudition(positional(0));
    break;
  case 'build':
  case 'clip':
    cmdBuild(positional(0));
    break;
  default:
    fail(`unknown subcommand: ${mode} (expected: voices / audition / build / clip)`);
}
