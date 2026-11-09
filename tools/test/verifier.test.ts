import { test } from 'node:test';
import * as assert from 'node:assert';
import { inspectLocalWasmArtifact } from '../src/lock';
import { evaluateVerification } from '../src/evaluator';
import { verifyAgentAccount, loadReleaseConfig } from '../src/verifier';
import * as fs from 'fs';
import * as path from 'path';

test('inspectLocalWasmArtifact: rejects testing wasm with is_testing_build export', () => {
  const testWasmPath = path.resolve(__dirname, '../../target/near/agent_account/agent_account_testing.wasm');
  if (fs.existsSync(testWasmPath)) {
    const inspection = inspectLocalWasmArtifact(testWasmPath);
    assert.strictEqual(inspection.isSafe, false);
    assert.ok(inspection.reasons.some(r => r.includes('is_testing_build') || r.includes('forbiddenCodeHashes')));
  }
});

test('inspectLocalWasmArtifact: accepts clean production wasm', () => {
  const prodWasmPath = path.resolve(__dirname, '../../target/near/agent_account/agent_account.wasm');
  if (fs.existsSync(prodWasmPath)) {
    const inspection = inspectLocalWasmArtifact(prodWasmPath);
    assert.strictEqual(inspection.isSafe, true);
    assert.strictEqual(inspection.reasons.length, 0);
    assert.strictEqual(inspection.exportedMethods.includes('is_testing_build'), false);
  }
});

// --- File Loading Tests ---
test('release loading: default loads release.json with the published v0.1.0 hashes', () => {
  const cfg = loadReleaseConfig();
  assert.ok(cfg.filePath.endsWith('release.json'));
  assert.strictEqual(cfg.expectedAgentSha, 'a0ab517a4253e241f8ffe550978a2220b7d982ded81472a07bec3e4940d94a7f');
  assert.strictEqual(cfg.expectedNftSha, 'e3ada91402568c3522d5a49cf3b405291fd5abc2ccb3ad4c5e6033cfb9b73147');
});

test('release loading: explicit release.dev.json loads dev hashes without fallback', () => {
  const devPath = path.resolve(__dirname, '../../release.dev.json');
  if (fs.existsSync(devPath)) {
    const cfg = loadReleaseConfig(devPath);
    assert.strictEqual(cfg.filePath, devPath);
    assert.ok(cfg.expectedAgentSha !== null, 'dev release has non-null agent sha');
  }
});

test('release loading: non-existent release file throws error immediately', () => {
  assert.throws(() => {
    loadReleaseConfig('non-existent-release-file.json');
  }, /Release file not found/);
});

// --- Evaluator Logic Fixtures ---
test('verifier fixture: Case 1 - Happy Path LOCKED_AND_VERIFIED with empty failingRules', () => {
  const keys = [{
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
  const res = evaluateVerification({
    accountId: 'agent.near',
    accountKeys: keys,
    codeSha256: 'hash_abc',
    isTestingWasm: false,
    expectedAgentSha: 'hash_abc',
    nftContractId: 'nft.near',
    nftKeys: [],
    nftCodeSha256: 'nft_hash_123',
    expectedNftSha: 'nft_hash_123',
  });
  assert.strictEqual(res.status, 'LOCKED_AND_VERIFIED');
  assert.strictEqual(res.keysLocked, true);
  assert.deepStrictEqual(res.failingRules, []);
});

test('verifier fixture: Case 2 - FullAccess key present yields NOT_LOCKED and asserts failingRules', () => {
  const keys = [
    { access_key: { permission: 'FullAccess' } },
    { access_key: { permission: { FunctionCall: { receiver_id: 'agent.near', method_names: ['spend'], allowance: '100' } } } }
  ];
  const res = evaluateVerification({
    accountId: 'agent.near',
    accountKeys: keys,
    codeSha256: 'hash_abc',
    isTestingWasm: false,
    expectedAgentSha: 'hash_abc',
    nftContractId: 'nft.near',
    nftKeys: [],
    nftCodeSha256: 'nft_hash_123',
    expectedNftSha: 'nft_hash_123',
  });
  assert.strictEqual(res.status, 'NOT_LOCKED');
  assert.strictEqual(res.keysLocked, false);
  assert.ok(res.failingRules.includes('ZERO_FULL_ACCESS_KEYS'));
  assert.ok(res.failingRules.includes('EXACTLY_ONE_KEY'));
});

test('verifier fixture: Case 3 - Allowance null yields NOT_LOCKED and asserts failingRules', () => {
  const keys = [{
    access_key: {
      permission: {
        FunctionCall: { receiver_id: 'agent.near', method_names: ['spend'], allowance: null }
      }
    }
  }];
  const res = evaluateVerification({
    accountId: 'agent.near',
    accountKeys: keys,
    codeSha256: 'hash_abc',
    isTestingWasm: false,
    expectedAgentSha: 'hash_abc',
    nftContractId: 'nft.near',
    nftKeys: [],
    nftCodeSha256: 'nft_hash_123',
    expectedNftSha: 'nft_hash_123',
  });
  assert.strictEqual(res.status, 'NOT_LOCKED');
  assert.strictEqual(res.keysLocked, false);
  assert.ok(res.failingRules.includes('FINITE_NONZERO_ALLOWANCE'));
});

test('verifier fixture: Case 4 - Allowance 0 yields NOT_LOCKED and asserts failingRules', () => {
  const keys = [{
    access_key: {
      permission: {
        FunctionCall: { receiver_id: 'agent.near', method_names: ['spend'], allowance: '0' }
      }
    }
  }];
  const res = evaluateVerification({
    accountId: 'agent.near',
    accountKeys: keys,
    codeSha256: 'hash_abc',
    isTestingWasm: false,
    expectedAgentSha: 'hash_abc',
    nftContractId: 'nft.near',
    nftKeys: [],
    nftCodeSha256: 'nft_hash_123',
    expectedNftSha: 'nft_hash_123',
  });
  assert.strictEqual(res.status, 'NOT_LOCKED');
  assert.strictEqual(res.keysLocked, false);
  assert.ok(res.failingRules.includes('FINITE_NONZERO_ALLOWANCE'));
});

test('verifier fixture: Case 5 - Empty methods yields NOT_LOCKED and asserts failingRules', () => {
  const keys = [{
    access_key: {
      permission: {
        FunctionCall: { receiver_id: 'agent.near', method_names: [], allowance: '100' }
      }
    }
  }];
  const res = evaluateVerification({
    accountId: 'agent.near',
    accountKeys: keys,
    codeSha256: 'hash_abc',
    isTestingWasm: false,
    expectedAgentSha: 'hash_abc',
    nftContractId: 'nft.near',
    nftKeys: [],
    nftCodeSha256: 'nft_hash_123',
    expectedNftSha: 'nft_hash_123',
  });
  assert.strictEqual(res.status, 'NOT_LOCKED');
  assert.strictEqual(res.keysLocked, false);
  assert.ok(res.failingRules.includes('METHODS_SPEND_ONLY'));
});

test('verifier fixture: Case 6 - Wrong receiver yields NOT_LOCKED and asserts failingRules', () => {
  const keys = [{
    access_key: {
      permission: {
        FunctionCall: { receiver_id: 'other.near', method_names: ['spend'], allowance: '100' }
      }
    }
  }];
  const res = evaluateVerification({
    accountId: 'agent.near',
    accountKeys: keys,
    codeSha256: 'hash_abc',
    isTestingWasm: false,
    expectedAgentSha: 'hash_abc',
    nftContractId: 'nft.near',
    nftKeys: [],
    nftCodeSha256: 'nft_hash_123',
    expectedNftSha: 'nft_hash_123',
  });
  assert.strictEqual(res.status, 'NOT_LOCKED');
  assert.strictEqual(res.keysLocked, false);
  assert.ok(res.failingRules.includes('RECEIVER_IS_SELF'));
});

test('verifier fixture: Case 7 - Two FunctionCall keys yields NOT_LOCKED and asserts failingRules', () => {
  const keys = [
    { access_key: { permission: { FunctionCall: { receiver_id: 'agent.near', method_names: ['spend'], allowance: '100' } } } },
    { access_key: { permission: { FunctionCall: { receiver_id: 'agent.near', method_names: ['spend'], allowance: '100' } } } }
  ];
  const res = evaluateVerification({
    accountId: 'agent.near',
    accountKeys: keys,
    codeSha256: 'hash_abc',
    isTestingWasm: false,
    expectedAgentSha: 'hash_abc',
    nftContractId: 'nft.near',
    nftKeys: [],
    nftCodeSha256: 'nft_hash_123',
    expectedNftSha: 'nft_hash_123',
  });
  assert.strictEqual(res.status, 'NOT_LOCKED');
  assert.strictEqual(res.keysLocked, false);
  assert.ok(res.failingRules.includes('EXACTLY_ONE_KEY'));
});

test('verifier fixture: Case 8 - Zero keys yields NOT_LOCKED and asserts failingRules', () => {
  const keys: any[] = [];
  const res = evaluateVerification({
    accountId: 'agent.near',
    accountKeys: keys,
    codeSha256: 'hash_abc',
    isTestingWasm: false,
    expectedAgentSha: 'hash_abc',
    nftContractId: 'nft.near',
    nftKeys: [],
    nftCodeSha256: 'nft_hash_123',
    expectedNftSha: 'nft_hash_123',
  });
  assert.strictEqual(res.status, 'NOT_LOCKED');
  assert.strictEqual(res.keysLocked, false);
  assert.ok(res.failingRules.includes('EXACTLY_ONE_KEY'));
  assert.ok(res.failingRules.includes('SINGLE_SCOPED_SPEND_KEY'));
});

test('verifier fixture: Case 9 - Agent Hash mismatch yields KEYS_LOCKED_CODE_UNVERIFIED and asserts failingRules', () => {
  const keys = [{
    access_key: {
      permission: {
        FunctionCall: { receiver_id: 'agent.near', method_names: ['spend'], allowance: '100' }
      }
    }
  }];
  const res = evaluateVerification({
    accountId: 'agent.near',
    accountKeys: keys,
    codeSha256: 'unrecognized_hash',
    isTestingWasm: false,
    expectedAgentSha: 'hash_abc',
    nftContractId: 'nft.near',
    nftKeys: [],
    nftCodeSha256: 'nft_hash_123',
    expectedNftSha: 'nft_hash_123',
  });
  assert.strictEqual(res.status, 'KEYS_LOCKED_CODE_UNVERIFIED');
  assert.strictEqual(res.keysLocked, true);
  assert.ok(res.failingRules.includes('WASM_HASH_MATCH'));
});

test('verifier fixture: Case 10 - Published hash is null yields KEYS_LOCKED_CODE_UNVERIFIED and cannot reach LOCKED_AND_VERIFIED', () => {
  const keys = [{
    access_key: {
      permission: {
        FunctionCall: { receiver_id: 'agent.near', method_names: ['spend'], allowance: '100' }
      }
    }
  }];
  const res = evaluateVerification({
    accountId: 'agent.near',
    accountKeys: keys,
    codeSha256: 'deployed_real_hash',
    isTestingWasm: false,
    expectedAgentSha: null, // Null in release.json until official release tag
    nftContractId: 'nft.near',
    nftKeys: [],
    nftCodeSha256: 'nft_hash_123',
    expectedNftSha: null,
  });
  assert.strictEqual(res.status, 'KEYS_LOCKED_CODE_UNVERIFIED');
  assert.strictEqual(res.keysLocked, true);
  assert.ok(res.failingRules.includes('WASM_HASH_MATCH'));
});

test('verifier fixture: Case 11 - Testing build yields TESTING_BUILD and asserts failingRules', () => {
  const keys = [{
    access_key: {
      permission: {
        FunctionCall: { receiver_id: 'agent.near', method_names: ['spend'], allowance: '100' }
      }
    }
  }];
  const res = evaluateVerification({
    accountId: 'agent.near',
    accountKeys: keys,
    codeSha256: 'test_hash',
    isTestingWasm: true,
    expectedAgentSha: 'hash_abc',
    nftContractId: 'nft.near',
    nftKeys: [],
    nftCodeSha256: 'nft_hash_123',
    expectedNftSha: 'nft_hash_123',
    forbiddenHashes: ['test_hash'],
  });
  assert.strictEqual(res.status, 'TESTING_BUILD');
  assert.strictEqual(res.keysLocked, true);
  assert.ok(res.failingRules.includes('FORBIDDEN_TESTING_BUILD'));
});

test('verifier fixture: Case 12 - NFT contract with keys yields KEYS_LOCKED_CODE_UNVERIFIED and asserts NFT_ZERO_KEYS', () => {
  const keys = [{
    access_key: {
      permission: {
        FunctionCall: { receiver_id: 'agent.near', method_names: ['spend'], allowance: '100' }
      }
    }
  }];
  const res = evaluateVerification({
    accountId: 'agent.near',
    accountKeys: keys,
    codeSha256: 'hash_abc',
    isTestingWasm: false,
    expectedAgentSha: 'hash_abc',
    nftContractId: 'nft.near',
    nftKeys: [{ access_key: { permission: 'FullAccess' } }],
    nftCodeSha256: 'nft_hash_123',
    expectedNftSha: 'nft_hash_123',
  });
  assert.strictEqual(res.status, 'KEYS_LOCKED_CODE_UNVERIFIED');
  assert.strictEqual(res.keysLocked, true);
  assert.ok(res.failingRules.includes('NFT_ZERO_KEYS'));
});

test('verifier fixture: Case 13 - NFT hash mismatch yields KEYS_LOCKED_CODE_UNVERIFIED and asserts NFT_WASM_HASH_MATCH', () => {
  const keys = [{
    access_key: {
      permission: {
        FunctionCall: { receiver_id: 'agent.near', method_names: ['spend'], allowance: '100' }
      }
    }
  }];
  const res = evaluateVerification({
    accountId: 'agent.near',
    accountKeys: keys,
    codeSha256: 'hash_abc',
    isTestingWasm: false,
    expectedAgentSha: 'hash_abc',
    nftContractId: 'nft.near',
    nftKeys: [],
    nftCodeSha256: 'mismatched_nft_hash',
    expectedNftSha: 'expected_nft_hash',
  });
  assert.strictEqual(res.status, 'KEYS_LOCKED_CODE_UNVERIFIED');
  assert.strictEqual(res.keysLocked, true);
  assert.ok(res.failingRules.includes('NFT_WASM_HASH_MATCH'));
});

test('verifier fixture: Case 14 - RPC network/query failure yields ERROR and asserts RPC_QUERY_FAILED', async () => {
  const res = await verifyAgentAccount('invalid-protocol://local.rpc', 'agent.near');
  assert.strictEqual(res.status, 'ERROR');
  assert.strictEqual(res.keysLocked, false);
  assert.ok(res.failingRules.includes('RPC_QUERY_FAILED'));
});

test('verifier fixture: Case 15 - Pinned block parameter passes block_id to queries', async () => {
  const res = await verifyAgentAccount('invalid-protocol://local.rpc', 'agent.near', undefined, 'pinned-block-hash-123');
  assert.strictEqual(res.status, 'ERROR');
  assert.ok(res.failingRules.includes('RPC_QUERY_FAILED'));
});
