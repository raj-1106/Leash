import { Sandbox } from "near-kit/sandbox";
import * as nearAPI from "near-api-js";
import fs from "fs";
import path from "path";

const binaryPath = "/home/raj/blockchain-projects/Leash/target/debug/build/near-sandbox-2c737cf897fb1664/out/.near/near-sandbox-2.14.0-rc.4/near-sandbox";
const LEASH_DIR = "/home/raj/blockchain-projects/Leash";

const { connect, keyStores, utils, transactions } = nearAPI;

async function main() {
  console.log("========================================================");
  console.log("🚀 Starting Local NEAR Sandbox (near-kit)...");
  console.log("========================================================");

  // Sync release.dev.json into web/release.json so web UI has dev hashes
  fs.copyFileSync(
    path.join(LEASH_DIR, "release.dev.json"),
    path.join(LEASH_DIR, "web/release.json")
  );
  console.log("✓ Copied release.dev.json -> web/release.json");

  const sandbox = await Sandbox.start({ binaryPath, detached: false });
  console.log("✓ Sandbox running at RPC:", sandbox.rpcUrl);

  const keyStore = new keyStores.InMemoryKeyStore();
  const rootKeyPair = utils.KeyPair.fromString(sandbox.rootAccount.secretKey);
  await keyStore.setKey("localnet", sandbox.rootAccount.id, rootKeyPair);

  const near = await connect({
    networkId: "localnet",
    keyStore,
    nodeUrl: sandbox.rpcUrl,
  });

  const rootAccount = await near.account(sandbox.rootAccount.id);
  const rootBal = await rootAccount.getAccountBalance();
  console.log(`Root account: ${sandbox.rootAccount.id} (${utils.format.formatNearAmount(rootBal.available, 0)} NEAR)`);

  const NFT_ID = "nft.test.near";
  const AGENT_ID = "agent.test.near";
  const TOKEN_ID = "agent-1";

  // 1. Create Keyless NFT Account & Deploy NFT Contract (Atomic 4-action batch, NO keys added!)
  console.log(`\n[1/3] Deploying Keyless NFT contract to ${NFT_ID}...`);
  const nftWasm = fs.readFileSync(path.join(LEASH_DIR, "target/near/nft/nft.wasm"));

  await rootAccount.signAndSendTransaction({
    receiverId: NFT_ID,
    actions: [
      transactions.createAccount(),
      transactions.transfer(utils.format.parseNearAmount("5")),
      transactions.deployContract(nftWasm),
      transactions.functionCall(
        "new",
        Buffer.from(JSON.stringify({
          owner_id: sandbox.rootAccount.id,
          token_id: TOKEN_ID,
        })),
        "30000000000000",
        "0"
      ),
    ],
  });
  console.log("✓ Keyless NFT deployed and initialized (0 keys)! Token minted to", sandbox.rootAccount.id);

  // 2. Deploy Locked Agent Account in 5-Action Batch
  console.log(`\n[2/3] Bootstrapping locked agent account to ${AGENT_ID}...`);
  const agentKey = utils.KeyPair.fromRandom("ed25519");
  const agentPubKey = agentKey.getPublicKey().toString();
  await keyStore.setKey("localnet", AGENT_ID, agentKey);

  const agentWasm = fs.readFileSync(path.join(LEASH_DIR, "target/near/agent_account/agent_account.wasm"));

  const initArgs = {
    nft_contract: NFT_ID,
    nft_token_id: TOKEN_ID,
    guardian: sandbox.rootAccount.id,
    agent_key: agentPubKey,
    allowlist: [sandbox.rootAccount.id, "vendor.test.near"],
    per_tx_cap: utils.format.parseNearAmount("1.0"),
    period_cap: utils.format.parseNearAmount("5.0"),
    period_seconds: 86400,
    guardian_window_seconds: 3600,
  };

  const gasAllowance = utils.format.parseNearAmount("0.25");

  const batchResult = await rootAccount.signAndSendTransaction({
    receiverId: AGENT_ID,
    actions: [
      transactions.createAccount(),
      transactions.transfer(utils.format.parseNearAmount("10")),
      transactions.deployContract(agentWasm),
      transactions.functionCall(
        "new",
        Buffer.from(JSON.stringify(initArgs)),
        "30000000000000",
        "0"
      ),
      transactions.addKey(
        agentKey.getPublicKey(),
        transactions.functionCallAccessKey(AGENT_ID, ["spend"], gasAllowance)
      ),
    ],
  });

  console.log("✓ Atomic 5-action batch completed! Tx:", batchResult.transaction.hash);

  // Wait 1 block for state to be fully indexed
  await sandbox.waitForNextBlock();

  // 3. Verify using tools verifier
  console.log("\n[3/3] Verifying agent account with Leash verifier...");
  const { verifyAgentAccount } = await import(path.join(LEASH_DIR, "tools/dist/src/verifier.js"));
  const verification = await verifyAgentAccount(
    sandbox.rpcUrl,
    AGENT_ID,
    path.join(LEASH_DIR, "web/release.json")
  );

  console.log("\n========================================================");
  console.log("VERIFICATION STATUS:", verification.status);
  console.log("Zero FullAccess Keys:", verification.hasZeroFullAccessKeys ? "✅ PASS" : "❌ FAIL");
  console.log("Single Scoped Spend Key:", verification.hasSingleScopedSpendKey ? "✅ PASS" : "❌ FAIL");
  console.log("Keys Strictly Locked:", verification.keysLocked ? "✅ PASS" : "❌ FAIL");
  console.log("NFT Contract Keyless:", verification.nftVerified ? "✅ PASS" : "❌ FAIL");
  console.log("Code SHA256 Match:", verification.codeSha256);
  if (verification.details && verification.details.length) {
    console.log("Details:", verification.details);
  }
  console.log("========================================================");

  console.log("\n🌐 BROWSER VERIFICATION READY!");
  console.log("Open http://localhost:8080 in your browser and enter:");
  console.log(`  RPC URL : ${sandbox.rpcUrl}`);
  console.log(`  Account : ${AGENT_ID}`);
  console.log("  Click 'Verify'!\n");
  console.log("Sandbox is kept alive. Press Ctrl+C or kill task to stop.");

  // Keep sandbox alive indefinitely
  await new Promise(() => {});
}

main().catch(err => {
  console.error("Fatal Error:", err);
  process.exit(1);
});
