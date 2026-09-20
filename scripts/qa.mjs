#!/usr/bin/env node
/**
 * qa.mjs — audio quality gate for the alert clips.
 *
 * Checks per clip:
 *   1. Intelligibility (ASR)  tools/qw_local_asr.py transcribes it; the transcript
 *      is compared against the intended line by character similarity.
 *   2. Listening quality (Omni)  tools/qw_local_omni.py rates clarity, naturalness,
 *      voice character and cleanliness, and describes the most obvious defect.
 *   3. Technical (ffmpeg)  ffprobe for duration/sample rate/channels, volumedetect
 *      for peak and mean level, silencedetect for the net speaking time.
 *   4. Naturalness (UTMOS)  tools/qw_local_utmos.py predicts a MOS. Optional: a
 *      missing install is reported, never failed.
 *
 * Two tiers of gate, and the split is deliberate
 *   HARD (a failure is a failure): ASR similarity, clarity, cleanliness, peak level,
 *     the silence floors, and any call error.
 *   ADVISORY (recorded, never failing): naturalness, voice character, maturity,
 *     suitability, the defect note, net speech rate, and UTMOS.
 *   Why: the subjective dimensions belong to a human's ears. Treating an LLM's
 *   subjective score as a hard gate breaks down in practice — the same clip scored
 *   "naturalness 6, character 4" on one run and "naturalness 9, character 7" on the
 *   next, and four clearly different clips once received identical scores. So the
 *   objective measurements gate the build and the subjective ones inform the choice.
 *
 * Why the silence floors exist
 *   The peak-level check only catches clipping, so a clip of pure silence passed
 *   every gate as long as the file had a plausible length — which is one of the
 *   classic TTS failure modes. Measured on the shipped clips, healthy audio peaks at
 *   -4.2..-1.9 dB and averages -20.6..-16.6 dB, while a fully silent file measures
 *   -91 dB. The peak floor sits 25.8 dB below the worst real clip and the mean floor 14.4 dB
 *
 * Why speech rate is advisory and per-batch
 *   A fixed band does not work here: the Chinese clips deliberately speak slowly
 *   (rate 0.95), and the 3.2-5.5 units/s band from human broadcast-speech research
 *   would fail seven of the eight. What matters for this project is consistency,
 *   because clip length carries the urgency, so each clip is compared against the
 *   median of its own language. Very short clips are exempt: a two-word clip has a
 *   rate too noisy to judge, and flagging it would be a false positive.
 *
 * Why UTMOS is compared per language
 *   Every English clip scores above every Chinese clip (4.38-4.51 against
 *   3.75-4.28). The predictor prefers the native-English voice, so a cross-language
 *   comparison would read as a defect in the Chinese set. Only the deviation from
 *   the same language's median is meaningful.
 *
 * Why not `bl speech recognize` / `bl omni` directly
 *   The Bailian CLI resolves its upload policy against a fixed endpoint, which fails
 *   for some regional credentials. The two Python helpers inline the audio as base64
 *   over the official compatible API instead, which works regardless.
 *
 * Usage
 *   node scripts/qa.mjs preview          # check preview/*.mp3 against auditionText
 *   node scripts/qa.mjs clips            # check every language's clips
 *   node scripts/qa.mjs rank             # send every preview clip to Omni at once, for a ranking
 *   node scripts/qa.mjs file <path> [expected text]
 *
 * Options
 *   --root <dir>          project root (defaults to the repository this script lives in)
 *   --report <path>       where to write report.md (default <root>/qa/report.md)
 *   --lang <code>         clips mode: check only this language
 *   VOICE_ALERTS_FFMPEG   explicit ffmpeg path; otherwise ffmpeg comes from PATH
 *   VOICE_ALERTS_UTMOS_PYTHON  interpreter that has utmos-pytorch; defaults to PYTHON
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const ROOT = resolve(argValue('--root') ?? join(HERE, '..'));
const CLIPS_JSON = join(ROOT, 'assets', 'clips.json');
const PREVIEW_DIR = join(ROOT, 'preview');
const CLIPS_DIR = join(ROOT, 'assets', 'clips');
const QA_DIR = join(ROOT, 'qa');
const TOOLS_DIR = join(ROOT, 'tools');

const PYTHON = process.env.PYTHON ?? 'python';
const ASR_SCRIPT = join(TOOLS_DIR, 'qw_local_asr.py');
const OMNI_SCRIPT = join(TOOLS_DIR, 'qw_local_omni.py');

const ASR_MODEL = process.env.VOICE_ALERTS_ASR_MODEL ?? 'qwen3-asr-flash';
const OMNI_MODEL = process.env.VOICE_ALERTS_OMNI_MODEL ?? 'qwen3.5-omni-plus';

const SIMILARITY_THRESHOLD = 0.9;
const HARD_DIMENSIONS = ['clarity', 'cleanliness'];
const HARD_DIMENSION_THRESHOLD = 7;
const ADVISORY_DIMENSIONS = ['naturalness', 'character', 'maturity'];

/**
 * Silence floors, in dB.
 *
 * Measured on the shipped clips: peak -4.2..-1.9 dB, mean -20.6..-16.6 dB, and a
 * fully silent file at -91 dB. These sit well clear of both sides.
 */
const SILENCE_PEAK_FLOOR_DB = -30;
const SILENCE_MEAN_FLOOR_DB = -35;

/**
 * Net speech rate advisory.
 *
 * Deliberately not a fixed band: the clips are synthesized slowly on purpose, so
 * the broadcast-speech range would fail most of them. Deviation from the batch
 * median is what is meaningful.
 */
const RATE_OUTLIER_FRACTION = 0.25;
/** Below this many units the rate is too noisy to judge - a 2-word clip varies wildly. */
const RATE_MIN_UNITS = 5;
/** Absolute plausibility, wide enough to catch a real failure rather than a style. */
const RATE_IMPLAUSIBLE = { zh: [1.0, 6.0], en: [0.5, 4.5] };

/** UTMOS is advisory, and flagged only against the median of the same language. */
const UTMOS_MEDIAN_MARGIN = 0.5;

const OMNI_PROMPT = [
  'You are a strict reviewer of voice-over quality for a short computer status alert.',
  'Important context: this kind of clip is NOT meant to be a dramatic performance, so do',
  'not treat a calm, even delivery as a defect. Judge the voice itself and the production',
  'quality.',
  'Reply with a single JSON object and nothing else, with no markdown code fence. Fields:',
  '{',
  '  "heard": "the words you actually heard",',
  '  "clarity": pronunciation clarity 1-10 (10 = every word is clear, no swallowed syllables),',
  '  "naturalness": 1-10 for how human it sounds (no robotic or stitched-together artefacts),',
  '  "character": 1-10 for how convincing the intended voice character is,',
  '  "maturity": 1-10 for how mature the voice sounds (1 = childlike, 10 = grown and experienced),',
  '  "cleanliness": 1-10 for the absence of noise, clicks, hum or breath artefacts,',
  '  "suitable_for_system_alert": true or false,',
  '  "defects": "the single most obvious defect, or none"',
  '}',
].join('\n');

const args = process.argv.slice(2);
const mode = args[0] ?? 'clips';

/**
 * First non-flag argument after the subcommand, ignoring options and their values.
 * `file --report x.mp3` would otherwise treat "--report" as the audio path.
 */
function positional(index, optionFlags = []) {
  const rest = [];
  for (let i = 1; i < args.length; i += 1) {
    const value = args[i];
    if (optionFlags.includes(value)) { i += 1; continue; }
    if (value.startsWith('--')) continue;
    rest.push(value);
  }
  return rest[index];
}

const REPORT_FLAGS = ['--root', '--report'];

if (!existsSync(CLIPS_JSON)) {
  process.stderr.write(`missing ${CLIPS_JSON}\n`);
  process.exit(1);
}
const config = JSON.parse(readFileSync(CLIPS_JSON, 'utf8'));

const reportPath = resolve(argValue('--report') ?? join(QA_DIR, 'report.md'));
mkdirSync(dirname(reportPath), { recursive: true });

// ── ffmpeg discovery ──────────────────────────────────────────────────────
function resolveFfmpeg() {
  const candidates = ['ffmpeg'];
  if (process.env.VOICE_ALERTS_FFMPEG) candidates.push(process.env.VOICE_ALERTS_FFMPEG);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['-version'], { encoding: 'utf8', windowsHide: true });
    if (!probe.error && probe.status === 0) return candidate;
  }
  return null;
}
const ffmpeg = resolveFfmpeg();
if (!ffmpeg) {
  process.stderr.write('ffmpeg not found; the technical measurements need it.\n');
  process.exit(1);
}
const ffprobe = ffmpeg.replace(/ffmpeg(\.exe)?$/i, (m) => (m.toLowerCase().endsWith('.exe') ? 'ffprobe.exe' : 'ffprobe'));

function probe(exe, argv) {
  const result = spawnSync(exe, argv, {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
  });
  if (result.error) return { status: -1, stdout: '', stderr: String(result.error) };
  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

// ── text normalisation and similarity ─────────────────────────────────────
function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^\p{Script=Han}a-z0-9]+/gu, '');
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[b.length];
}

function similarity(expected, actual) {
  const a = normalizeText(expected);
  const b = normalizeText(actual);
  if (a.length === 0 && b.length === 0) return 1;
  return Math.max(0, 1 - levenshtein(a, b) / Math.max(a.length, b.length, 1));
}

function extractJsonObject(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

// ── individual checks ─────────────────────────────────────────────────────
function runAsr(file) {
  const result = probe(PYTHON, [ASR_SCRIPT, file, '--lang', 'zh', '--model', ASR_MODEL, '--json']);
  if (result.status !== 0) return { ok: false, transcript: '', error: (result.stderr || '').trim().slice(-400) };
  const parsed = extractJsonObject(result.stdout);
  const choices = (parsed?.output?.choices) ?? parsed?.choices ?? [];
  const content = choices[0]?.message?.content ?? '';
  const transcript = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((p) => p?.text ?? '').join('')
      : '';
  return { ok: true, transcript: transcript.trim() };
}

function runOmni(files, prompt) {
  const argv = [OMNI_SCRIPT, ...files, '--message', prompt, '--model', OMNI_MODEL, '--max-tokens', '1200'];
  const result = probe(PYTHON, argv);
  if (result.status !== 0) return { ok: false, error: (result.stderr || '').trim().slice(-400) };
  const text = result.stdout.trim();
  return { ok: true, text, scores: extractJsonObject(text) };
}

function technical(file) {
  const duration = Number.parseFloat(probe(ffprobe, ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1', file]).stdout.trim());
  const info = probe(ffprobe, ['-v', 'error', '-select_streams', 'a:0', '-show_entries',
    'stream=sample_rate,channels,bit_rate', '-of', 'default=nw=1', file]).stdout;
  const fields = Object.fromEntries(info.trim().split('\n').map((line) => line.split('=')));
  // volumedetect reports on stderr, so stderr must stay captured here.
  const vol = probe(ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-af', 'volumedetect', '-f', 'null', '-']);
  const peak = /max_volume:\s*(-?[\d.]+) dB/.exec(vol.stderr ?? '')?.[1];
  const mean = /mean_volume:\s*(-?[\d.]+) dB/.exec(vol.stderr ?? '')?.[1];
  // Silence is what makes a "net" speech rate possible: units per second of
  // actual speech, rather than units per second including the pauses.
  const sil = probe(ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-af',
    'silencedetect=noise=-45dB:d=0.15', '-f', 'null', '-']);
  let silentSeconds = 0;
  for (const m of (sil.stderr ?? '').matchAll(/silence_duration:\s*([\d.]+)/g)) {
    silentSeconds += Number.parseFloat(m[1]);
  }
  const speechSeconds = Number.isFinite(duration) ? Math.max(0, duration - silentSeconds) : null;
  return {
    seconds: Number.isFinite(duration) ? duration : null,
    sampleRate: fields.sample_rate ?? null,
    channels: fields.channels ?? null,
    peakDb: peak === undefined ? null : Number.parseFloat(peak),
    meanDb: mean === undefined ? null : Number.parseFloat(mean),
    silentSeconds,
    speechSeconds,
  };
}

/** Units of speech: Chinese characters, or whitespace-separated words for English. */
function speechUnits(text, language) {
  if (typeof text !== 'string') return null;
  if (language === DEFAULT_LANGUAGE) return [...text].filter((c) => /[\u4e00-\u9fff]/.test(c)).length;
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length === 0 ? null : words.length;
}

function evaluate(file, expected, id, { language = DEFAULT_LANGUAGE, text = null } = {}) {
  const asr = runAsr(file);
  const omni = runOmni([file], OMNI_PROMPT);
  const tech = technical(file);
  const score = asr.ok ? similarity(expected, asr.transcript) : 0;
  const scores = omni.scores ?? {};

  const failures = [];
  if (!asr.ok) failures.push('ASR call failed');
  else if (score < SIMILARITY_THRESHOLD) failures.push(`ASR similarity ${score.toFixed(3)} < ${SIMILARITY_THRESHOLD}`);
  if (!omni.ok || !omni.scores) failures.push('Omni returned no parseable JSON');
  else {
    for (const key of HARD_DIMENSIONS) {
      const value = Number(scores[key]);
      if (!Number.isFinite(value) || value < HARD_DIMENSION_THRESHOLD) failures.push(`${key}=${scores[key]}`);
    }
  }
  if (tech.peakDb === null) failures.push('peak level unreadable');
  else if (tech.peakDb > -0.1) failures.push(`peak ${tech.peakDb} dB risks clipping`);
  // The clipping check alone lets pure silence through, so long as the file has a
  // plausible length. These floors are what actually catch a dead clip.
  else if (tech.peakDb < SILENCE_PEAK_FLOOR_DB) failures.push(`peak ${tech.peakDb} dB is effectively silent`);
  if (tech.meanDb !== null && tech.meanDb < SILENCE_MEAN_FLOOR_DB) {
    failures.push(`mean ${tech.meanDb} dB is effectively silent`);
  }

  const units = speechUnits(text, language);
  const rate = units !== null && tech.speechSeconds > 0 ? units / tech.speechSeconds : null;

  const record = {
    id,
    file,
    language,
    expected,
    units,
    asrTranscript: asr.transcript,
    asrSimilarity: Number(score.toFixed(4)),
    asrOk: asr.ok,
    omniRaw: omni.text ?? null,
    omni: omni.scores ?? null,
    technical: tech,
    netRate: rate === null ? null : Number(rate.toFixed(3)),
    // Filled in once the whole batch is known: both are judged relative to the
    // median of the same language, which a single clip cannot provide.
    rateOutlier: null,
    utmos: null,
    utmosFlag: null,
    pass: failures.length === 0,
    failures,
    asrError: asr.error,
    omniError: omni.error,
  };
  writeFileSync(join(QA_DIR, `${id}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return record;
}

// ── UTMOS, one model load for the whole batch ──────────────────────────────
/**
 * Score every clip with UTMOS.
 *
 * Returns null when the predictor is not installed, which the caller reports as
 * "unavailable" rather than treating as a failed clip: regenerating audio is an
 * occasional task, and requiring PyTorch for it would be a heavy dependency.
 */
function runUtmos(files) {
  const python = process.env.VOICE_ALERTS_UTMOS_PYTHON ?? PYTHON;
  const script = join(TOOLS_DIR, 'qw_local_utmos.py');
  if (!existsSync(script)) return null;
  const result = spawnSync(python, [script, ...files, '--json'], {
    encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) return { ok: false, error: String(result.error) };
  if (result.status !== 0) {
    return { ok: false, error: (result.stderr ?? '').trim().split('\n').at(-1) ?? `exit ${result.status}` };
  }
  const line = (result.stdout ?? '').split('\n').reverse().find((l) => l.trim().startsWith('['));
  if (line === undefined) return { ok: false, error: 'no JSON in output' };
  try {
    const parsed = JSON.parse(line);
    return { ok: true, byName: new Map(parsed.map((r) => [r.name, r.utmos])) };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

/**
 * Attach the batch-relative verdicts.
 *
 * Speech rate and UTMOS are only meaningful next to their peers in the same
 * language, so they are decided here rather than per clip.
 */
function annotateBatch(records) {
  const byLanguage = new Map();
  for (const r of records) {
    if (!byLanguage.has(r.language)) byLanguage.set(r.language, []);
    byLanguage.get(r.language).push(r);
  }
  for (const [language, group] of byLanguage) {
    const rates = group.map((r) => r.netRate).filter((v) => v !== null).sort((a, b) => a - b);
    const median = rates.length === 0 ? null : rates[Math.floor(rates.length / 2)];
    const [lo, hi] = RATE_IMPLAUSIBLE[language] ?? RATE_IMPLAUSIBLE[DEFAULT_LANGUAGE];

    for (const r of group) {
      if (r.netRate === null) continue;
      if (r.netRate < lo || r.netRate > hi) {
        r.rateOutlier = `implausible (${r.netRate.toFixed(2)} units/s outside ${lo}-${hi})`;
      } else if (median !== null && r.units !== null && r.units >= RATE_MIN_UNITS) {
        const deviation = (r.netRate - median) / median;
        if (Math.abs(deviation) > RATE_OUTLIER_FRACTION) {
          r.rateOutlier = `${deviation > 0 ? '+' : ''}${(deviation * 100).toFixed(0)}% vs ${median.toFixed(2)} median`;
        }
      }
    }

    const utmos = group.map((r) => r.utmos).filter((v) => typeof v === 'number').sort((a, b) => a - b);
    if (utmos.length === 0) continue;
    const utmosMedian = utmos[Math.floor(utmos.length / 2)];
    for (const r of group) {
      if (typeof r.utmos !== 'number') continue;
      const delta = r.utmos - utmosMedian;
      if (delta < -UTMOS_MEDIAN_MARGIN) {
        r.utmosFlag = `${delta.toFixed(2)} below the ${utmosMedian.toFixed(2)} median`;
      }
    }
  }
  return records;
}

// ── target lists ──────────────────────────────────────────────────────────
function previewTargets() {
  return readdirSync(PREVIEW_DIR)
    .filter((f) => f.endsWith('.mp3'))
    .sort()
    .map((f) => ({ id: `preview-${basename(f, '.mp3')}`, file: join(PREVIEW_DIR, f), expected: config.auditionText }));
}

/**
 * Every language declared in clips.json, default first.
 *
 * Clips for a non-default language are stored as `<scene>.<code>.mp3`, so the
 * quality gate has to walk the language list rather than one flat scene list.
 */
const DEFAULT_LANGUAGE = config.defaultLanguage ?? 'zh';
function allLanguages() {
  return [DEFAULT_LANGUAGE, ...Object.keys(config.languages ?? {}).filter((c) => c !== DEFAULT_LANGUAGE)];
}

function clipTargets(onlyLanguage) {
  const targets = [];
  for (const code of (onlyLanguage ? [onlyLanguage] : allLanguages())) {
    for (const scene of Object.keys(config.clips)) {
      const base = code === DEFAULT_LANGUAGE ? scene : `${scene}.${code}`;
      const file = join(CLIPS_DIR, `${base}.mp3`);
      if (!existsSync(file)) continue;
      const spec = config.clips[scene];
      const copy = code === DEFAULT_LANGUAGE ? spec : spec[code];
      const expected = copy?.expect ?? copy?.text;
      if (expected === undefined) continue;
      targets.push({ id: base, file, expected, language: code, text: copy?.text ?? null });
    }
  }
  return targets;
}

// ── rank: hand every candidate to Omni at once ────────────────────────────
function cmdRank() {
  const targets = previewTargets();
  if (targets.length < 2) {
    process.stderr.write('fewer than 2 clips in preview/, nothing to rank.\n');
    process.exit(1);
  }
  const slots = targets.map((_, i) => `A${i + 1}`);
  const legend = slots.map((slot, i) => `${slot} = ${targets[i].id}`).join('\n');
  const prompt = [
    `You will hear ${targets.length} audio clips, in order: ${slots.join(', ')}.`,
    'They all say the same sentence and are candidates for the same slot: a spoken',
    'status alert from a computer.',
    'Compare them against each other. Reply with a single JSON object and nothing else,',
    'with no markdown code fence:',
    '{',
    '  "ranking": [',
    '    { "slot": "A1", "character": 1-10, "maturity": 1-10, "naturalness": 1-10, "clarity": 1-10, "comment": "one sentence" }',
    '  ],',
    '  "best": "the slot you recommend",',
    '  "reason": "why, and what separates it from the rest"',
    '}',
    '',
    `Legend:\n${legend}`,
  ].join('\n');

  process.stdout.write(`sending ${targets.length} candidates to Omni for a ranking ...\n`);
  const result = runOmni(targets.map((t) => t.file), prompt);
  if (!result.ok || !result.scores) {
    process.stderr.write(`ranking failed: ${result.error ?? 'response was not parseable JSON'}\n`);
    if (result.text) process.stderr.write(`${result.text.slice(0, 800)}\n`);
    process.exit(1);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    model: OMNI_MODEL,
    slots: Object.fromEntries(slots.map((slot, i) => [slot, targets[i].id])),
    result: result.scores,
    raw: result.text,
  };
  mkdirSync(QA_DIR, { recursive: true });
  writeFileSync(join(QA_DIR, 'rank.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  const rows = Array.isArray(result.scores.ranking) ? result.scores.ranking : [];
  for (const row of rows) {
    const id = payload.slots[row.slot] ?? row.slot;
    process.stdout.write(
      `  ${String(row.slot).padEnd(4)} ${String(id).padEnd(26)} ` +
      `character ${row.character ?? '?'}  maturity ${row.maturity ?? '?'}  ` +
      `naturalness ${row.naturalness ?? '?'}  clarity ${row.clarity ?? '?'}  ${row.comment ?? ''}\n`,
    );
  }
  process.stdout.write(`\nrecommended: ${payload.slots[result.scores.best] ?? result.scores.best}\n`);
  process.stdout.write(`reason: ${result.scores.reason ?? ''}\n`);
  process.stdout.write(`details: ${join(QA_DIR, 'rank.json')}\n`);
}

// ── main ──────────────────────────────────────────────────────────────────
if (mode === 'rank') {
  cmdRank();
  process.exit(0);
}

const targets = mode === 'preview'
  ? previewTargets()
  : mode === 'clips'
    ? clipTargets(argValue('--lang'))
    : mode === 'file'
      ? (() => {
        const file = positional(0, REPORT_FLAGS);
        if (!file || !existsSync(file)) {
          process.stderr.write('usage: node scripts/qa.mjs file <audio path> [expected text]\n');
          process.exit(1);
        }
        return [{ id: basename(file, '.mp3'), file, expected: positional(1, REPORT_FLAGS) ?? '' }];
      })()
      : [];

if (targets.length === 0) {
  process.stderr.write(`no audio to check (mode ${mode}). Expected: preview / clips / rank / file\n`);
  process.exit(1);
}

const records = [];
process.stdout.write(`evaluating ${targets.length} clip(s) ...\n`);
for (const target of targets) {
  const record = evaluate(target.file, target.expected, target.id,
    { language: target.language, text: target.text });
  records.push(record);
}

// UTMOS is optional, and it is one model load for the whole batch rather than one
// per clip. An unavailable predictor is reported, never treated as a failure.
let utmosNote = null;
const utmos = runUtmos(targets.map((t) => t.file));
if (utmos === null) {
  utmosNote = 'not available (tools/qw_local_utmos.py is missing)';
} else if (!utmos.ok) {
  utmosNote = `not available (${utmos.error})`;
} else {
  for (const record of records) {
    const value = utmos.byName.get(basename(record.file));
    if (typeof value === 'number') record.utmos = value;
  }
  const missing = records.filter((r) => r.utmos === null).length;
  if (missing > 0) utmosNote = `${missing} clip(s) could not be scored`;
}

annotateBatch(records);

// Report every clip, including the batch-relative verdicts, once they are known.
for (const record of records) {
  const scores = record.omni ?? {};
  const notes = [];
  if (record.netRate !== null) {
    notes.push(`rate ${record.netRate.toFixed(2)} units/s${record.rateOutlier ? ` (${record.rateOutlier})` : ''}`);
  }
  if (typeof record.utmos === 'number') {
    notes.push(`UTMOS ${record.utmos.toFixed(3)}${record.utmosFlag ? ` (${record.utmosFlag})` : ''}`);
  }
  process.stdout.write(
    `${record.id}\n` +
    `  ${record.pass ? 'pass' : 'FAIL'}` +
    `  ASR ${record.asrSimilarity.toFixed(3)}` +
    `  clarity ${scores.clarity ?? '?'}  naturalness ${scores.naturalness ?? '?'}  character ${scores.character ?? '?'}  maturity ${scores.maturity ?? '?'}  cleanliness ${scores.cleanliness ?? '?'}` +
    `  ${record.technical.seconds === null ? '?' : record.technical.seconds.toFixed(2) + 's'}` +
    `  peak ${record.technical.peakDb ?? '?'}dB\n` +
    `    heard: ${record.asrTranscript || '(empty)'}\n` +
    (scores.defects ? `    defect: ${scores.defects}\n` : '') +
    (notes.length ? `    ${notes.join('  ')}\n` : '') +
    (record.failures.length ? `    failed: ${record.failures.join('; ')}\n` : '') +
    (record.asrError ? `    ASR error: ${record.asrError.split('\n').pop()}\n` : '') +
    (record.omniError ? `    Omni error: ${record.omniError.split('\n').pop()}\n` : ''),
  );
}
if (utmosNote !== null) process.stdout.write(`\n  UTMOS ${utmosNote}\n`);

// ── report ────────────────────────────────────────────────────────────────
const lines = [
  '# dsh-status-chime audio quality report',
  '',
  `Generated: ${new Date().toISOString()}`,
  `Scope: ${mode} (${records.length} clip(s))`,
  '',
  `**Hard gates** (a miss fails the clip): ASR character similarity >= ${SIMILARITY_THRESHOLD}; ` +
    `${HARD_DIMENSIONS.join(' / ')} >= ${HARD_DIMENSION_THRESHOLD}; peak <= -0.1 dB; ` +
    `peak >= ${SILENCE_PEAK_FLOOR_DB} dB and mean >= ${SILENCE_MEAN_FLOOR_DB} dB (silence floors).`,
  `**Advisory** (recorded, never failing): ${ADVISORY_DIMENSIONS.join(' / ')} / suitability / defect note / ` +
    'net speech rate / UTMOS.',
  '',
  `Net speech rate is compared against the median of the same language, and clips below ` +
    `${RATE_MIN_UNITS} units are exempt because their rate is too noisy to judge.`,
  'UTMOS is compared against the median of the same language: the predictor scores every ' +
    'English clip above every Chinese one, so a cross-language comparison would be meaningless.',
  utmosNote === null
    ? `UTMOS: scored ${records.filter((r) => typeof r.utmos === 'number').length}/${records.length} clip(s).`
    : `UTMOS: ${utmosNote}.`,
  '',
  '| clip | lang | result | ASR | heard | clarity | naturalness | character | maturity | cleanliness | suitable | length | speech | units/s | UTMOS | peak dB | defect | failed checks |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
];
for (const r of records) {
  const s = r.omni ?? {};
  lines.push(
    `| ${r.id} | ${r.language} | ${r.pass ? 'pass' : 'FAIL'} | ${r.asrSimilarity.toFixed(3)} | ${r.asrTranscript || '(empty)'} | ` +
    `${s.clarity ?? '?'} | ${s.naturalness ?? '?'} | ${s.character ?? '?'} | ${s.maturity ?? '?'} | ${s.cleanliness ?? '?'} | ` +
    `${s.suitable_for_system_alert === undefined ? '?' : s.suitable_for_system_alert ? 'yes' : 'no'} | ` +
    `${r.technical.seconds === null ? '?' : r.technical.seconds.toFixed(2) + 's'} | ` +
    `${r.technical.speechSeconds === null ? '?' : r.technical.speechSeconds.toFixed(2) + 's'} | ` +
    `${r.netRate === null ? '?' : r.netRate.toFixed(2)}${r.rateOutlier ? ` (${r.rateOutlier})` : ''} | ` +
    `${typeof r.utmos === 'number' ? r.utmos.toFixed(3) : '?'}${r.utmosFlag ? ` (${r.utmosFlag})` : ''} | ` +
    `${r.technical.peakDb ?? '?'} | ${String(s.defects ?? '').replace(/\|/g, '/')} | ` +
    `${r.failures.length ? r.failures.join('; ').replace(/\|/g, '/') : '-'} |`,
  );
}
lines.push('', `**Hard gates: ${records.filter((r) => r.pass).length}/${records.length} passed.**`, '');

writeFileSync(reportPath, `${lines.join('\n')}\n`, 'utf8');
writeFileSync(join(QA_DIR, 'records.json'), `${JSON.stringify(records, null, 2)}\n`, 'utf8');
process.stdout.write(`\nreport: ${reportPath}\n`);

process.exit(records.every((r) => r.pass) ? 0 : 2);
