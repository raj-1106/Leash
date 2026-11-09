#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { verifyAgentAccount } from './verifier';
import { generateVerificationHtml } from './html_report';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command !== 'verify' || args.length < 2) {
    console.log('Usage: leash verify <account_id> [--rpc <url>] [--release <path>] [--block <block_id>] [--html [output_path]]');
    process.exit(1);
  }

  const accountId = args[1];
  let rpcUrl = 'https://rpc.mainnet.near.org';
  const rpcIndex = args.indexOf('--rpc');
  if (rpcIndex !== -1 && args[rpcIndex + 1]) {
    rpcUrl = args[rpcIndex + 1];
  }

  let releasePath: string | undefined;
  const relIndex = args.indexOf('--release');
  if (relIndex !== -1 && args[relIndex + 1]) {
    releasePath = args[relIndex + 1];
  }

  let blockId: string | undefined;
  const blockIndex = args.indexOf('--block');
  if (blockIndex !== -1 && args[blockIndex + 1]) {
    blockId = args[blockIndex + 1];
  }

  const htmlIndex = args.indexOf('--html');
  const isHtml = htmlIndex !== -1;
  let htmlOutPath: string | undefined;
  if (isHtml) {
    if (args[htmlIndex + 1] && !args[htmlIndex + 1].startsWith('--')) {
      htmlOutPath = args[htmlIndex + 1];
    } else {
      htmlOutPath = `leash-report-${accountId.replace(/[^a-zA-Z0-9_-]/g, '_')}.html`;
    }
  }

  if (!isHtml) {
    console.log(`========================================================`);
    console.log(`🔍 Verifying Leash Account: ${accountId}`);
    console.log(`   RPC Endpoint: ${rpcUrl}`);
    if (blockId) {
      console.log(`   Pinned Block: ${blockId}`);
    }
    console.log(`========================================================\n`);
  }

  try {
    const res = await verifyAgentAccount(rpcUrl, accountId, releasePath, blockId);

    if (isHtml && htmlOutPath) {
      const htmlContent = generateVerificationHtml(res);
      if (htmlOutPath === '-') {
        process.stdout.write(htmlContent);
      } else {
        const resolvedPath = path.resolve(process.cwd(), htmlOutPath);
        fs.writeFileSync(resolvedPath, htmlContent, 'utf8');
        console.log(`📄 HTML report written to: ${resolvedPath}`);
      }
      return;
    }

    console.log(`STATUS: [ ${res.status} ]\n`);
    if (res.blockHeight || res.blockHash) {
      console.log(`Pinned Block: ${res.blockHeight} (${res.blockHash})`);
    }
    console.log(`Checks:`);
    console.log(`  - Zero FullAccess Keys:        ${res.hasZeroFullAccessKeys ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`  - Single Scoped Spend Key:     ${res.hasSingleScopedSpendKey ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`  - Keys Strictly Locked:        ${res.keysLocked ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`  - NFT Contract Keyless & Valid:${res.nftVerified ? '✅ PASS' : '❌ FAIL'}`);
    if (res.codeSha256) {
      console.log(`  - Deployed SHA-256 Code Hash:  ${res.codeSha256}`);
    }

    if (res.failingRules && res.failingRules.length > 0) {
      console.log(`\nFailing Rule(s):`);
      for (const rule of res.failingRules) {
        console.log(`  - ${rule}`);
      }
    }

    if (res.details && res.details.length > 0) {
      console.log(`\nNotes & Discrepancies:`);
      for (const d of res.details) {
        console.log(`  - ${d}`);
      }
    }
    console.log('');
  } catch (err: any) {
    console.error(`Verification error: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
