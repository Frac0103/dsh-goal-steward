#!/usr/bin/env node
/**
 * Documentation link gate.
 *
 * The project is documentation-heavy (design / architecture / testing / theory /
 * verification notes). A broken relative link or a stale `#anchor` is a real
 * regression for readers even though no test exercises it. This script walks
 * every tracked markdown file and validates:
 *
 *   1. relative file links resolve to an existing file;
 *   2. same-repo `#fragment` links resolve to a heading in the target document
 *      (GitHub-style slugs: lowercase, punctuation stripped, spaces → hyphens);
 *   3. image references resolve too.
 *
 * External URLs are not fetched (the gate must work offline and in CI); only
 * same-repository paths are checked.
 *
 * @module scripts/check-docs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git']);
const LINK_PATTERN = /!?\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+"[^"]*")?\s*\)/g;

/** @returns {string[]} every markdown file under the repository root. */
function markdownFiles(dir = root, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) markdownFiles(full, out);
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

/** GitHub-style heading slug. */
function slug(text) {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/<[^>]+>/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

/** All heading and explicit HTML anchors of one markdown file (cached by caller). */
function anchorsOf(file, cache) {
  if (cache.has(file)) return cache.get(file);
  const anchors = new Set();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (match !== null) anchors.add(slug(match[1]));
    // Generated documents (docs/theory.md) use explicit anchors instead of
    // relying on the platform's heading slugger.
    const explicit = /<a\s+(?:id|name)="([^"]+)"/g;
    let anchor;
    while ((anchor = explicit.exec(line)) !== null) anchors.add(anchor[1]);
  }
  cache.set(file, anchors);
  return anchors;
}

/** Whether `target` is an external / non-checkable link. */
function isExternal(target) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target);
}

const cache = new Map();
const errors = [];
/** @type {Map<string, {file: string, line: number, target: string, reason: string}[]>} */
const report = new Map();

for (const file of markdownFiles()) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    LINK_PATTERN.lastIndex = 0;
    let match;
    while ((match = LINK_PATTERN.exec(line)) !== null) {
      let target = match[2];
      if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
      if (target.length === 0 || isExternal(target) || target.startsWith('#')) {
        if (target.startsWith('#')) {
          const anchor = target.slice(1);
          const relative = path.relative(root, file);
          const anchors = anchorsOf(file, cache);
          if (anchor.length > 0 && !anchors.has(anchor)) {
            errors.push({ file: relative, line: index + 1, target, reason: `missing anchor in this file: ${anchor}` });
          }
        }
        continue;
      }
      const [targetPath, fragment] = target.split('#');
      const resolved = path.resolve(path.dirname(file), decodeURIComponent(targetPath));
      const relative = path.relative(root, file);
      let stats;
      try {
        stats = statSync(resolved);
      } catch {
        errors.push({ file: relative, line: index + 1, target, reason: 'missing file' });
        continue;
      }
      if (fragment !== undefined && fragment.length > 0) {
        if (!resolved.endsWith('.md') || !stats.isFile()) {
          errors.push({ file: relative, line: index + 1, target, reason: 'anchor on a non-markdown target' });
          continue;
        }
        const anchors = anchorsOf(resolved, cache);
        if (!anchors.has(fragment)) {
          errors.push({ file: relative, line: index + 1, target, reason: `missing anchor: ${fragment}` });
        }
      }
    }
  });
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`check-docs: ${error.file}:${error.line} ${error.reason} — ${error.target}`);
  }
  console.error(`check-docs: ${errors.length} broken link${errors.length === 1 ? '' : 's'}`);
  process.exit(1);
}

console.log(`check-docs: ${markdownFiles().length} markdown files, all relative links and anchors resolve`);
