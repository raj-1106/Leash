import { Sandbox } from "near-kit/sandbox";
import * as nearAPI from "near-api-js";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";
import assert from "assert";

import { runDeployCli } from "../tools/dist/src/lock.js";

const binaryPath = "/home/raj/blockchain-projects/Leash/target/debug/build/near-sandbox-2c737cf897fb1664/out/.near/near-sandbox-2.14.0-rc.4/near-sandbox";
const LEASH_DIR = "/home/raj/blockchain-projects/Leash";

async function main() {
  console.log("========================================================");
  console.log("🧪 LEASH LIVE DEPLOY SANDBOX TEST");
  console.log("========================================================");

  const agentWasmPath = path.join(LEASH_DIR, "target/near/agent_account/agent_account.wasm");
  const nftWasmPath = path.join(LEASH_DIR, "target/near/nft/nft.wasm");

  if (!fs.existsSync(agentWasmPath) || !fs.existsSync(nftWasmPath)) {
    throw new Error("Missing compiled WASM artifacts. Run 'make build' first.");
  }

  const agentWasmBytes = fs.readFileSync(agentWasmPath);
  const nftWasmBytes = fs.readFileSync(nftWasmPath);
  const agentSha256 = crypto.createHash("sha256").update(agentWasmBytes).digest("hex");
  const nftSha256 = crypto.createHash("sha256").update(nftWasmBytes).digest("hex");

  console.log(`Agent SHA256: ${agentSha256}`);
  console.log(`NFT SHA256:   ${nftSha256}`);

  // Create temporary dynamic proof release file
  const dynamicRelease = {
    schema_version: "1.0.0",
    project: "Leash",
    release_tag: "v0.1.0-sandbox-test",
    build_environment: "sandbox-verification",
    artifacts: {
      agent_account: {
        path: agentWasmPath,
        sha256: agentSha256,
        size_bytes: agentWasmBytes.length,
        min_guardian_window_seconds: 3600,
      },
      nft: {
        path: nftWasmPath,
        sha256: nftSha256,
        size_bytes: nftWasmBytes.length,
      },
    },
    forbiddenCodeHashes: [],
  };

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "leash-deploy-test-"));
  const proofReleasePath = path.join(tempDir, "release-test.json");
  fs.writeFileSync(proofReleasePath, JSON.stringify(dynamicRelease, null, 2), "utf8");

  const sandbox = await Sandbox.start({ binaryPath, detached: false });
  console.log("✓ Sandbox started at RPC:", sandbox.rpcUrl);

  try {
    const rootKeyPath = path.join(tempDir, "root.json");
    fs.writeFileSync(
      rootKeyPath,
      JSON.stringify(
        {
          account_id: sandbox.rootAccount.id,
          secret_key: sandbox.rootAccount.secretKey,
        },
        null,
        2
      ),
      "utf8"
    );

    const ts = Date.now();
    const testAgent = `agent-${ts}.test.near`;
    const testNft = `nft-${ts}.test.near`;
    const testGuardian = "guardian.test.near";
    const testAllowlist = "merchant.test.near,oracle.test.near";

    console.log("\n🚀 Executing runDeployCli in LIVE (non-dry) mode...");

    await runDeployCli([
      "node",
      "dist/src/lock.js",
      "--network", "sandbox",
      "--rpc", sandbox.rpcUrl,
      "--master", sandbox.rootAccount.id,
      "--master-key-file", rootKeyPath,
      "--guardian", testGuardian,
      "--agent", testAgent,
      "--nft", testNft,
      "--allowlist", testAllowlist,
      "--per-tx-cap", "0.5",
      "--period-cap", "2.0",
      "--period-seconds", "1440",
      "--guardian-window", "3600",
      "--allowance", "0.25",
      "--initial-deposit", "5.0",
      "--expect-agent-sha256", agentSha256,
      "--expect-nft-sha256", nftSha256,
      "--release-file", proofReleasePath,
    ]);

    // Check deploy-sandbox.json was generated
    const deployRecordPath = path.resolve(process.cwd(), "deploy-sandbox.json");
    assert(fs.existsSync(deployRecordPath), "deploy-sandbox.json was not created!");

    const deployRecord = JSON.parse(fs.readFileSync(deployRecordPath, "utf8"));
    console.log("\nInspecting deploy-sandbox.json metadata:");
    console.log("  network:          ", deployRecord.network);
    console.log("  agentAccount:     ", deployRecord.agentAccount);
    console.log("  nftContract:      ", deployRecord.nftContract);
    console.log("  verification status:", deployRecord.verification.status);
    console.log("  keysLocked:       ", deployRecord.verification.keysLocked);
    console.log("  nftVerified:      ", deployRecord.verification.nftVerified);
    console.log("  failingRules:     ", deployRecord.verification.failingRules);

    assert.strictEqual(deployRecord.verification.status, "LOCKED_AND_VERIFIED");
    assert.strictEqual(deployRecord.verification.keysLocked, true);
    assert.strictEqual(deployRecord.verification.nftVerified, true);
    assert.strictEqual(deployRecord.verification.failingRules.length, 0);
    assert.strictEqual(deployRecord.supervisoryRules.perTxCapNear, "0.5");
    assert.strictEqual(deployRecord.supervisoryRules.periodCapNear, "2.0");
    assert.strictEqual(deployRecord.supervisoryRules.periodSeconds, 1440);
    assert.deepStrictEqual(deployRecord.supervisoryRules.allowlist, ["merchant.test.near", "oracle.test.near"]);

    console.log("\n========================================================");
    console.log("🎉 SUCCESS: Live deploy against sandbox verified 100%!");
    console.log("========================================================");
  } finally {
    try {
      await sandbox.stop();
    } catch (_) {}
    fs.rmSync(tempDir, { recursive: true, force: true });
    // Keep or remove deploy-sandbox.json
    const dp = path.resolve(process.cwd(), "deploy-sandbox.json");
    if (fs.existsSync(dp)) {
      fs.unlinkSync(dp);
    }
  }
}

main().catch((err) => {
  console.error("FATAL in test_live_deploy_sandbox:", err);
  process.exit(1);
});
