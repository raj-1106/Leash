import * as nearAPI from 'near-api-js';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export {
  VerifierOutcome,
  VerificationResult,
  EvaluateParams,
  evaluateVerification,
} from './evaluator';

import {
  VerifierOutcome,
  VerificationResult,
  evaluateVerification,
} from './evaluator';

export interface LoadedReleaseConfig {
  filePath: string;
  expectedAgentSha: string | null;
  expectedNftSha: string | null;
  forbiddenHashes: string[];
}

export function loadReleaseConfig(customReleasePath?: string): LoadedReleaseConfig {
  let defaultReleasePath = path.resolve(__dirname, '../../../release.json');
  if (!fs.existsSync(defaultReleasePath)) {
    defaultReleasePath = path.resolve(__dirname, '../../release.json');
  }
  const targetPath = customReleasePath ? path.resolve(customReleasePath) : defaultReleasePath;

  if (!fs.existsSync(targetPath)) {
    throw new Error(`Release file not found at '${targetPath}'`);
  }

  let expectedAgentSha: string | null = null;
  let expectedNftSha: string | null = null;
  const forbiddenHashes: string[] = [];

  try {
    const raw = fs.readFileSync(targetPath, 'utf8');
    const relData = JSON.parse(raw);
    if (relData.artifacts?.agent_account?.sha256) {
      expectedAgentSha = String(relData.artifacts.agent_account.sha256).toLowerCase();
    }
    if (relData.artifacts?.nft?.sha256) {
      expectedNftSha = String(relData.artifacts.nft.sha256).toLowerCase();
    }
    if (Array.isArray(relData.forbiddenCodeHashes)) {
      forbiddenHashes.push(...relData.forbiddenCodeHashes.map((h: string) => h.toLowerCase()));
    }
  } catch (err: any) {
    throw new Error(`Failed to read/parse release file at '${targetPath}': ${err.message}`);
  }

  return {
    filePath: targetPath,
    expectedAgentSha,
    expectedNftSha,
    forbiddenHashes,
  };
}

export async function verifyAgentAccount(
  rpcUrl: string,
  accountId: string,
  customReleasePath?: string,
  pinnedBlockId?: string
): Promise<VerificationResult> {
  const provider = new nearAPI.providers.JsonRpcProvider({ url: rpcUrl });
  const failingRules: string[] = [];
  const details: string[] = [];

  try {
    let blockHash = '';
    let blockHeight = 0;
    let blockId: any;

    if (pinnedBlockId) {
      blockId = pinnedBlockId;
      try {
        const blk = await provider.block({ blockId });
        blockHash = blk.header.hash;
        blockHeight = blk.header.height;
      } catch (_) {
        blockHash = pinnedBlockId;
      }
    } else {
      const block = await provider.block({ finality: 'final' });
      blockHash = block.header.hash;
      blockHeight = block.header.height;
      blockId = blockHash;
    }

    // 1. Fetch access keys pinned to blockId
    const keysResponse = await provider.query<any>({
      request_type: 'view_access_key_list',
      block_id: blockId,
      account_id: accountId,
    });
    const accountKeys = keysResponse.keys || [];

    // 2. Fetch contract code pinned to blockId
    let codeSha256: string | null = null;
    let isTestingWasm = false;

    try {
      const codeResponse = await provider.query<any>({
        request_type: 'view_code',
        block_id: blockId,
        account_id: accountId,
      });

      if (codeResponse.code_base64) {
        const codeBuffer = Buffer.from(codeResponse.code_base64, 'base64');
        codeSha256 = crypto.createHash('sha256').update(codeBuffer).digest('hex');

        try {
          const wasmModule = new WebAssembly.Module(codeBuffer);
          const exports = WebAssembly.Module.exports(wasmModule);
          if (exports.some((e) => e.name === 'is_testing_build')) {
            isTestingWasm = true;
          }
        } catch (_) {}
      }
    } catch (err: any) {
      details.push(`Failed to fetch code: ${err.message}`);
    }

    // 3. Strictly load single release file (release.json by default, custom only if specified)
    const releaseConfig = loadReleaseConfig(customReleasePath);

    // 4. Check NFT contract if state view is readable
    let nftContractId: string | null = null;
    let nftKeys: any[] = [];
    let nftCodeSha256: string | null = null;

    try {
      const stateResult = await provider.query<any>({
        request_type: 'call_function',
        block_id: blockId,
        account_id: accountId,
        method_name: 'get_state',
        args_base64: Buffer.from(JSON.stringify({})).toString('base64'),
      });

      const state = JSON.parse(Buffer.from(stateResult.result).toString('utf8'));
      nftContractId = state.nft_contract;

      if (nftContractId) {
        const keysRes = await provider.query<any>({
          request_type: 'view_access_key_list',
          block_id: blockId,
          account_id: nftContractId,
        });
        nftKeys = keysRes.keys || [];

        const nftCodeRes = await provider.query<any>({
          request_type: 'view_code',
          block_id: blockId,
          account_id: nftContractId,
        });

        if (nftCodeRes.code_base64) {
          const nftBuffer = Buffer.from(nftCodeRes.code_base64, 'base64');
          nftCodeSha256 = crypto.createHash('sha256').update(nftBuffer).digest('hex');
        }
      }
    } catch (err: any) {
      details.push(`NFT check encountered issue: ${err.message}`);
    }

    const evalResult = evaluateVerification({
      accountId,
      accountKeys,
      codeSha256,
      isTestingWasm,
      expectedAgentSha: releaseConfig.expectedAgentSha,
      nftContractId,
      nftKeys,
      nftCodeSha256,
      expectedNftSha: releaseConfig.expectedNftSha,
      forbiddenHashes: releaseConfig.forbiddenHashes,
    });

    return {
      accountId,
      blockHash,
      blockHeight,
      keysLocked: evalResult.keysLocked,
      hasZeroFullAccessKeys: evalResult.hasZeroFullAccessKeys,
      hasSingleScopedSpendKey: evalResult.hasSingleScopedSpendKey,
      codeSha256,
      nftVerified: evalResult.nftVerified,
      status: evalResult.status,
      failingRules: [...failingRules, ...evalResult.failingRules],
      details: [...details, ...evalResult.details],
    };
  } catch (err: any) {
    return {
      accountId,
      blockHash: '',
      blockHeight: 0,
      keysLocked: false,
      hasZeroFullAccessKeys: false,
      hasSingleScopedSpendKey: false,
      codeSha256: null,
      nftVerified: false,
      status: 'ERROR',
      failingRules: ['RPC_QUERY_FAILED'],
      details: [`RPC query failed: ${err.message}`],
    };
  }
}
