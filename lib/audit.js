/**
 * Local audit trail.
 *
 * Every review — including skipped, failed, and budget-exhausted ones — leaves
 * one JSONL record under `$DSH_HOME/goal-steward/audit.jsonl` by default. This is
 * the "L0 record" rung of the escalation ladder: management by exception only
 * works if the exceptions that were *not* raised are still inspectable.
 *
 * Audit writes are best-effort: a governance layer must never fail a turn
 * because a log file could not be appended.
 *
 * @module dsh-goal-steward/audit
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

/** Resolve the audit directory for one config. */
export function resolveAuditDir(config) {
  if (typeof config?.auditDir === 'string' && config.auditDir.length > 0) return config.auditDir;
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.length > 0
    ? process.env.DSH_HOME
    : path.join(homedir(), '.dsh');
  return path.join(home, 'goal-steward');
}

/**
 * Append one audit record. Never throws.
 *
 * @param {import('./config.js').GoalStewardConfig} config resolved config.
 * @param {Record<string, unknown>} record JSON-serializable record.
 * @returns {Promise<string|null>} the audit file path on success, otherwise null.
 */
export async function appendAuditRecord(config, record) {
  if (!config.audit) return null;
  try {
    const dir = resolveAuditDir(config);
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, 'audit.jsonl');
    const line = `${JSON.stringify({ ts: new Date().toISOString(), v: 1, ...record })}\n`;
    await appendFile(file, line, 'utf8');
    return file;
  } catch {
    return null;
  }
}
