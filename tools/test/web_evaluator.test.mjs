import { test } from 'node:test';
import * as assert from 'node:assert';
import {
  evaluateVerification,
  base58Encode,
  estimateCalls,
  computeWarnings,
  formatNear,
  formatDuration,
  formatChainCountdown
} from '../../web/evaluator.js';

test('web/evaluator.js parity: verifies compiled ESM evaluator against identical test matrix', () => {
  // Case 1: Happy path -> LOCKED_AND_VERIFIED
  const keys1 = [{
    access_key: {
      permission: {
        FunctionCall: {
          receiver_id: 'agent.near',
          method_names: ['spend'],
          allowance: '250000000000000000000000',
        }
      }
    }
  }];
  const res1 = evaluateVerification({
    accountId: 'agent.near',
    accountKeys: keys1,
    codeSha256: 'hash_abc',
    isTestingWasm: false,
    expectedAgentSha: 'hash_abc',
    nftContractId: 'nft.near',
    nftKeys: [],
    nftCodeSha256: 'nft_hash_123',
    expectedNftSha: 'nft_hash_123',
  });
  assert.strictEqual(res1.status, 'LOCKED_AND_VERIFIED');
  assert.strictEqual(res1.keysLocked, true);
  assert.deepStrictEqual(res1.failingRules, []);

  // Case 2: FullAccess key present -> NOT_LOCKED
  const keys2 = [
    { access_key: { permission: 'FullAccess' } },
    { access_key: { permission: { FunctionCall: { receiver_id: 'agent.near', method_names: ['spend'], allowance: '100' } } } }
  ];
  const res2 = evaluateVerification({
    accountId: 'agent.near',
    accountKeys: keys2,
    codeSha256: 'hash_abc',
    isTestingWasm: false,
    expectedAgentSha: 'hash_abc',
    nftContractId: 'nft.near',
    nftKeys: [],
    nftCodeSha256: 'nft_hash_123',
    expectedNftSha: 'nft_hash_123',
  });
  assert.strictEqual(res2.status, 'NOT_LOCKED');
  assert.ok(res2.failingRules.includes('ZERO_FULL_ACCESS_KEYS'));

  // Case 3: Null published hash -> KEYS_LOCKED_CODE_UNVERIFIED
  const res3 = evaluateVerification({
    accountId: 'agent.near',
    accountKeys: keys1,
    codeSha256: 'hash_abc',
    isTestingWasm: false,
    expectedAgentSha: null,
    nftContractId: 'nft.near',
    nftKeys: [],
    nftCodeSha256: 'nft_hash_123',
    expectedNftSha: 'nft_hash_123',
  });
  assert.strictEqual(res3.status, 'KEYS_LOCKED_CODE_UNVERIFIED');
  assert.ok(res3.failingRules.includes('WASM_HASH_MATCH'));

  // Case 4: Testing build export -> TESTING_BUILD
  const res4 = evaluateVerification({
    accountId: 'agent.near',
    accountKeys: keys1,
    codeSha256: 'hash_abc',
    isTestingWasm: true,
    expectedAgentSha: 'hash_abc',
    nftContractId: 'nft.near',
    nftKeys: [],
    nftCodeSha256: 'nft_hash_123',
    expectedNftSha: 'nft_hash_123',
  });
  assert.strictEqual(res4.status, 'TESTING_BUILD');
  assert.ok(res4.failingRules.includes('FORBIDDEN_TESTING_BUILD'));

  // Case 5: Hash mismatch -> KEYS_LOCKED_CODE_UNVERIFIED
  const res5 = evaluateVerification({
    accountId: 'agent.near',
    accountKeys: keys1,
    codeSha256: 'hash_different',
    isTestingWasm: false,
    expectedAgentSha: 'hash_abc',
    nftContractId: 'nft.near',
    nftKeys: [],
    nftCodeSha256: 'nft_hash_123',
    expectedNftSha: 'nft_hash_123',
  });
  assert.strictEqual(res5.status, 'KEYS_LOCKED_CODE_UNVERIFIED');
  assert.ok(res5.failingRules.includes('WASM_HASH_MATCH'));

  // Case 6: NFT with keys -> KEYS_LOCKED_CODE_UNVERIFIED
  const res6 = evaluateVerification({
    accountId: 'agent.near',
    accountKeys: keys1,
    codeSha256: 'hash_abc',
    isTestingWasm: false,
    expectedAgentSha: 'hash_abc',
    nftContractId: 'nft.near',
    nftKeys: [{ access_key: { permission: 'FullAccess' } }],
    nftCodeSha256: 'nft_hash_123',
    expectedNftSha: 'nft_hash_123',
  });
  assert.strictEqual(res6.status, 'KEYS_LOCKED_CODE_UNVERIFIED');
  assert.ok(res6.failingRules.includes('NFT_ZERO_KEYS'));
});

test('web/evaluator.js parity: verifies pure helpers in ESM build', () => {
  // Base58 test vector
  const hex = '15c2c18000b48ac27d752bd60767b9a1bb4c26a72c46ba2fd2ad9b1ee9aa9cb7';
  const expected = '2Twog5zDCy7gVG2FCUCuve8qLf7WXZsbvCDPigePhqup';
  const bytes = new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
  assert.strictEqual(base58Encode(bytes), expected);

  // estimateCalls 30 Tgas
  const est30 = estimateCalls('250000000000000000000000', 30);
  assert.strictEqual(est30.successCalls, 499);
  assert.strictEqual(est30.revertCalls, 1377);

  // estimateCalls 100 Tgas
  const est100 = estimateCalls('250000000000000000000000', 100);
  assert.strictEqual(est100.successCalls, 339);

  // computeWarnings
  const warn = computeWarnings(
    { period_cap: '10000000000000000000000000', guardian: 'alice.near', paused: true, has_pending: true },
    '10000000000000000000000000',
    20000,
    'alice.near',
    '250000000000000000000000',
    30
  );
  assert.ok(warn.warnings.some(w => w.code === 'CAP_EXCEEDS_SPENDABLE'));
  assert.ok(warn.warnings.some(w => w.code === 'GUARDIAN_EQUALS_OWNER'));
  assert.ok(warn.warnings.some(w => w.code === 'CONTRACT_PAUSED'));
  assert.ok(warn.warnings.some(w => w.code === 'PENDING_ACTION'));
  assert.ok(warn.warnings.some(w => w.code === 'LOW_ALLOWANCE'));
});
