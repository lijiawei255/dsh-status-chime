#!/usr/bin/env node
/**
 * scan-sensitive.mjs — a pre-commit privacy check for this repository.
 *
 * Two rule sets are applied:
 *   1. Generic credential and identity shapes (API keys, tokens, private keys,
 *      emails, ID and phone shapes) plus local path patterns.
 *   2. Optional project-specific rules, read from
 *      $DSH_HOME/voice-alerts.scan.json when such a file exists:
 *        { "keywords": [{ "value": "literal to flag", "category": "LABEL" }],
 *          "patterns": [{ "pattern": "regex", "category": "LABEL" }],
 *          "exclude":  ["allow-listed literal"] }
 *      That lets someone check for strings private to their own machine without
 *      ever committing those strings here.
 *
 * It reports **only a file, a line number and a category**. The matched text is
 * deliberately never printed, so running the scan cannot become a second copy of
 * whatever it found.
 *
 * Usage
 *   node scripts/scan-sensitive.mjs [directory]     (default: the repository root)
 *
 * Exit code 0 when clean, 2 when anything matched.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh');

/** Optional project-local rules. Never required, and never committed. */
const LOCAL_RULES = join(DSH_HOME, 'voice-alerts.scan.json');

const TARGET = resolve(process.argv[2] ?? join(HERE, '..'));

/** Text extensions worth reading. */
const TEXT_EXTENSIONS = /\.(js|mjs|cjs|ts|py|ps1|psm1|json|md|yml|yaml|txt|sh)$/i;

/** Generated, downloaded, or irrelevant directories. */
const SKIP_DIRECTORIES = new Set([
  'node_modules', '.git', 'preview', 'tmp', 'qa', '__pycache__', '.venv', 'venv',
]);

/**
 * Built-in rules. Categories are deliberately coarse: the point is to say what
 * kind of thing was found and where, not to reproduce it.
 */
const BUILTIN_RULES = [
  { category: 'API_KEY_SHAPE', re: /\bsk-[A-Za-z0-9_-]{8,}/g },
  { category: 'GITHUB_TOKEN', re: /\bgh[opsru]_[A-Za-z0-9]{16,}/g },
  { category: 'AWS_ACCESS_KEY', re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { category: 'SLACK_TOKEN', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { category: 'PRIVATE_KEY', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { category: 'GOOGLE_KEY', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { category: 'HF_TOKEN', re: /\bhf_[A-Za-z0-9]{30,}/g },
  { category: 'BEARER_LITERAL', re: /\bBearer\s+[A-Za-z0-9._-]{20,}/g },
  { category: 'EMAIL', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { category: 'CN_PHONE', re: /\b1[3-9]\d{9}\b/g },
  { category: 'LONG_ID_NUMBER', re: /\b(?:19|20)\d{2}\d{6,10}\b/g },
  // Machine-specific traces that are easy to commit by accident.
  { category: 'WINDOWS_USER_PATH', re: /[A-Za-z]:\\Users\\[^\\\s"']+/g },
  { category: 'WINDOWS_HOME', re: /[A-Za-z]:\\Users\\[A-Za-z0-9._-]+/g },
  { category: 'POSIX_HOME_PATH', re: /\/(?:home|Users)\/[A-Za-z0-9._-]+\//g },
  { category: 'CLOUD_WORKSPACE_ID', re: /\bws-[a-z0-9]{10,}\b/g },
];

/** Literals known to be safe, so they do not keep tripping the scan. */
function loadExcludes() {
  const excludes = new Set(['localhost', '127.0.0.1', 'example.com', 'example.org']);
  if (!existsSync(LOCAL_RULES)) return excludes;
  try {
    const raw = JSON.parse(readFileSync(LOCAL_RULES, 'utf8'));
    for (const value of raw.exclude ?? []) {
      if (typeof value === 'string') excludes.add(value.toLowerCase());
    }
  } catch (error) {
    process.stderr.write(`note: could not read ${LOCAL_RULES}: ${String(error)}\n`);
  }
  return excludes;
}

/** Built-in rules plus any project-local ones. */
function loadRules() {
  const rules = BUILTIN_RULES.map((rule) => ({ ...rule, source: 'builtin' }));
  if (!existsSync(LOCAL_RULES)) return rules;
  try {
    const raw = JSON.parse(readFileSync(LOCAL_RULES, 'utf8'));
    for (const entry of raw.keywords ?? []) {
      if (typeof entry?.value !== 'string' || entry.value.length === 0) continue;
      const escaped = entry.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      rules.push({
        category: String(entry.category ?? 'LOCAL_KEYWORD'),
        re: new RegExp(escaped, 'gi'),
        source: 'local',
      });
    }
    for (const entry of raw.patterns ?? []) {
      if (typeof entry?.pattern !== 'string' || entry.pattern.length === 0) continue;
      try {
        rules.push({
          category: String(entry.category ?? 'LOCAL_PATTERN'),
          re: new RegExp(entry.pattern, 'g'),
          source: 'local',
        });
      } catch (error) {
        process.stderr.write(`note: skipped an invalid local pattern (${entry.category}): ${String(error)}\n`);
      }
    }
  } catch (error) {
    process.stderr.write(`note: could not read ${LOCAL_RULES}: ${String(error)}\n`);
  }
  return rules;
}

function walk(directory, collected = []) {
  for (const name of readdirSync(directory)) {
    const full = join(directory, name);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(name)) walk(full, collected);
    } else if (TEXT_EXTENSIONS.test(name)) {
      collected.push(full);
    }
  }
  return collected;
}

const rules = loadRules();
const excludes = loadExcludes();
const files = walk(TARGET);

console.log(`scanning ${files.length} text file(s) under ${TARGET}`);
console.log(`skipping directories: ${[...SKIP_DIRECTORIES].join(', ')}`);
console.log(
  `rules: ${rules.filter((r) => r.source === 'builtin').length} built-in`
  + ` + ${rules.filter((r) => r.source === 'local').length} local`
  + (existsSync(LOCAL_RULES) ? '' : ` (no local rule file at ${LOCAL_RULES})`),
);
console.log('');

let hits = 0;
const byCategory = new Map();

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const rule of rules) {
      rule.re.lastIndex = 0;
      const match = rule.re.exec(line);
      if (match === null) continue;
      // Honour the allow-list without ever echoing what matched.
      if (match[0] && excludes.has(match[0].toLowerCase())) continue;
      hits += 1;
      byCategory.set(rule.category, (byCategory.get(rule.category) ?? 0) + 1);
      // Category and location only; the matched text is not printed.
      console.log(`  ${relative(TARGET, file)}:${index + 1}  ->  ${rule.category}`);
      break;
    }
  });
}

console.log(`\n${hits} match(es) total`);
if (byCategory.size > 0) {
  console.log('by category:');
  for (const [category, count] of [...byCategory].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${category}: ${count}`);
  }
  process.exit(2);
}
console.log('clean');
process.exit(0);
