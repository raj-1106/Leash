import * as fs from 'fs';
import * as crypto from 'crypto';
import * as path from 'path';
import * as os from 'os';
import * as nearAPI from 'near-api-js';
import { bootstrapLockedAccount } from './bootstrap';
import { verifyAgentAccount } from './verifier';

export interface PreLockInspectionResult {
  isSafe: boolean;
  sha256: string;
  exportedMethods: string[];
  reasons: string[];
}

export function inspectLocalWasmArtifact(wasmPath: string): PreLockInspectionResult {
  const reasons: string[] = [];
  if (!fs.existsSync(wasmPath)) {
    throw new Error(`WASM artifact not found at: ${wasmPath}`);
  }

  const wasmBytes = fs.readFileSync(wasmPath);
  const sha256 = crypto.createHash('sha256').update(wasmBytes).digest('hex');

  // Load forbidden hashes from release.json / release.dev.json
  const forbiddenHashes: string[] = [];
  for (const relFile of ['release.dev.json', 'release.json']) {
    const p = path.resolve(__dirname, '../../', relFile);
    if (fs.existsSync(p)) {
      try {
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (Array.isArray(data.forbiddenCodeHashes)) {
          forbiddenHashes.push(...data.forbiddenCodeHashes);
        }
      } catch (_) {}
    }
  }

  // 1. Inspect exports directly from WebAssembly Module
  let exportedMethods: string[] = [];
  try {
    const wasmModule = new WebAssembly.Module(wasmBytes);
    const exports = WebAssembly.Module.exports(wasmModule);
    exportedMethods = exports.map((e) => e.name);

    if (exportedMethods.includes('is_testing_build')) {
      reasons.push(
        'FATAL: WASM exports is_testing_build (compiled with #[cfg(feature = "testing")]). MIN_GUARDIAN_WINDOW = 1s!'
      );
    }
  } catch (err: any) {
    reasons.push(`Failed to parse WebAssembly exports: ${err.message}`);
  }

  // 2. Check forbidden hashes list
  if (forbiddenHashes.includes(sha256.toLowerCase())) {
    reasons.push(`FATAL: WASM hash ${sha256} is in forbiddenCodeHashes list.`);
  }

  return {
    isSafe: reasons.length === 0,
    sha256,
    exportedMethods,
    reasons,
  };
}

export async function preLockSafetyCheck(wasmPath: string): Promise<void> {
  console.log(`[LOCK] Inspecting local WASM binary: ${wasmPath}...`);
  const inspection = inspectLocalWasmArtifact(wasmPath);

  if (!inspection.isSafe) {
    console.error('====================================================================');
    console.error('🚨 ABORT: PRE-LOCK SAFETY CHECK FAILED!');
    for (const r of inspection.reasons) {
      console.error(`  - ${r}`);
    }
    console.error('Refusing to dispatch atomic lock batch with unsafe artifact.');
    console.error('====================================================================');
    throw new Error(`Pre-lock inspection failed: ${inspection.reasons.join('; ')}`);
  }

  console.log(`✓ Local WASM passed pre-lock safety inspection (hash: ${inspection.sha256})`);
  console.log(`✓ Confirmed zero testing flags exported.`);
}

function findWasmPath(filename: string): string {
  const candidates = [
    path.resolve(process.cwd(), `target/near/${filename}/${filename}.wasm`),
    path.resolve(process.cwd(), `../target/near/${filename}/${filename}.wasm`),
    path.resolve(__dirname, `../../target/near/${filename}/${filename}.wasm`),
    path.resolve(__dirname, `../../../target/near/${filename}/${filename}.wasm`),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

function loadMasterKeyPair(
  network: string,
  masterId: string,
  customKeyFile?: string
): nearAPI.utils.KeyPair {
  if (customKeyFile) {
    if (!fs.existsSync(customKeyFile)) {
      throw new Error(`Specified master key file does not exist: ${customKeyFile}`);
    }
    const raw = JSON.parse(fs.readFileSync(customKeyFile, 'utf8'));
    const keyStr = raw.private_key || raw.secret_key;
    if (keyStr) {
      return nearAPI.utils.KeyPair.fromString(keyStr);
    }
    throw new Error(`No private_key or secret_key found in key file: ${customKeyFile}`);
  }

  const home = os.homedir();
  const searchDirs = [
    path.join(home, '.near-credentials', network),
    path.join(home, '.near', 'credentials', network),
    path.join(process.cwd(), 'credentials', network),
    path.join(home, '.near-credentials', 'localnet'),
    path.join(home, '.near-credentials', 'sandbox'),
    path.join(os.tmpdir(), '.near-credentials', network),
  ];

  for (const dir of searchDirs) {
    const credPath = path.join(dir, `${masterId}.json`);
    if (fs.existsSync(credPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(credPath, 'utf8'));
        const keyStr = raw.private_key || raw.secret_key;
        if (keyStr) {
          return nearAPI.utils.KeyPair.fromString(keyStr);
        }
      } catch (err: any) {
        throw new Error(`Failed to parse credential file '${credPath}': ${err.message}`);
      }
    }
  }

  throw new Error(
    `No credentials found for master account '${masterId}' on network '${network}'. Looked in: ${searchDirs.join(', ')}`
  );
}

export async function runDeployCli(argv: string[]): Promise<void> {
  const args = argv.slice(2);

  const getArg = (flag: string, fallback?: string): string | undefined => {
    const idx = args.indexOf(flag);
    if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--')) {
      return args[idx + 1];
    }
    return fallback;
  };

  const hasFlag = (flag: string): boolean => args.includes(flag);

  const isDryRun = hasFlag('--dry-run');
  const network = getArg('--network', 'testnet')!;
  const masterId = getArg('--master');
  const masterKeyFile = getArg('--master-key-file');
  const releaseFile = getArg('--release-file');

  if (!masterId || hasFlag('--help') || hasFlag('-h')) {
    console.log(`
Usage: node dist/src/lock.js [OPTIONS]

Options:
  --master <accountId>            Master account paying for deployment & holding NFT (Required)
  --master-key-file <path>        Path to master credentials JSON (Optional)
  --agent <accountId>             Agent account to create & lock (Default: agent.<master>)
  --nft <accountId>               NFT contract account to create keyless (Default: nft.<master>)
  --token-id <id>                 NFT supervisory token ID (Default: token-1)
  --guardian <accountId>          Guardian account ID (Default: <master>; distinct account recommended)
  --allowlist <accounts>          Comma-separated list of allowed recipients (Required)
  --allowance <near>              Agent spend key allowance in NEAR (Default: 0.25)
  --initial-deposit <near>        Initial balance for agent in NEAR (Default: 5.0)
  --per-tx-cap <near>             Per-transaction spend cap in NEAR (Default: 0.5)
  --period-cap <near>             Sliding-window period spend cap in NEAR (Default: 2.0)
  --period-seconds <sec>          Sliding-window duration in seconds (Default: 1440).
                                  Contract maintains 24 buckets (e.g. 1440s = 24 x 60s). Must be >= 1440s.
  --guardian-window <sec>         Guardian veto delay window in seconds (Default: 3600)
  --expect-agent-sha256 <hex>     Expected SHA-256 hex digest for agent_account.wasm
  --expect-nft-sha256 <hex>       Expected SHA-256 hex digest for nft.wasm
  --network <id>                  Network ID: testnet, localnet, sandbox, mainnet (Default: testnet)
  --rpc <url>                     Custom RPC URL (Default: https://rpc.<network>.near.org)
  --agent-wasm <path>             Path to agent_account.wasm
  --nft-wasm <path>               Path to nft.wasm
  --release-file <path>           Path to release.json for verification (Optional)
  --dry-run                       Pre-flight validation only; broadcasts ZERO transactions
`);
    process.exit(masterId ? 0 : 1);
  }

  // 1. Validate Allowlist (Required)
  const rawAllowlist = getArg('--allowlist');
  if (!rawAllowlist || rawAllowlist.trim() === '') {
    console.error('========================================================');
    console.error('🚨 ERROR: --allowlist is required!');
    console.error('The agent contract enforces a non-empty allowlist of recipient accounts.');
    console.error('Example: --allowlist merchant.testnet,oracle.testnet');
    console.error('========================================================');
    throw new Error('--allowlist is required (contract requires at least one allowlisted recipient address)');
  }
  const allowlist = rawAllowlist.split(',').map((s) => s.trim()).filter(Boolean);
  if (allowlist.length === 0) {
    throw new Error('--allowlist must contain at least one valid account ID');
  }

  // 2. Validate Guardian
  const rawGuardian = getArg('--guardian');
  const guardianId = rawGuardian || masterId;
  if (!rawGuardian || guardianId === masterId) {
    console.warn('========================================================');
    console.warn('⚠️  WARNING: --guardian is not specified or equals master account!');
    console.warn(`    Guardian set to: ${guardianId}`);
    console.warn('    Split governance is weakened when guardian equals owner.');
    console.warn('    The verifier will flag a GUARDIAN_EQUALS_OWNER warning.');
    console.warn('========================================================');
  }

  // 3. Caps & Periods
  const agentId = getArg('--agent', `agent.${masterId}`)!;
  const nftId = getArg('--nft', `nft.${masterId}`)!;
  const tokenId = getArg('--token-id', 'token-1')!;
  const allowanceNear = getArg('--allowance', '0.25')!;
  const initialDepositNear = getArg('--initial-deposit', '5.0')!;
  const perTxCapNear = getArg('--per-tx-cap', '0.5')!;
  const periodCapNear = getArg('--period-cap', '2.0')!;
  const periodSeconds = parseInt(getArg('--period-seconds', '1440')!, 10);
  if (isNaN(periodSeconds) || periodSeconds < 1440) {
    throw new Error(`--period-seconds must be an integer >= 1440 (got: ${periodSeconds})`);
  }
  const guardianWindowSeconds = parseInt(getArg('--guardian-window', '3600')!, 10);
  const expectAgentSha256 = getArg('--expect-agent-sha256');
  const expectNftSha256 = getArg('--expect-nft-sha256');

  if (network === 'mainnet' && !hasFlag('--i-understand-mainnet')) {
    console.error('========================================================');
    console.error('🚨 REFUSING MAINNET DEPLOYMENT');
    console.error('Leash is a hackathon project built for testnet/localnet.');
    console.error('To run against mainnet, you must explicitly pass: --i-understand-mainnet');
    console.error('========================================================');
    throw new Error('Refusing mainnet execution without --i-understand-mainnet');
  }

  let defaultRpc = 'https://rpc.testnet.near.org';
  if (network === 'localnet' || network === 'sandbox') defaultRpc = 'http://127.0.0.1:3030';
  if (network === 'mainnet') defaultRpc = 'https://rpc.mainnet.near.org';
  const rpcUrl = getArg('--rpc', defaultRpc)!;

  const agentWasmPath = getArg('--agent-wasm', findWasmPath('agent_account'))!;
  const nftWasmPath = getArg('--nft-wasm', findWasmPath('nft'))!;

  const bucketSeconds = Math.floor(periodSeconds / 24);

  console.log('========================================================');
  console.log(`🔒 LEASH DEPLOYMENT CLI ${isDryRun ? '(DRY RUN MODE)' : '(LIVE DEPLOY)'}`);
  console.log('========================================================');
  console.log(`Network:             ${network}`);
  console.log(`RPC Endpoint:        ${rpcUrl}`);
  console.log(`Master Account:      ${masterId}`);
  console.log(`Target Agent:        ${agentId}`);
  console.log(`Target NFT:          ${nftId} (token: ${tokenId})`);
  console.log(`Guardian:            ${guardianId}`);
  console.log(`Key Allowance:       ${allowanceNear} NEAR`);
  console.log(`Initial Deposit:     ${initialDepositNear} NEAR`);
  console.log(`Per-Tx Cap:          ${perTxCapNear} NEAR`);
  console.log(`Period Cap:          ${periodCapNear} NEAR / ${periodSeconds}s (24 buckets × ${bucketSeconds}s)`);
  console.log(`Guardian Window:     ${guardianWindowSeconds}s`);
  console.log(`Allowlist:           [${allowlist.join(', ')}]`);
  if (expectAgentSha256) console.log(`Expected Agent Hash: ${expectAgentSha256}`);
  if (expectNftSha256)   console.log(`Expected NFT Hash:   ${expectNftSha256}`);
  console.log('');

  // 1. Check RPC Reachability
  console.log('[1/6] Checking RPC endpoint reachability...');
  const provider = new nearAPI.providers.JsonRpcProvider({ url: rpcUrl });
  let currentBlock: any;
  try {
    currentBlock = await provider.block({ finality: 'final' });
    console.log(`✓ Connected to ${network} (latest block: ${currentBlock.header.height})`);
  } catch (err: any) {
    throw new Error(`RPC connection failed at '${rpcUrl}': ${err.message}`);
  }

  // 2. Check Master Account Credentials
  console.log('\n[2/6] Loading master account credentials...');
  const masterKeyPair = loadMasterKeyPair(network, masterId, masterKeyFile);
  console.log(`✓ Found credentials for '${masterId}' (public key: ${masterKeyPair.getPublicKey().toString()})`);

  // 3. Inspect Master Account Balance
  console.log('\n[3/6] Inspecting master account spendable balance...');
  let masterAccountState: any;
  try {
    masterAccountState = await provider.query({
      request_type: 'view_account',
      finality: 'final',
      account_id: masterId,
    });
  } catch (err: any) {
    throw new Error(`Failed to query master account '${masterId}': ${err.message}`);
  }

  const masterBalanceYocto = BigInt(masterAccountState.amount);
  const masterBalanceNear = Number(masterBalanceYocto / 10000000000000000000000n) / 100;
  console.log(`✓ Master account balance: ${masterBalanceNear.toFixed(2)} NEAR`);

  // Calculate required balance:
  const nftBytes = fs.readFileSync(nftWasmPath);
  const agentBytes = fs.readFileSync(agentWasmPath);
  // Storage is 10 yoctoNEAR per byte, plus account overhead (~0.05 NEAR)
  const nftStorageNear = (nftBytes.length * 10) / 1e24 + 2.5; // 2.5 NEAR transfer to NFT
  const agentStorageNear = (agentBytes.length * 10) / 1e24 + parseFloat(initialDepositNear);
  const totalRequiredNear = nftStorageNear + agentStorageNear + 0.2; // 0.2 NEAR gas buffer

  console.log(`  - Estimated deployment cost: ~${totalRequiredNear.toFixed(2)} NEAR (NFT storage + Agent storage & deposit + Gas)`);
  if (masterBalanceNear < totalRequiredNear) {
    throw new Error(
      `Insufficient master balance: ${masterBalanceNear.toFixed(2)} NEAR available, but deployment requires ~${totalRequiredNear.toFixed(2)} NEAR.`
    );
  }
  console.log(`✓ Master account balance is sufficient.`);

  // 4. Check Target Account Availability on Chain
  console.log('\n[4/6] Verifying target account availability on-chain...');
  const checkAccountFree = async (accId: string, label: string) => {
    try {
      await provider.query({
        request_type: 'view_account',
        finality: 'final',
        account_id: accId,
      });
      throw new Error(`Target ${label} account '${accId}' ALREADY EXISTS on ${network}! Choose an unused name.`);
    } catch (err: any) {
      if (err.message && err.message.includes('ALREADY EXISTS')) {
        throw err;
      }
      // Error means account does not exist, which is expected and required!
      console.log(`✓ ${label} account '${accId}' is free to be created.`);
    }
  };

  await checkAccountFree(nftId, 'NFT');
  await checkAccountFree(agentId, 'Agent');

  // 5. Pre-Lock Safety Check on Both WASM Binaries & Expected Hashes
  console.log('\n[5/6] Inspecting contract WASM binaries...');
  const agentInspection = inspectLocalWasmArtifact(agentWasmPath);
  if (!agentInspection.isSafe) {
    throw new Error(`Agent WASM safety check failed: ${agentInspection.reasons.join('; ')}`);
  }
  if (expectAgentSha256 && agentInspection.sha256.toLowerCase() !== expectAgentSha256.toLowerCase()) {
    throw new Error(
      `Agent WASM hash mismatch! Expected: ${expectAgentSha256}, Got: ${agentInspection.sha256}`
    );
  }
  console.log(`✓ Agent WASM: safe (hash: ${agentInspection.sha256}, size: ${agentBytes.length} bytes)`);

  const nftInspection = inspectLocalWasmArtifact(nftWasmPath);
  if (!nftInspection.isSafe) {
    throw new Error(`NFT WASM safety check failed: ${nftInspection.reasons.join('; ')}`);
  }
  if (expectNftSha256 && nftInspection.sha256.toLowerCase() !== expectNftSha256.toLowerCase()) {
    throw new Error(
      `NFT WASM hash mismatch! Expected: ${expectNftSha256}, Got: ${nftInspection.sha256}`
    );
  }
  console.log(`✓ NFT WASM: safe (hash: ${nftInspection.sha256}, size: ${nftBytes.length} bytes)`);

  // 6. Generate or Reuse Agent Scoped Key Pair
  console.log('\n[6/6] Securing agent scoped spend key...');
  const keyDir = path.resolve(process.cwd(), '.agent-keys');
  if (!fs.existsSync(keyDir)) {
    fs.mkdirSync(keyDir, { recursive: true });
  }
  const keyFilePath = path.join(keyDir, `${agentId}.json`);

  let agentKeyPair: nearAPI.utils.KeyPair;
  if (fs.existsSync(keyFilePath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(keyFilePath, 'utf8'));
      if (existing.secret_key) {
        agentKeyPair = nearAPI.utils.KeyPair.fromString(existing.secret_key);
        console.log(`✓ Reusing existing agent key from '${path.relative(process.cwd(), keyFilePath)}'`);
      } else {
        throw new Error('Missing secret_key in existing key file');
      }
    } catch (_) {
      agentKeyPair = nearAPI.utils.KeyPairEd25519.fromRandom();
      fs.writeFileSync(
        keyFilePath,
        JSON.stringify(
          {
            account_id: agentId,
            public_key: agentKeyPair.getPublicKey().toString(),
            secret_key: agentKeyPair.toString(),
          },
          null,
          2
        ),
        { mode: 0o600 }
      );
      console.log(`✓ Generated fresh agent spend key saved to '${path.relative(process.cwd(), keyFilePath)}'`);
    }
  } else {
    agentKeyPair = nearAPI.utils.KeyPairEd25519.fromRandom();
    fs.writeFileSync(
      keyFilePath,
      JSON.stringify(
        {
          account_id: agentId,
          public_key: agentKeyPair.getPublicKey().toString(),
          secret_key: agentKeyPair.toString(),
        },
        null,
        2
      ),
      { mode: 0o600 }
    );
    console.log(`✓ Generated fresh agent spend key saved to '${path.relative(process.cwd(), keyFilePath)}'`);
  }
  fs.chmodSync(keyFilePath, 0o600);
  const agentPublicKey = agentKeyPair.getPublicKey().toString();
  console.log(`  Agent Public Key: ${agentPublicKey} (chmod 600 verified)`);

  console.log('\n========================================================');
  console.log('📋 DEPLOYMENT PLAN SUMMARY');
  console.log('========================================================');
  console.log(`Network:             ${network} (RPC: ${rpcUrl})`);
  console.log(`Master (Deployer):   ${masterId}`);
  console.log(`NFT Contract:        ${nftId} (Keyless, Initial Token ID: ${tokenId}, Owner: ${masterId})`);
  console.log(`Agent Account:       ${agentId} (Initial Deposit: ${initialDepositNear} NEAR)`);
  console.log(`Agent Key:           ${agentPublicKey} (Allowance: ${allowanceNear} NEAR, Method: spend)`);
  console.log(`Supervisory Rules:   PerTxCap: ${perTxCapNear} NEAR · PeriodCap: ${periodCapNear} NEAR / ${periodSeconds}s (24 buckets × ${bucketSeconds}s)`);
  console.log(`Guardian:            ${guardianId} (Window: ${guardianWindowSeconds}s)`);
  console.log(`Allowlist:           [${allowlist.join(', ')}]`);
  console.log('========================================================');

  if (isDryRun) {
    console.log('\n🎉 [DRY RUN SUCCESS] All pre-flight safety checks passed cleanly!');
    console.log('Zero transactions were sent to the network.');
    console.log('To execute live deployment, run the identical command without --dry-run.');
    console.log('========================================================\n');
    return;
  }

  // --- LIVE DEPLOYMENT EXECUTION ---
  console.log('\n🚀 BROADCASTING TRANSACTIONS TO CHAIN...');

  const keyStore = new nearAPI.keyStores.InMemoryKeyStore();
  await keyStore.setKey(network, masterId, masterKeyPair);

  const near = await nearAPI.connect({
    networkId: network,
    keyStore,
    nodeUrl: rpcUrl,
    headers: {},
  });

  const masterAccount = await near.account(masterId);

  // Step 1: Deploy Keyless NFT Contract
  console.log(`\n[STEP 1/3] Deploying Keyless NFT Contract to ${nftId}...`);
  const nftInitArgs = {
    owner_id: masterId,
    token_id: tokenId,
  };

  const nftTx = await (masterAccount as any).signAndSendTransaction({
    receiverId: nftId,
    actions: [
      nearAPI.transactions.createAccount(),
      nearAPI.transactions.transfer(nearAPI.utils.format.parseNearAmount('2.5')!), // 2.5 NEAR initial storage fund
      nearAPI.transactions.deployContract(nftBytes),
      nearAPI.transactions.functionCall(
        'new',
        Buffer.from(JSON.stringify(nftInitArgs)),
        '30000000000000',
        '0'
      ),
    ],
  });
  const nftTxHash = nftTx.transaction?.hash || 'confirmed';
  console.log(`✓ Keyless NFT Contract deployed! Tx: ${nftTxHash}`);

  // Step 2: Bootstrap Locked Agent Account
  console.log(`\n[STEP 2/3] Bootstrapping Locked Agent ${agentId} via atomic 5-action batch...`);
  const agentTxHash = await bootstrapLockedAccount(masterAccount, {
    agentAccountId: agentId,
    initialDepositNear,
    wasmPath: agentWasmPath,
    agentPublicKey,
    nftContractId: nftId,
    nftTokenId: tokenId,
    guardianAccountId: guardianId,
    allowlist,
    perTxCapNear,
    periodCapNear,
    periodSeconds,
    guardianWindowSeconds,
    allowanceNear,
  });
  console.log(`✓ Locked Agent Account created & locked! Tx: ${agentTxHash}`);

  // Step 3: Run Live Verifier
  console.log(`\n[STEP 3/3] Running Cryptographic Verifier against ${agentId}...`);
  let pinnedBlockId: string | undefined;
  try {
    const latestBlock = await provider.block({ finality: 'optimistic' });
    pinnedBlockId = latestBlock.header.hash;
    console.log(`✓ Verifying at latest block: ${latestBlock.header.height} (${pinnedBlockId})`);
  } catch (err: any) {
    console.warn(`Could not resolve latest block (${err.message}); falling back to final block.`);
  }

  const verificationResult = await verifyAgentAccount(rpcUrl, agentId, releaseFile, pinnedBlockId);

  // Step 4: Write deploy record
  const deployRecord = {
    network,
    rpcUrl,
    deployedAt: new Date().toISOString(),
    blockHeight: currentBlock.header.height,
    masterAccount: masterId,
    guardianAccount: guardianId,
    nftContract: nftId,
    nftTokenId: tokenId,
    nftWasmSha256: nftInspection.sha256,
    nftDeployTx: nftTxHash,
    agentAccount: agentId,
    agentPublicKey,
    agentWasmSha256: agentInspection.sha256,
    agentBootstrapTx: agentTxHash,
    supervisoryRules: {
      perTxCapNear,
      periodCapNear,
      periodSeconds,
      bucketDurationSeconds: bucketSeconds,
      guardianWindowSeconds,
      allowlist,
    },
    verification: {
      status: verificationResult.status,
      keysLocked: verificationResult.keysLocked,
      nftVerified: verificationResult.nftVerified,
      failingRules: verificationResult.failingRules,
      details: verificationResult.details,
    },
  };
  const deployRecordPath = path.resolve(process.cwd(), `deploy-${network}.json`);
  fs.writeFileSync(deployRecordPath, JSON.stringify(deployRecord, null, 2), 'utf8');

  console.log('\n========================================================');
  console.log('🏁 LIVE DEPLOYMENT COMPLETE');
  console.log('========================================================');
  console.log(`Agent Account:     ${agentId}`);
  console.log(`NFT Contract:      ${nftId}`);
  console.log(`NFT Deployment Tx: ${nftTxHash}`);
  console.log(`Agent Inception Tx:${agentTxHash}`);
  console.log(`Verification:      ${verificationResult.status}`);
  console.log(`Keys Locked:       ${verificationResult.keysLocked ? 'YES' : 'NO'}`);
  console.log(`NFT Keyless:       ${verificationResult.nftVerified ? 'YES' : 'NO'}`);
  console.log(`Failing Rules:     [${verificationResult.failingRules.join(', ')}]`);
  console.log(`Deployment Record: ${path.relative(process.cwd(), deployRecordPath)}`);
  console.log('========================================================\n');
}

// Auto-run if executed directly
if (process.argv[1] && process.argv[1].endsWith('lock.js')) {
  runDeployCli(process.argv).catch((err) => {
    console.error('\n❌ Deployment failed:', err.message);
    process.exit(1);
  });
}
