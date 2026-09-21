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
/**
 * The subcommand, or `null` when none was given.
 *
 * Running with no argument used to default silently to `build`, which meant that
 * anyone who typed `node scripts/build.mjs` to see what the tool does triggered a
 * full paid synthesis run and overwrote every bundled clip in `assets/clips/`.
 * No help text, no confirmation, and the files it replaces are the ones shipped in
 * the repository. Requiring the subcommand explicitly costs one word and removes
 * the whole failure mode.
 */
const mode = args[0] ?? null;
const dryRun = args.includes('--dry-run');

/**
 * First positional argument after the subcommand.
 *
 * Flags are filtered out, and so is the value of any flag that takes one:
 * `build --lang en` would otherwise read "en" as a scene name and fail with
 * "no such scene: en". A flag that takes a value has to be declared here.
 */
const VALUE_FLAGS = new Set(['--lang', '--root']);
function positional(index) {
  const rest = [];
  for (let i = 1; i < args.length; i += 1) {
    const a = args[i];
    if (VALUE_FLAGS.has(a)) { i += 1; continue; } // skip the flag and its value
    if (a.startsWith('--')) continue;             // boolean flag
    rest.push(a);
  }
  return rest[index];
}

const log = (message) => { process.stdout.write(`${message}\n`); };
function fail(message) {
  process.stderr.write(`[build] ${message}\n`);
  process.exit(1);
}

// Only when something is actually going to be written: `--dry-run` promises to
// "print the commands without running them or writing files", and creating these
// directories up front broke that promise.
if (!dryRun) for (const dir of [TMP_DIR, PREVIEW_DIR, CLIPS_DIR]) mkdirSync(dir, { recursive: true });

if (!existsSync(CLIPS_JSON)) fail(`missing source of truth: ${CLIPS_JSON}`);
const config = JSON.parse(readFileSync(CLIPS_JSON, 'utf8'));

// ── language layer ────────────────────────────────────────────────────────
// The top-level model/voice/instruction/rate/pitch describe the default
// language. `languages.<code>` overrides whichever fields it names, and clips
// for a non-default language are written as `<scene>.<code>.mp3` so the
// default language keeps the plain `<scene>.mp3` name it has always had.
const DEFAULT_LANGUAGE = config.defaultLanguage ?? 'zh';

/** Languages to render, default first, then every override that is not it. */
function allLanguages() {
  const overrides = Object.keys(config.languages ?? {}).filter((code) => code !== DEFAULT_LANGUAGE);
  return [DEFAULT_LANGUAGE, ...overrides];
}

/** Effective synthesis settings for one language. */
function settingsFor(language) {
  const o = config.languages?.[language] ?? {};
  return {
    model: o.model ?? config.model,
    voice: o.voice ?? config.voice,
    instruction: o.instruction ?? config.instruction,
    rate: o.rate ?? config.rate,
    pitch: o.pitch ?? config.pitch,
    volume: o.volume ?? config.volume,
    format: o.format ?? config.format,
    sampleRate: o.sampleRate ?? config.sampleRate,
    language: o.language ?? language,
  };
}

/** Filename stem for a scene in a language. */
function clipBase(scene, language) {
  return language === DEFAULT_LANGUAGE ? scene : `${scene}.${language}`;
}

/** The spoken line for a scene in a language, or null when there is no copy. */
function textFor(scene, language) {
  const spec = config.clips[scene];
  if (spec === undefined) return null;
  if (language === DEFAULT_LANGUAGE) return spec.text ?? null;
  return spec[language]?.text ?? null;
}

/** Audition line for a language. */
function auditionTextFor(language) {
  return config.auditionTexts?.[language] ?? (language === DEFAULT_LANGUAGE ? config.auditionText : null);
}

/** Synthesise + normalise one scene in one language. Returns the clip path or null. */
function renderScene(ffmpeg, scene, language) {
  const text = textFor(scene, language);
  if (!text) {
    log(`  - ${clipBase(scene, language)}: no ${language} copy, skipped`);
    return null;
  }
  const s = settingsFor(language);
  const base = clipBase(scene, language);
  const raw = join(TMP_DIR, `${base}.raw.mp3`);
  if (!synthesize({ id: base, model: s.model, voice: s.voice, text, instruction: s.instruction,
    rate: s.rate, pitch: s.pitch, volume: s.volume, format: s.format, sampleRate: s.sampleRate,
    language: s.language, out: raw })) {
    log(`  ! synthesis failed: ${base}`);
    return null;
  }
  const mp3 = join(CLIPS_DIR, `${base}.mp3`);
  const wav = join(CLIPS_DIR, `${base}.wav`);
  if (!normalize(ffmpeg, { raw, mp3, wav, loudnorm: config.loudnorm })) {
    log(`  ! normalisation failed: ${base}`);
    return null;
  }
  const seconds = ffprobeDuration(ffmpeg, mp3);
  log(`  ok ${base.padEnd(18)} ${seconds === null ? '?' : seconds.toFixed(2) + 's'}  ${mp3}`);
  return mp3;
}

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
  // Not written when dry: this happens before run(), so the old code wrote a temp
  // file per scene even though --dry-run says it writes nothing.
  if (!dryRun) writeFileSync(textFile, text, 'utf8');

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
    const lang = candidate.language ?? DEFAULT_LANGUAGE;
    log(`  ${String(candidate.id).padEnd(20)} ${lang.padEnd(4)} ${String(candidate.model).padEnd(26)} ${String(candidate.voice).padEnd(18)} ${candidate.label}${chosen}`);
  }
  log('');
  for (const code of allLanguages()) {
    const s = settingsFor(code);
    log(`Locked in [${code}]: model=${s.model ?? '(none)'}  voice=${s.voice ?? '(none)'}`);
  }
}

function cmdAudition(only) {
  // `--lang` is meaningless here and used to be swallowed silently by positional(),
  // so `audition --lang en` looked like "audition the English candidates" while it
  // actually auditioned every candidate. Each candidate declares its own language
  // (see `voices`); say so instead of quietly doing the opposite.
  if (argValue('--lang') !== undefined) {
    fail('audition does not take --lang: a candidate carries its own language (run `voices` to see them). Use `build --lang <code>` to render one language.');
  }
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) fail('ffmpeg not found; it is needed for loudness normalisation and transcoding.');
  const candidates = config.voiceCandidates ?? [];
  const list = only ? candidates.filter((c) => c.id === only) : candidates;
  if (list.length === 0) fail(`no candidate matched: ${only ?? '(all)'}`);

  const done = [];
  for (const candidate of list) {
    // A candidate may declare its own language, so English voices are auditioned
    // on English copy rather than on the Chinese audition line.
    const lang = candidate.language ?? DEFAULT_LANGUAGE;
    const text = candidate.text ?? auditionTextFor(lang);
    if (!text) { log(`  ! no audition text for ${lang}; skipping ${candidate.id}`); continue; }
    const s = settingsFor(lang);
    const raw = join(TMP_DIR, `${candidate.id}.raw.mp3`);
    const synthesized = synthesize({
      id: candidate.id,
      model: candidate.model,
      voice: candidate.voice,
      text,
      instruction: candidate.instruction ?? s.instruction,
      rate: candidate.rate ?? s.rate,
      pitch: candidate.pitch ?? s.pitch,
      volume: s.volume,
      format: s.format,
      sampleRate: s.sampleRate,
      language: s.language,
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
    log(`  ok ${candidate.id}  ${lang}  ${seconds === null ? '?' : seconds.toFixed(2) + 's'}  ${mp3}`);
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

  // `--lang en` renders just that language, which is what you want when only
  // the English copy or voice changed and the Chinese clips are still good.
  const requested = argValue('--lang');
  const languages = requested ? [requested] : allLanguages();
  for (const code of languages) {
    if (!allLanguages().includes(code)) fail(`no such language in clips.json: ${code} (have: ${allLanguages().join(', ')})`);
  }

  const scenes = only ? [only] : Object.keys(config.clips);
  if (only && !config.clips[only]) fail(`clips.json has no such scene: ${only}`);

  for (const code of languages) {
    const s = settingsFor(code);
    log(`── ${code}  (${s.model} / ${s.voice})`);
    for (const scene of scenes) renderScene(ffmpeg, scene, code);
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
    cmdBuild(positional(0));
    break;
  case 'clip': {
    // `clip` names ONE scene, so a missing name must not silently mean "all of them".
    // It used to fall through to the same code path as `build`, which meant a typo
    // like `node scripts/build.mjs clip` ran 16 paid syntheses and overwrote every
    // bundled clip — the exact "bare invocation" footgun the `clip <scene>` usage
    // line and the guard on `mode` were added to prevent.
    const scene = positional(0);
    if (scene === undefined) {
      fail('clip needs a scene name: node scripts/build.mjs clip <scene>. Nothing was generated, nothing was billed.');
    }
    cmdBuild(scene);
    break;
  }
  case null:
    // Print usage rather than synthesising: see the note on `mode` above.
    log('usage: node scripts/build.mjs <subcommand> [--dry-run]');
    log('');
    log('  voices              list the voice candidates from clips.json');
    log('  audition [name]     synthesise one sample per candidate, for listening');
    log('  build               synthesise every scene into mp3 + wav (calls the TTS API)');
    log('  clip <scene>        synthesise a single scene');
    log('');
    log('  --lang <code>       build: render only this language (default: every declared language)');
    log('  --root <dir>        project root (defaults to the repository this script lives in)');
    log('  --dry-run           print the commands without running them or writing files');
    log('');
    log('  VOICE_ALERTS_BAILIAN_CLI   path to bailian.mjs when npm\'s global prefix is unusual');
    log('  VOICE_ALERTS_FFMPEG        explicit ffmpeg path (otherwise ffmpeg must be on PATH)');
    log('  VOICE_ALERTS_ASR_MODEL     overrides the default ASR model used by qa.mjs');
    log('');
    log('Nothing was generated. Re-run with a subcommand to proceed.');
    break;
  default:
    fail(`unknown subcommand: ${mode} (expected: voices / audition / build / clip)`);
}
