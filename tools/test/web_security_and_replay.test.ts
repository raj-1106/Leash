import { test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { evaluateVerification } from '../src/evaluator';

/**
 * Pure banner copy determination function mirroring UI implementation.
 */
export function getBannerCopy(outcomeStatus: string, expectedAgentSha: string | null): { title: string; copy: string } {
  if (outcomeStatus === 'LOCKED_AND_VERIFIED') {
    return {
      title: '✓ LOCKED_AND_VERIFIED',
      copy: 'Keys cannot change. This proves key structure and that the deployed code matches the published build. It does not audit the contract logic. Computed by this page against one RPC provider; re-run leash verify and make repro to check independently.'
    };
  } else if (outcomeStatus === 'KEYS_LOCKED_CODE_UNVERIFIED') {
    return {
      title: '! KEYS_LOCKED_CODE_UNVERIFIED',
      copy: expectedAgentSha === null
        ? 'Keys are supervisory-locked to single spend() FunctionCall key. Published code hash in release.json is null (unreleased tag), so deployed code hash is unverified.'
        : 'Keys are supervisory-locked to single spend() FunctionCall key, but deployed code differs from published build, so code is not verified.'
    };
  } else if (outcomeStatus === 'TESTING_BUILD') {
    return {
      title: '✕ TESTING_BUILD (INSECURE)',
      copy: 'Deployed bytecode exports testing functions (is_testing_build) or matches forbidden testing hashes. Strictly rejected.'
    };
  } else if (outcomeStatus === 'NOT_LOCKED') {
    return {
      title: '✕ NOT_LOCKED',
      copy: 'Account does not satisfy supervisory key locking. FullAccess keys or unauthorized permissions detected.'
    };
  } else {
    return {
      title: '✕ ERROR',
      copy: 'Verification query failed.'
    };
  }
}

/**
 * Sanitizes untrusted strings: removes ANSI escape codes and control characters.
 */
export function sanitizeText(str: string): string {
  if (typeof str !== 'string') return '';
  return str
    .replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Validates replay JSON structure defensively.
 */
export function validateReplayData(raw: any): { valid: boolean; error?: string } {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, error: 'Replay content must be a JSON object' };
  }
  if (!Array.isArray(raw.scenarios)) {
    return { valid: false, error: 'Missing scenarios array in replay data' };
  }
  return { valid: true };
}

test('banner-copy invariant: "Keys cannot change" appears ONLY for LOCKED_AND_VERIFIED', () => {
  const verified = getBannerCopy('LOCKED_AND_VERIFIED', 'hash_123');
  assert.ok(verified.copy.startsWith('Keys cannot change'), 'LOCKED_AND_VERIFIED must lead with "Keys cannot change"');

  const unverifiedNull = getBannerCopy('KEYS_LOCKED_CODE_UNVERIFIED', null);
  assert.strictEqual(unverifiedNull.copy.includes('Keys cannot change'), false);
  assert.ok(unverifiedNull.copy.includes('is null'));

  const unverifiedDiff = getBannerCopy('KEYS_LOCKED_CODE_UNVERIFIED', 'diff_hash');
  assert.strictEqual(unverifiedDiff.copy.includes('Keys cannot change'), false);
  assert.ok(unverifiedDiff.copy.includes('differs'));

  const testing = getBannerCopy('TESTING_BUILD', 'hash_123');
  assert.strictEqual(testing.copy.includes('Keys cannot change'), false);
  assert.ok(testing.copy.includes('Strictly rejected'));

  const notLocked = getBannerCopy('NOT_LOCKED', 'hash_123');
  assert.strictEqual(notLocked.copy.includes('Keys cannot change'), false);
});

test('replay data: validates committed demo-run.sample.json format', () => {
  const samplePath = path.resolve(__dirname, '../../../demo-run.sample.json');
  assert.ok(fs.existsSync(samplePath), 'demo-run.sample.json must exist in repo root');
  const raw = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
  const validation = validateReplayData(raw);
  assert.strictEqual(validation.valid, true);
  assert.ok(raw.scenarios.length >= 3);
});

test('replay data: rejects malformed or missing scenarios array', () => {
  assert.strictEqual(validateReplayData(null).valid, false);
  assert.strictEqual(validateReplayData({}).valid, false);
  assert.strictEqual(validateReplayData({ scenarios: "not-an-array" }).valid, false);
});

test('sanitization: strips ANSI escape codes and control characters from untrusted output', () => {
  const ansiInput = '\u001b[32m✓ Transaction Success\u001b[0m\u001b[1m\x07';
  const clean = sanitizeText(ansiInput);
  assert.strictEqual(clean, '✓ Transaction Success');

  const hostileHtml = '<img src=x onerror=alert(1)>';
  // Sanitization preserves plain text characters (which are safely injected via textContent, never innerHTML)
  const cleanHtml = sanitizeText(hostileHtml);
  assert.strictEqual(cleanHtml, '<img src=x onerror=alert(1)>');
});

test('sanitization: handles huge strings safely', () => {
  const huge = 'A'.repeat(50000);
  const clean = sanitizeText(huge);
  assert.strictEqual(clean.length, 50000);
});
