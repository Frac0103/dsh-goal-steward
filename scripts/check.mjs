/**
 * Syntax gate for the published bundle.
 *
 * The host loads lib/*.js as ESM directly; there is no build step. This script
 * keeps a broken commit from shipping by asking Node itself to parse every file.
 *
 * @module dsh-goal-steward/scripts/check
 */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const libDir = path.join(root, 'lib');

/** Every top-level module in lib/. */
const files = readdirSync(libDir)
  .filter((entry) => entry.endsWith('.js'))
  .sort();

let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', path.join(libDir, file)], { stdio: 'inherit' });
  if (result.status !== 0) {
    failed = true;
    console.error(`check: ${file} failed to parse`);
  }
}

if (failed) process.exit(1);
console.log(`check: ${files.length} modules parse cleanly`);
