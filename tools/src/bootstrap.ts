import * as nearAPI from 'near-api-js';
import * as fs from 'fs';
import { preLockSafetyCheck } from './lock';

export interface BootstrapConfig {
  agentAccountId: string;
  initialDepositNear: string;
  wasmPath: string;
  agentPublicKey: string;
  nftContractId: string;
  nftTokenId: string;
  guardianAccountId: string;
  allowlist: string[];
  perTxCapNear: string;
  periodCapNear: string;
  periodSeconds: number;
  guardianWindowSeconds: number;
  allowanceNear?: string;
}

export async function bootstrapLockedAccount(
  creatorAccount: nearAPI.Account,
  config: BootstrapConfig
): Promise<string> {
  // 1. Mandatory Local Pre-Lock Safety Inspection on WASM binary before dispatch
  await preLockSafetyCheck(config.wasmPath);

  const wasmBytes = fs.readFileSync(config.wasmPath);

  const initArgs = {
    nft_contract: config.nftContractId,
    nft_token_id: config.nftTokenId,
    guardian: config.guardianAccountId,
    agent_key: config.agentPublicKey,
    allowlist: config.allowlist,
    per_tx_cap: nearAPI.utils.format.parseNearAmount(config.perTxCapNear),
    period_cap: nearAPI.utils.format.parseNearAmount(config.periodCapNear),
    period_seconds: config.periodSeconds,
    guardian_window_seconds: config.guardianWindowSeconds,
  };

  const initialDepositYocto = nearAPI.utils.format.parseNearAmount(config.initialDepositNear)!;
  const gasAllowanceYocto = nearAPI.utils.format.parseNearAmount(config.allowanceNear || '0.25')!;

  console.log(`[BOOTSTRAP] Constructing atomic 5-action batch for ${config.agentAccountId}...`);

  const actions = [
    nearAPI.transactions.createAccount(),
    nearAPI.transactions.transfer(initialDepositYocto),
    nearAPI.transactions.deployContract(wasmBytes),
    nearAPI.transactions.functionCall(
      'new',
      Buffer.from(JSON.stringify(initArgs)),
      '30000000000000', // 30 TGas
      '0'
    ),
    nearAPI.transactions.addKey(
      nearAPI.utils.PublicKey.from(config.agentPublicKey),
      nearAPI.transactions.functionCallAccessKey(
        config.agentAccountId,
        ['spend'],
        gasAllowanceYocto
      )
    ),
  ];

  const result = await (creatorAccount as any).signAndSendTransaction({
    receiverId: config.agentAccountId,
    actions,
  });

  console.log(`✓ Atomic 5-action bootstrap completed! Transaction: ${result.transaction?.hash || 'confirmed'}`);
  return result.transaction?.hash || 'confirmed';
}
