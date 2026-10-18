import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig } from '../lib/config.js';

test('zero config resolves to the standard preset', () => {
  const config = resolveConfig(undefined);
  assert.equal(config.enabled, true);
  assert.equal(config.preset, 'standard');
  assert.equal(config.reviewEveryTurns, 3);
  assert.equal(config.steerSeverity, 2);
});

test('a preset changes the governance intensity', () => {
  assert.equal(resolveConfig({ preset: 'gentle' }).reviewEveryTurns, 0);
  assert.equal(resolveConfig({ preset: 'gentle' }).steerSeverity, 3);
  assert.equal(resolveConfig({ preset: 'strict' }).reviewEveryTurns, 1);
  assert.equal(resolveConfig({ preset: 'strict' }).steerSeverity, 1);
});

test('individual fields override the preset', () => {
  const config = resolveConfig({ preset: 'gentle', steerSeverity: 2, maxTurnGap: 4 });
  assert.equal(config.steerSeverity, 2);
  assert.equal(config.maxTurnGap, 4);
  assert.equal(config.reviewEveryTurns, 0);
});

test('an unknown preset falls back to standard', () => {
  assert.equal(resolveConfig({ preset: 'tyrannical' }).preset, 'standard');
});

test('numbers are clamped and garbage is dropped', () => {
  const config = resolveConfig({
    maxReviewTokens: 5,
    timeoutMs: 'soon',
    temperature: 99,
    steerSeverity: -3,
  });
  assert.equal(config.maxReviewTokens, 64);
  assert.equal(config.timeoutMs, 45_000);
  assert.equal(config.temperature, 2);
  assert.equal(config.steerSeverity, 0);
});

test('unknown keys do not leak into the resolved config', () => {
  const config = resolveConfig({ futureFlag: true });
  assert.equal('futureFlag' in config, false);
  assert.equal(Object.isFrozen(config), true);
});

test('reviewEveryTurns: 0 survives resolution', () => {
  assert.equal(resolveConfig({ reviewEveryTurns: 0 }).reviewEveryTurns, 0);
});
