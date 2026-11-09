import { test } from 'node:test';
import * as assert from 'node:assert';
import {
  base58Encode,
  estimateCalls,
  computeWarnings,
  formatNear,
  formatDuration,
  formatChainCountdown
} from '../src/evaluator';

test('base58Encode: matches test vector sha256 hex to base58', () => {
  const hex = '15c2c18000b48ac27d752bd60767b9a1bb4c26a72c46ba2fd2ad9b1ee9aa9cb7';
  const expected = '2Twog5zDCy7gVG2FCUCuve8qLf7WXZsbvCDPigePhqup';
  const bytes = new Uint8Array(hex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  const result = base58Encode(bytes);
  assert.strictEqual(result, expected);
});

test('base58Encode: handles empty input and leading zeros', () => {
  assert.strictEqual(base58Encode(new Uint8Array([])), '');
  assert.strictEqual(base58Encode(new Uint8Array([0, 0, 1])), '112');
});

test('estimateCalls: 0.25 NEAR allowance at 30 TGas attaches', () => {
  const allowance = '250000000000000000000000'; // 0.25 NEAR
  const res = estimateCalls(allowance, 30);
  assert.strictEqual(res.cannotClearGateway, false);
  assert.strictEqual(res.successCalls, 499);
  assert.strictEqual(res.revertCalls, 1377);
  assert.strictEqual(res.reservationNear, '0.0309');
});

test('estimateCalls: 0.25 NEAR allowance at 100 TGas attaches', () => {
  const allowance = '250000000000000000000000'; // 0.25 NEAR
  const res = estimateCalls(allowance, 100);
  assert.strictEqual(res.cannotClearGateway, false);
  assert.strictEqual(res.successCalls, 339);
  assert.strictEqual(res.reservationNear, '0.1009');
});

test('estimateCalls: reports cannot clear gateway when reservation >= allowance', () => {
  const tinyAllowance = '10000000000000000000000'; // 0.01 NEAR (< 0.0309 reservation)
  const res = estimateCalls(tinyAllowance, 30);
  assert.strictEqual(res.cannotClearGateway, true);
  assert.strictEqual(res.summary, 'cannot clear the gateway');
});

test('computeWarnings: detects cap exceeding spendable balance', () => {
  const balance = '10000000000000000000000000'; // 10 NEAR
  const storageUsage = 20000; // (20000 + 10000) * 1e19 = 30000 * 1e19 = 0.3 NEAR -> spendable = 9.7 NEAR
  const state = {
    period_cap: '10000000000000000000000000', // 10 NEAR (> 9.7 spendable)
    guardian: 'guardian.near',
    paused: false,
    has_pending: false,
  };
  const res = computeWarnings(state, balance, storageUsage, 'alice.near', '5000000000000000000000000');
  assert.ok(res.warnings.some(w => w.code === 'CAP_EXCEEDS_SPENDABLE'));
  assert.strictEqual(res.maxLossBeforeDetectionNear, '9.700');
});

test('computeWarnings: detects guardian equals owner', () => {
  const balance = '10000000000000000000000000';
  const state = {
    period_cap: '1000000000000000000000000', // 1 NEAR
    guardian: 'alice.near', // Same as owner
    paused: false,
    has_pending: false,
  };
  const res = computeWarnings(state, balance, 20000, 'alice.near', '5000000000000000000000000');
  assert.ok(res.warnings.some(w => w.code === 'GUARDIAN_EQUALS_OWNER'));
});

test('computeWarnings: detects paused and pending action', () => {
  const balance = '10000000000000000000000000';
  const state = {
    period_cap: '1000000000000000000000000',
    guardian: 'bob.near',
    paused: true,
    has_pending: true,
  };
  const res = computeWarnings(state, balance, 20000, 'alice.near', '5000000000000000000000000');
  assert.ok(res.warnings.some(w => w.code === 'CONTRACT_PAUSED'));
  assert.ok(res.warnings.some(w => w.code === 'PENDING_ACTION'));
});

test('computeWarnings: detects allowance below 20 reservations', () => {
  const balance = '10000000000000000000000000';
  const state = {
    period_cap: '1000000000000000000000000',
    guardian: 'bob.near',
    paused: false,
    has_pending: false,
  };
  // Reservation at 30 TGas = ~0.0309 NEAR. 20 * reservation = ~0.618 NEAR.
  // Allowance of 0.25 NEAR is below 20 reservations.
  const res = computeWarnings(state, balance, 20000, 'alice.near', '250000000000000000000000', 30);
  assert.ok(res.warnings.some(w => w.code === 'LOW_ALLOWANCE'));
});

test('formatNear: formats correctly', () => {
  assert.strictEqual(formatNear('250000000000000000000000', 2), '0.25');
  assert.strictEqual(formatNear('1000000000000000000000000', 1), '1.0');
  assert.strictEqual(formatNear(null), '0.000');
});

test('formatDuration and formatChainCountdown: compute based on chain block time', () => {
  assert.strictEqual(formatDuration(3665), '1h 1m');
  assert.strictEqual(formatDuration(45), '45s');

  const nowNs = 1700000000000000000n;
  const targetNs = nowNs + 3600000000000n; // 1 hour ahead
  const pastNs = nowNs - 1000000000n; // past

  assert.strictEqual(formatChainCountdown(targetNs, nowNs), 'in 1h 0m');
  assert.strictEqual(formatChainCountdown(pastNs, nowNs), 'past / ready');
});
