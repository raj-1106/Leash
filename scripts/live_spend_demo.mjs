// Live testnet demo: the agent's scoped key tries one legitimate spend and two attacks.
// Run from the tools directory:
//   cd tools && node --input-type=module < ../scripts/live_spend_demo.mjs
// Env: AGENT (account id), ALLOWED (allowlisted recipient), OUTSIDER (not allowlisted),
//      RPC (default testnet), KEY_FILE (default .agent-keys/<AGENT>.json)
import fs from 'node:fs';
import path from 'node:path';
import nearAPI from 'near-api-js';

const { connect, KeyPair, keyStores, utils } = nearAPI;

const AGENT = process.env.AGENT || 'agent2.leash-throwaway-1025.testnet';
const ALLOWED = process.env.ALLOWED || 'leash-throwaway-2-1025.testnet';
const OUTSIDER = process.env.OUTSIDER || 'attacker.testnet';
const RPC = process.env.RPC || 'https://rpc.testnet.near.org';
const KEY_FILE = process.env.KEY_FILE || path.resolve(process.cwd(), '.agent-keys', `${AGENT}.json`);

const key = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
const keyStore = new keyStores.InMemoryKeyStore();
await keyStore.setKey('testnet', AGENT, KeyPair.fromString(key.secret_key));
const near = await connect({ networkId: 'testnet', nodeUrl: RPC, keyStore });
const agent = await near.account(AGENT);

const GAS = '30000000000000';
const line = '------------------------------------------------------------';

async function trySpend(label, nearAmount, recipient, memo) {
  console.log(`\n${line}\n${label}\n  spend(${nearAmount} NEAR -> ${recipient})`);
  try {
    const out = await agent.functionCall({
      contractId: AGENT,
      methodName: 'spend',
      args: { amount: utils.format.parseNearAmount(nearAmount), recipient, memo },
      gas: GAS,
      attachedDeposit: '0',
    });
    console.log(`  RESULT: SUCCEEDED  tx ${out.transaction.hash}`);
    console.log(`  https://testnet.nearblocks.io/txns/${out.transaction.hash}`);
    return true;
  } catch (e) {
    const msg = (e.kind?.ExecutionError || e.message || String(e)).toString();
    console.log(`  RESULT: REJECTED BY CONTRACT`);
    console.log(`  reason: ${msg.slice(0, 220)}`);
    if (e.transaction_outcome?.id) console.log(`  tx ${e.transaction_outcome.id}`);
    return false;
  }
}

console.log(`Agent account : ${AGENT}`);
console.log(`Signing with  : scoped key ${key.public_key} (FunctionCall, spend only)`);
console.log(`Caps on chain : 0.5 NEAR per tx, 2.0 NEAR per window`);

const a = await trySpend('A. Legitimate spend within the cap', '0.1', ALLOWED, 'compute invoice #1');
const b = await trySpend('B. Compromised agent: over the per-transaction cap', '0.6', ALLOWED, 'drain attempt');
const c = await trySpend('C. Compromised agent: recipient not on the allowlist', '0.1', OUTSIDER, 'exfiltrate');

console.log(`\n${line}`);
const ok = a === true && b === false && c === false;
console.log(ok ? 'EXPECTED: in-cap spend allowed, both attacks blocked.' : 'UNEXPECTED RESULT - check output above.');
process.exit(ok ? 0 : 1);
