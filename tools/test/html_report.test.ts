import { test } from 'node:test';
import * as assert from 'node:assert';
import { generateVerificationHtml } from '../src/html_report';
import { VerificationResult } from '../src/verifier';

test('html report: generates valid, self-contained HTML with zero runtime scripts', () => {
  const mockResult: VerificationResult = {
    accountId: 'agent.test.near',
    blockHash: '7yHn...abc',
    blockHeight: 142000,
    keysLocked: true,
    hasZeroFullAccessKeys: true,
    hasSingleScopedSpendKey: true,
    codeSha256: 'ca56984d69ab84e6ce0e64d242e0ba91a2ae490b13554dd19b87311919172e04',
    nftVerified: true,
    status: 'LOCKED_AND_VERIFIED',
    failingRules: [],
    details: ['All invariants verified.']
  };

  const html = generateVerificationHtml(mockResult);

  // Invariant 1: Valid HTML structure
  assert.ok(html.startsWith('<!DOCTYPE html>'), 'Must start with <!DOCTYPE html>');
  assert.ok(html.includes('</html>'), 'Must contain closing html tag');

  // Invariant 2: ZERO runtime JS (no <script> tags)
  assert.strictEqual(html.includes('<script'), false, 'Must contain ZERO script tags');
  assert.strictEqual(html.includes('javascript:'), false, 'Must contain NO javascript: URIs');

  // Invariant 3: Contains account and status
  assert.ok(html.includes('agent.test.near'), 'Must include account ID');
  assert.ok(html.includes('KEY STRUCTURE VERIFIED'), 'Must include verified banner copy');
  assert.ok(html.includes('142000'), 'Must include block height');
  assert.ok(html.includes('zero failing rules'), 'Must state zero failing rules');
});

test('html report: safely renders warning state for unverified code hash', () => {
  const warnResult: VerificationResult = {
    accountId: 'agent.test.near',
    blockHash: 'block-123',
    blockHeight: 100,
    keysLocked: true,
    hasZeroFullAccessKeys: true,
    hasSingleScopedSpendKey: true,
    codeSha256: 'ca56984d69ab84e6ce0e64d242e0ba91a2ae490b13554dd19b87311919172e04',
    nftVerified: true,
    status: 'KEYS_LOCKED_CODE_UNVERIFIED',
    failingRules: ['WASM_HASH_MATCH'],
    details: ['Bytecode hash differs from published build.']
  };

  const html = generateVerificationHtml(warnResult);

  assert.ok(html.includes('KEYS LOOK LOCKED, CODE NOT VERIFIED'));
  assert.ok(html.includes('WASM_HASH_MATCH'));
  assert.strictEqual(html.includes('<script'), false);
});

test('html report: escapes untrusted strings against XSS injection', () => {
  const xssResult: VerificationResult = {
    accountId: '<script>alert(1)</script>',
    blockHash: '" onclick="malicious()',
    blockHeight: 999,
    keysLocked: false,
    hasZeroFullAccessKeys: false,
    hasSingleScopedSpendKey: false,
    codeSha256: null,
    nftVerified: false,
    status: 'NOT_LOCKED',
    failingRules: ['<img src=x onerror=alert(2)>'],
    details: ['<script>evil()</script>']
  };

  const html = generateVerificationHtml(xssResult);

  assert.strictEqual(html.includes('<script>alert(1)</script>'), false);
  assert.strictEqual(html.includes('<img src=x'), false);
  assert.strictEqual(html.includes('<script>evil()</script>'), false);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

