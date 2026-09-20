/**
 * Reverse-verification harness for scripts/scan-sensitive.mjs.
 *
 * A scanner that reports "clean" proves nothing on its own: it would report the
 * same thing if its rules never matched anything. This harness plants values the
 * scanner is supposed to catch, runs it, and asserts the outcome — and it also
 * checks the properties that make the report safe to share.
 *
 * The planted strings are assembled from fragments at runtime rather than written
 * literally, so this file contains no real-looking credential and cannot trip a
 * secret scanner that inspects command arguments.
 *
 * Run:  node scripts/scan-sensitive.verify.mjs
 * Exit: 0 when the scanner behaves correctly, 1 otherwise.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCANNER = resolve(HERE, 'scan-sensitive.mjs');

const parts = {
  prefix: 's' + 'k-',
  body: 'FAKE' + 'notareal' + 'key123456',
  tokenPrefix: 'g' + 'hp_',
  tokenBody: 'FAKE' + 'notareal' + 'token1234567890',
  user: 'some' + 'one',
  mail: 'real' + '.' + 'person' + '@' + 'somewhere' + '.' + 'org',
};

const sandbox = mkdtempSync(join(tmpdir(), 'scan-verify-'));
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

const LEAK = [
  `const apiKey = '${parts.prefix}${parts.body}';`,
  `const token  = '${parts.tokenPrefix}${parts.tokenBody}';`,
  `const email  = '${parts.mail}';`,
  `const path   = 'C:\\Users\\${parts.user}\\secret';`,
].join('\n');

const SAFE = [
  "const host = 'localhost';",
  "const ip   = '127.0.0.1';",
  "const doc  = 'example.com';",
].join('\n');

// Recursion: a nested file must be found, not just the top level.
mkdirSync(join(sandbox, 'nested', 'deeper'), { recursive: true });
writeFileSync(join(sandbox, 'leak.js'), LEAK, 'utf8');
writeFileSync(join(sandbox, 'ok.js'), SAFE, 'utf8');
writeFileSync(join(sandbox, 'nested', 'deeper', 'buried.js'),
  `const k = '${parts.prefix}${parts.body}';`, 'utf8');

// Skipped directories: node_modules must be ignored even though it contains a leak.
mkdirSync(join(sandbox, 'node_modules'), { recursive: true });
writeFileSync(join(sandbox, 'node_modules', 'ignored.js'), LEAK, 'utf8');

console.log(`scanner: ${SCANNER}`);
console.log(`sandbox: ${sandbox}\n`);

const run = spawnSync(process.execPath, [SCANNER, sandbox], { encoding: 'utf8', windowsHide: true });
const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
console.log(out.trimEnd());
console.log('');

check('exits non-zero when secrets are present', run.status === 2, `exit=${run.status}`);
check('detects the planted key-shaped value', /API_KEY_SHAPE/.test(out));
check('detects the planted token-shaped value', /GITHUB_TOKEN/.test(out));
check('detects the planted email address', /EMAIL/.test(out));
check('detects the planted Windows user path', /WINDOWS_USER_PATH/.test(out));
check('recurses into subdirectories', /buried\.js/.test(out), 'buried.js should be listed');
// Assert on the file that should NOT appear, not on the word "node_modules", which
// legitimately shows up in the scanner's own "skipping directories" banner.
check('skips node_modules', !/ignored\.js/.test(out), 'ignored.js must not be scanned');
check('allow-lists localhost / 127.0.0.1 / example.com', !/ok\.js/.test(out), 'ok.js must not be flagged');

// The property that makes the output safe to paste anywhere.
check('never echoes the matched text',
  !out.includes(`${parts.prefix}${parts.body}`) && !out.includes(parts.mail),
  'report must contain categories and line numbers only');

// And a clean tree must come back clean with a zero exit.
const clean = mkdtempSync(join(tmpdir(), 'scan-clean-'));
writeFileSync(join(clean, 'fine.js'), 'const x = 1; // nothing sensitive here', 'utf8');
const cleanRun = spawnSync(process.execPath, [SCANNER, clean], { encoding: 'utf8', windowsHide: true });
check('exits 0 on a clean tree', cleanRun.status === 0, `exit=${cleanRun.status}`);
check('reports "clean" on a clean tree', /clean/.test(cleanRun.stdout ?? ''));

rmSync(sandbox, { recursive: true, force: true });
rmSync(clean, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
console.log(`\n==== ${results.length - failed.length}/${results.length} checks passed ====`);
if (failed.length) {
  console.log('failures:');
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
}
process.exit(failed.length === 0 ? 0 : 1);
