import { Sandbox } from "near-kit/sandbox";
import * as nearAPI from "near-api-js";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";
import assert from "assert";

import { bootstrapLockedAccount } from "../tools/dist/src/bootstrap.js";
import { verifyAgentAccount } from "../tools/dist/src/verifier.js";

const binaryPath = "/home/raj/blockchain-projects/Leash/target/debug/build/near-sandbox-2c737cf897fb1664/out/.near/near-sandbox-2.14.0-rc.4/near-sandbox";
const LEASH_DIR = "/home/raj/blockchain-projects/Leash";
const { connect, keyStores, utils, transactions } = nearAPI;

async function main() {
  console.log("========================================================");
  console.log("🧪 LEASH CHAIN PROOF: End-to-End Sandbox Verification");
  console.log("========================================================");

  const agentWasmPath = path.join(LEASH_DIR, "target/near/agent_account/agent_account.wasm");
  const nftWasmPath = path.join(LEASH_DIR, "target/near/nft/nft.wasm");

  if (!fs.existsSync(agentWasmPath) || !fs.existsSync(nftWasmPath)) {
    throw new Error("Missing compiled WASM artifacts. Run 'make build' first.");
  }

  // Calculate runtime SHA-256 digests of the WASM artifacts under test
  const agentWasmBytes = fs.readFileSync(agentWasmPath);
  const nftWasmBytes = fs.readFileSync(nftWasmPath);
  const agentSha256 = crypto.createHash("sha256").update(agentWasmBytes).digest("hex");
  const nftSha256 = crypto.createHash("sha256").update(nftWasmBytes).digest("hex");

  console.log(`Artifact Under Test (Agent): ${agentSha256} (${agentWasmBytes.length} bytes)`);
  console.log(`Artifact Under Test (NFT):   ${nftSha256} (${nftWasmBytes.length} bytes)`);

  // Create temporary dynamic proof release file matching the exact tested artifacts
  const dynamicRelease = {
    schema_version: "1.0.0",
    project: "Leash",
    release_tag: "v0.1.0-chain-proof",
    build_environment: "sandbox-verification",
    artifacts: {
      agent_account: {
        path: agentWasmPath,
        sha256: agentSha256,
        size_bytes: agentWasmBytes.length,
        min_guardian_window_seconds: 3600
      },
      nft: {
        path: nftWasmPath,
        sha256: nftSha256,
        size_bytes: nftWasmBytes.length
      }
    },
    forbiddenCodeHashes: []
  };

  const proofReleasePath = path.join(os.tmpdir(), `leash-proof-release-${Date.now()}.json`);
  fs.writeFileSync(proofReleasePath, JSON.stringify(dynamicRelease, null, 2), "utf8");

  const sandbox = await Sandbox.start({ binaryPath, detached: false });
  console.log("✓ Sandbox started at RPC:", sandbox.rpcUrl);

  try {
    const keyStore = new keyStores.InMemoryKeyStore();
    const rootKeyPair = utils.KeyPair.fromString(sandbox.rootAccount.secretKey);
    await keyStore.setKey("localnet", sandbox.rootAccount.id, rootKeyPair);

    const near = await connect({
      networkId: "localnet",
      keyStore,
      nodeUrl: sandbox.rpcUrl,
    });

    const rootAccount = await near.account(sandbox.rootAccount.id);

    const NFT_ID = "nft.test.near";
    const AGENT_ID = "agent.test.near";
    const TOKEN_ID = "token-1";
    const OWNER_ID = "owner.test.near";
    const GUARDIAN_ID = "guardian.test.near";

    // 1. Deploy Keyless NFT Contract (Atomic 4-action batch)
    console.log(`\n[1/3] Deploying Keyless NFT contract to ${NFT_ID}...`);
    await rootAccount.signAndSendTransaction({
      receiverId: NFT_ID,
      actions: [
        transactions.createAccount(),
        transactions.transfer(utils.format.parseNearAmount("5")),
        transactions.deployContract(nftWasmBytes),
        transactions.functionCall(
          "new",
          Buffer.from(JSON.stringify({ owner_id: OWNER_ID, token_id: TOKEN_ID })),
          "30000000000000",
          "0"
        ),
      ],
    });
    console.log(`✓ Keyless NFT contract deployed successfully to ${NFT_ID}`);

    // 2. Deploy Locked Agent Account via bootstrapLockedAccount()
    console.log(`\n[2/3] Bootstrapping Locked Agent via bootstrap.ts to ${AGENT_ID}...`);
    const agentKeyPair = utils.KeyPairEd25519.fromRandom();
    const agentPubKeyStr = agentKeyPair.getPublicKey().toString();

    await bootstrapLockedAccount(rootAccount, {
      agentAccountId: AGENT_ID,
      initialDepositNear: "10",
      wasmPath: agentWasmPath,
      agentPublicKey: agentPubKeyStr,
      nftContractId: NFT_ID,
      nftTokenId: TOKEN_ID,
      guardianAccountId: GUARDIAN_ID,
      allowlist: ["receiver.test.near"],
      perTxCapNear: "1.0",
      periodCapNear: "5.0",
      periodSeconds: 1440,
      guardianWindowSeconds: 3600,
    });
    console.log(`✓ Locked agent ${AGENT_ID} bootstrapped via atomic 5-action batch!`);

    // Fetch latest optimistic block so we verify at the state after inclusion
    const provider = new nearAPI.providers.JsonRpcProvider({ url: sandbox.rpcUrl });
    const latestBlock = await provider.block({ finality: "optimistic" });
    console.log(`✓ Verifying at latest block: ${latestBlock.header.height} (${latestBlock.header.hash})`);

    // 3. Verify via verifyAgentAccount with dynamic proof release file pinned to latestBlock
    console.log(`\n[3/3] Running verifier against ${AGENT_ID} with proof release file...`);
    const result = await verifyAgentAccount(sandbox.rpcUrl, AGENT_ID, proofReleasePath, latestBlock.header.hash);

    console.log("\n========================================================");
    console.log(`OUTCOME:       ${result.status}`);
    console.log(`Keys Locked:   ${result.keysLocked}`);
    console.log(`Code Hash Ok:  ${!result.failingRules.includes('WASM_HASH_MATCH')}`);
    console.log(`NFT Keyless:   ${result.nftVerified}`);
    console.log(`Failing Rules: [${result.failingRules.join(", ")}]`);
    console.log("========================================================");

    assert.strictEqual(result.status, "LOCKED_AND_VERIFIED", `Expected LOCKED_AND_VERIFIED, got ${result.status}`);
    assert.strictEqual(result.failingRules.length, 0, `Expected 0 failing rules, got: ${result.failingRules.join(", ")}`);
    assert.strictEqual(result.keysLocked, true, "Keys must be locked");
    assert.strictEqual(result.nftVerified, true, "NFT contract must be verified keyless");

    console.log("\n🎉 CHAIN PROOF VALIDATION: 100% SUCCESS!");
    console.log("The exact WASM bytes deployed through bootstrapLockedAccount()");
    console.log("evaluate strictly to LOCKED_AND_VERIFIED with zero failing rules!");
  } finally {
    try { fs.unlinkSync(proofReleasePath); } catch (_) {}
    await sandbox.stop();
    console.log("✓ Sandbox stopped cleanly.");
  }
}

main().catch((err) => {
  console.error("❌ Chain proof validation failed:", err);
  process.exit(1);
});
