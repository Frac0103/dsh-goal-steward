#!/usr/bin/env node
/**
 * Print the CHANGELOG section for one release tag.
 *
 * The release workflow pipes this into `gh release create --notes-file`, so the
 * published release notes are the curated changelog entry instead of a
 * generated commit list.
 *
 * Usage: node scripts/release-notes.mjs v0.2.0-alpha.9
 */

import { readFileSync } from 'node:fs';

const tag = process.argv[2];
if (typeof tag !== 'string' || tag.length === 0) {
  console.error('release-notes: usage: node scripts/release-notes.mjs <tag>');
  process.exit(1);
}

const version = tag.replace(/^v/, '');
const lines = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8').split('\n');
const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
if (start === -1) {
  console.error(`release-notes: no CHANGELOG section for ${version}`);
  process.exit(1);
}
let end = lines.findIndex((line, index) => index > start && line.startsWith('## ['));
if (end === -1) end = lines.length;

const notes = lines.slice(start, end).join('\n').trimEnd();
process.stdout.write(`${notes}\n`);
