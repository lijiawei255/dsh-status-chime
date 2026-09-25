#!/usr/bin/env node
/**
 * sync-profile.mjs — keep a local single-file install identical to this repository.
 *
 * WHY THIS EXISTS
 *   This project is published and self-hosted at the same time: the repository is
 *   what other people install, and it is also what runs on the author's machine.
 *   Those two must not drift, and they are easy to drift. The plugin ships in two
 *   shapes:
 *
 *     bundle shape        `dsh plugin add` installs the package into a profile and
 *                         the package directory stays the source. `assets/clips/`
 *                         sits beside `lib/index.js`, so packaged clips resolve.
 *     single-file shape   one `<name>.js` copied into the profile directory and
 *                         wired in through the profile's `cordis.patch.yml` as
 *                         `name: './<name>.js'`. There is no `assets/` beside it,
 *                         so the third resolution level falls through and the
 *                         clips come from `$DSH_HOME/voice-alerts/clips/` instead.
 *
 *   In the second shape nothing links the installed files back to the repository.
 *   Editing `lib/index.js` changes the bundle but not the running install, and the
 *   install silently keeps an older copy — which is exactly what happened here: the
 *   profile copy was three commits and one host-API migration behind while both
 *   files still claimed the same version number. A version string cannot detect
 *   that; a hash can.
 *
 * WHAT IS MIRRORED, AND WHAT IS DELIBERATELY NOT
 *   Mirrored, byte for byte:
 *     lib/index.js            -> <profile>/<name>.js
 *     assets/clips/**         -> $DSH_HOME/voice-alerts/clips/**
 *     assets/play.ps1         -> $DSH_HOME/voice-alerts/play.ps1
 *
 *   NOT mirrored, because the local copies are authoritative and private:
 *     $DSH_HOME/voice-alerts/clips.json              (the private master: the same
 *                                                     audio, described in wording this
 *                                                     project does not publish)
 *     $DSH_HOME/voice-alerts/voice-alerts.config.json (this machine's settings)
 *
 *   The published `assets/clips.json` is that master with the wording neutralised —
 *   same model, voice, rate, pitch, loudnorm and clip lines, so the shipped audio is
 *   the audio that was actually auditioned. This script therefore does not copy that
 *   file over the private one; it compares the two and prints **which field paths**
 *   differ, never their values, so the expected wording delta is visible without the
 *   private wording ending up anywhere it could be committed. To assert the reverse
 *   direction — "none of the private wording reached the repository" — run
 *   `node scripts/scan-sensitive.mjs .`, which reads its forbidden-word list from
 *   $DSH_HOME/voice-alerts.scan.json, a file that lives outside every clone.
 *
 * WHAT IT REFUSES TO TOUCH
 *   Nothing but the files listed under "mirrored". It never copies `clips.json` or the
 *   config, never reads the profile's `package.json`, and never prints the contents of
 *   `cordis.patch.yml` (it only asks whether that file names the plugin, because an
 *   unreferenced copy is installed but inactive). `--apply` is required to write
 *   anything at all.
 *
 * Usage
 *   node scripts/sync-profile.mjs                       # --check the plugin file
 *   node scripts/sync-profile.mjs --all                 # plugin file + audio assets
 *   node scripts/sync-profile.mjs --all --apply
 *   node scripts/sync-profile.mjs --check --profile desktop --dest C:\path\to\plugin.js
 *
 * Exit codes: 0 parity (or applied), 1 drift or missing destination,
 *             2 bad usage, 3 a manifest field that is not wording differs.
 */

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const SOURCE = join(REPO_ROOT, 'lib', 'index.js');
const ASSET_ROOT = join(REPO_ROOT, 'assets');
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh');
const USER_DIR = join(DSH_HOME, 'voice-alerts');

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i < 0) return undefined;
  const value = process.argv[i + 1];
  if (value === undefined || value.startsWith('--')) {
    process.stderr.write(`usage error: ${flag} needs a value\n`);
    process.exit(2);
  }
  return value;
}

const APPLY = process.argv.includes('--apply');
const WITH_ASSETS = process.argv.includes('--assets') || process.argv.includes('--all');
const PROFILE = argValue('--profile') ?? 'desktop';
/** The name this repository's own single-file installs use. */
const FILE_NAME = argValue('--file') ?? 'dsh-voice-alerts.js';
const DEST = resolve(argValue('--dest') ?? join(DSH_HOME, 'profiles', PROFILE, FILE_NAME));
const PROFILE_DIR = dirname(DEST);

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const describe = (file) => {
  const bytes = statSync(file).size;
  const hash = sha256(file);
  return { bytes, hash, short: `${bytes} B, sha256 ${hash.slice(0, 12)}…` };
};

let drifted = 0;
/** A manifest difference that is NOT wording and that --apply cannot repair. */
let divergent = false;
/** Only the plugin file needs a restart; clips and play.ps1 are read per playback. */
let restartNeeded = false;

// ── the plugin file ───────────────────────────────────────────────────────
function syncPluginFile() {
  if (!existsSync(SOURCE)) {
    process.stderr.write(`the repository file is missing: ${SOURCE}\n`);
    process.exit(2);
  }
  if (!existsSync(DEST)) {
    process.stderr.write(
      `no installed copy at ${DEST}\n`
      + `That path is derived from $DSH_HOME, --profile (${PROFILE}) and --file (${FILE_NAME}).\n`
      + 'Pass --dest <path> if the install lives somewhere else. Nothing was written.\n',
    );
    process.exit(1);
  }

  const source = describe(SOURCE);
  const dest = describe(DEST);

  console.log(`plugin file, repository: ${SOURCE}`);
  console.log(`plugin file, installed:  ${DEST}`);

  /**
   * Is the installed file actually wired into the profile?
   *
   * Checked by name only. The patch itself is a personal file — the one on the
   * machine this was written for contains absolute archive paths — so its contents
   * are never echoed, not even on a mismatch.
   */
  const patch = join(PROFILE_DIR, 'cordis.patch.yml');
  if (!existsSync(patch)) {
    console.log('activation: no cordis.patch.yml beside it');
  } else {
    let text = null;
    try {
      text = readFileSync(patch, 'utf8');
    } catch {
      /* reported as unreadable below */
    }
    console.log(`activation: ${text === null
      ? 'cordis.patch.yml could not be read'
      : text.includes(basename(DEST))
        ? 'referenced by cordis.patch.yml'
        : 'NOT referenced by cordis.patch.yml (installed but inactive)'}`);
  }

  if (source.hash === dest.hash) {
    console.log(`PLUGIN      PARITY   ${source.short}`);
    return;
  }

  drifted += 1;
  console.log(`PLUGIN      DRIFT    repository ${source.short}`);
  console.log(`                     installed  ${dest.short}`);
  if (!APPLY) {
    console.log('                     re-run with --apply to copy it over.');
    return;
  }
  copyFileSync(SOURCE, DEST);
  if (sha256(SOURCE) !== sha256(DEST)) {
    process.stderr.write('the copy does not round-trip; the installed file is NOT in parity\n');
    process.exit(1);
  }
  console.log(`PLUGIN      APPLIED  copied over (${describe(DEST).short})`);
  restartNeeded = true;
}

// ── the audio assets ──────────────────────────────────────────────────────
/** Every file the install reads from `$DSH_HOME/voice-alerts/`, repo-relative. */
function assetFiles() {
  const list = [];
  const clips = join(ASSET_ROOT, 'clips');
  if (existsSync(clips)) {
    for (const name of readdirSync(clips).sort()) {
      const full = join(clips, name);
      if (statSync(full).isFile()) list.push({ source: full, dest: join(USER_DIR, 'clips', name) });
    }
  }
  const ps1 = join(ASSET_ROOT, 'play.ps1');
  if (existsSync(ps1)) list.push({ source: ps1, dest: join(USER_DIR, 'play.ps1') });
  return list;
}

/**
 * Report which field paths two JSON documents disagree on — paths only.
 *
 * Values are never printed. The point of this comparison is the `clips.json` pair,
 * where the difference is expected to be wording and the private wording must not
 * travel through this script's output into a terminal transcript, a log, or an issue.
 */
function differingPaths(a, b, prefix = '', out = []) {
  if (a === b) return out;
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      differingPaths(a[i], b[i], `${prefix}[${i}]`, out);
    }
    return out;
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      differingPaths(a[key], b[key], prefix === '' ? key : `${prefix}.${key}`, out);
    }
    return out;
  }
  out.push(prefix === '' ? '(root)' : prefix);
  return out;
}

/**
 * Field paths whose difference is sanctioned: comments, the audition candidate
 * list, the chosen-candidate name, and the style instruction.
 *
 * Everything else counts as FUNCTIONAL. That direction is deliberate — a field
 * nobody has classified yet is treated as functional, so a new key cannot slip
 * through as "probably just wording".
 */
const isWordingPath = (path) => (
  path.startsWith('_')
  || path === 'instruction'
  || path.startsWith('voiceCandidates')
  || path.startsWith('chosenCandidate')
  || /^languages\.[^.]+\.instruction$/.test(path)
);

/** The private master and its published, neutralised counterpart. */
function compareClipManifests() {
  const published = join(ASSET_ROOT, 'clips.json');
  const privateMaster = join(USER_DIR, 'clips.json');
  if (!existsSync(published) || !existsSync(privateMaster)) {
    console.log('clips.json  SKIP     one of the two manifests is absent');
    return;
  }
  let a;
  let b;
  try {
    a = JSON.parse(readFileSync(published, 'utf8'));
    b = JSON.parse(readFileSync(privateMaster, 'utf8'));
  } catch (error) {
    console.log(`clips.json  SKIP     unreadable manifest (${String(error)})`);
    return;
  }

  const paths = differingPaths(a, b);
  const wording = paths.filter(isWordingPath);
  const functional = paths.filter((path) => !isWordingPath(path));

  if (paths.length === 0) {
    console.log('clips.json  PARITY   the two manifests are identical');
    return;
  }

  console.log(`clips.json  WORDING  ${wording.length} wording path(s) differ (expected),`
    + ` ${functional.length} functional path(s) differ (must be 0)`);
  for (const path of wording.slice(0, 12)) console.log(`                     ${path}`);
  if (wording.length > 12) console.log(`                     … and ${wording.length - 12} more (values never shown)`);

  if (functional.length === 0) {
    console.log('                     the shipped audio, voice and synthesis settings are identical.');
    return;
  }

  console.log('                     NOT A WORDING DELTA — these change what would be generated:');
  for (const path of functional) console.log(`                     ${path}`);
  console.log('                     The published manifest is hand-maintained and --apply never writes it.');
  console.log('                     Decide deliberately which side is right, then edit assets/clips.json.');
  divergent = true;
}

function syncAssets() {
  const pairs = assetFiles();
  if (pairs.length === 0) {
    process.stderr.write(`no assets found under ${ASSET_ROOT}\n`);
    process.exit(2);
  }
  const missing = [];
  const differing = [];
  for (const { source, dest } of pairs) {
    if (!existsSync(dest)) missing.push({ source, dest });
    else if (sha256(source) !== sha256(dest)) differing.push({ source, dest });
  }
  const label = `assets (${pairs.length} file(s))`;
  if (missing.length === 0 && differing.length === 0) {
    console.log(`ASSETS      PARITY   ${label} match ${USER_DIR}`);
  } else {
    drifted += 1;
    console.log(`ASSETS      DRIFT    ${label}: ${missing.length} missing, ${differing.length} differing`);
    for (const { dest } of [...missing, ...differing].slice(0, 8)) {
      console.log(`                     ${relative(USER_DIR, dest)}`);
    }
    if (missing.length + differing.length > 8) {
      console.log(`                     … and ${missing.length + differing.length - 8} more`);
    }
    if (APPLY) {
      for (const { source, dest } of [...missing, ...differing]) {
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(source, dest);
      }
      console.log(`ASSETS      APPLIED  copied ${missing.length + differing.length} file(s)`);
    } else {
      console.log('                     re-run with --apply to copy them over.');
    }
  }
  // Reported either way: it is the one difference this tool exists to keep honest.
  compareClipManifests();
}

// ── run ───────────────────────────────────────────────────────────────────
/** `--assets` alone means assets only; `--all` means both; the default is the plugin file. */
const assetsOnly = process.argv.includes('--assets') && !process.argv.includes('--all');
if (!assetsOnly) syncPluginFile();
if (WITH_ASSETS) {
  if (!assetsOnly) console.log('');
  syncAssets();
}

if (divergent) {
  console.log('\nDIVERGENCE: a manifest field that changes what would be generated differs.');
  console.log('This is not the sanctioned wording delta, and no --apply will resolve it.');
  process.exit(3);
}
if (APPLY && drifted > 0) {
  if (restartNeeded) {
    console.log('\nNow FULLY quit and reopen DeepSeek Harness: the plugin code is not hot-loaded.');
    console.log('Check for the `[voice-alerts] active v…` line afterwards, or run /voice-alerts status.');
  } else {
    console.log('\nAudio assets are read per playback, so no restart is needed for these.');
  }
  process.exit(0);
}
if (drifted > 0) {
  console.log(`\n${drifted} target(s) drifted. Nothing was written; re-run with --apply.`);
  process.exit(1);
}
console.log('\nPARITY: every mirrored target matches the repository.');
