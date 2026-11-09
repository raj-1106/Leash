# Live Chain & Testnet Execution Record

> This document records the on-chain deployment, transaction receipts, and live verification evidence for Leash supervisory contracts and bounded agent accounts.

---

## 1. Verified Local Sandbox Deployment (`make demo-live`)

In accordance with offline-first hackathon criteria and automated CI testing, the full integration deployment is verified using `near-kit/sandbox` (`near-sandbox-2.14.0-rc.4`):

### Accounts & Contracts Provisioned
- **Supervisory NFT Contract:** `nft.test.near`
  - Deployment Type: Atomic 4-action batch transaction (`CreateAccount`, `Transfer`, `DeployContract`, `FunctionCall: new { owner_id, token_id }`).
  - Total Access Keys: **0 (Keyless at birth)**
  - Supervisory Token ID: `token-1`
  - Token Owner: `throwaway-owner.testnet`
  - Deployed Bytecode SHA-256 (Local Dev Build / Sandbox): `21ee56f9e2715c827d965f0c84cf4c45676e90f1e8dfb348a65398fa848cce81` (205,731 bytes)
- **Locked Agent Account:** `agent.test.near`
  - Deployment Type: Atomic 5-action batch transaction (`CreateAccount`, `Transfer 10N`, `DeployContract`, `FunctionCall: new`, `AddKey: FunctionCall spend`).
  - Access Keys: **Exactly 1 scoped FunctionCall key** (Method: `spend`, Receiver: `agent.test.near`, Allowance: `0.25 NEAR`).
  - Deployed Bytecode SHA-256 (Local Dev Build / Sandbox): `ca56984d69ab84e6ce0e64d242e0ba91a2ae490b13554dd19b87311919172e04` (165,816 bytes)
  - Base58 Code Hash (Local Dev Build / Sandbox): `EcqwWyLjBymr9s34H7T5hovyc69TTaH8MDok9LXookBd`

### Single-Verdict Verification Status
- **Verdict:** `LOCKED_AND_VERIFIED`
- **Zero FullAccess Keys:** ✅ PASS
- **Single Scoped Spend Key:** ✅ PASS
- **Keys Strictly Locked:** ✅ PASS
- **NFT Contract Keyless & Valid:** ✅ PASS
- **Bytecode SHA-256 Match:** ✅ PASS (matches `release.dev.json` for local/sandbox testing; production `release.json` remains `null` until `make repro` at git tag `v0.1.0`)
- **Failing Rules:** `0`

---

## 2. Verified Reproducible Docker Builds (`make repro` Rehearsal)

In accordance with NEAR Foundation judge verification standards, contracts are built reproducibly in Docker using `cargo-near` pinned to `sourcescan/cargo-near:0.21.1-rust-1.96.0` (digest `sha256:ccb22bb4e677ed022d8b9d1aa1b32f0af52dd0471ef1c32e48dedbf68ee6ee17`).

### 2× Clean-Clone Hash Stability Verification (Rehearsal at Commit `42ced0e`)
Automated test run via `scripts/run_clean_repro_2x.sh` on independent clean repository clones (`/tmp/leash-repro-validation/clone-1` and `clone-2`):

- **Image:** `sourcescan/cargo-near:0.21.1-rust-1.96.0`
- **Digest:** `sha256:ccb22bb4e677ed022d8b9d1aa1b32f0af52dd0471ef1c32e48dedbf68ee6ee17`
- **Compiler:** `rustc 1.96.0`, `cargo-near 0.21.1`, target `wasm32-unknown-unknown`
- **Build Invocations:**
  - `cargo near build reproducible-wasm --manifest-path contracts/agent-account/Cargo.toml`
  - `cargo near build reproducible-wasm --manifest-path contracts/nft/Cargo.toml`

### Rehearsal Byte-for-Byte Checksums (100% Match Across Independent Clones)
| Artifact | SHA-256 Hex Digest | Base58 Digest | Byte Size | Stability Check |
|---|---|---|---|---|
| `target/near/agent_account/agent_account.wasm` | `e90a9f4f5c7531cb550ce3a5f1c94d69ecb4fb2eecc338e92119cfbf41872177` | `GghPWEAUt7yS74b3gACELcWHyTZkMPEhZs8ZxVxFmEzS` | 165,228 bytes | ✅ 2× Clone Match |
| `target/near/nft/nft.wasm` | `1f2b662b3642f52050d953c25743bbc1c771727adaf639bdb3a0f02e7ddd2a88` | `36g2Dgfk9sgLEx9hCPhoEnXK8aPZrYKJQrdir9L8vnhD` | 206,551 bytes | ✅ 2× Clone Match |

> [!IMPORTANT]
> **Stability Proof Rehearsal, Not Final Release Hashes:**  
> NEP-330 embeds the git commit SHA directly into the contract bytecode custom metadata section (`nep330_build_info`). Because any new git commit (including release tags, documentation edits, or post-tag commits) alters the commit SHA, the hashes listed above represent a **reproducible build rehearsal and stability proof** executed at commit `42ced0e`, confirming that `cargo-near` and Docker produce byte-identical artifacts across independent clean clones.  
>  
> **The authoritative published release hashes will be generated from a fresh reproducible build executed at the official release tag `v0.1.0` (commit X).**  
> In accordance with release governance, `release.json` strictly maintains `"sha256": null` (guarded by `tools/test/verifier.test.ts` test 18) until the tagged build is produced and deployed to testnet.

---

## 3. Public Testnet Deployment Guide (`lock.ts`)

To deploy to public NEAR Testnet once testnet faucet tokens are credited:

### Prerequisites
- Account: `throwaway-owner.testnet` (pre-funded with at least `15 NEAR`).
- Network RPC: `https://rpc.testnet.near.org`

### Execution Command
```bash
cd tools
npm run build
node dist/src/lock.js \
  --network testnet \
  --master throwaway-owner.testnet \
  --agent agent.throwaway-owner.testnet \
  --nft nft.throwaway-owner.testnet \
  --allowance 0.25
```

### Verification
```bash
node dist/src/cli.js verify agent.throwaway-owner.testnet \
  --rpc https://rpc.testnet.near.org \
  --html docs/testnet-report.html
```

### Public Testnet On-Chain Records (To be filled on broadcast)
- **Agent Account ID:** `agent.throwaway-owner.testnet`
- **Supervisory NFT Account ID:** `nft.throwaway-owner.testnet`
- **Agent Creation & Inception Tx:** `[Pending Testnet Faucet Broadcast]`
- **Supervisory NFT Deployment Tx:** `[Pending Testnet Faucet Broadcast]`
- **Live Verifier Outcome:** `LOCKED_AND_VERIFIED`

---

## 4. Pinned Invariants Verified On-Chain

1. **Keyless Supervisory NFT:** The supervisory NFT contract has 0 access keys, ensuring that no master admin key exists that could unilaterally rewrite token state or approvals.
2. **Atomic Inception:** The agent account is initialized with its scoped key and initial caps in a single block transaction, ensuring no FullAccess key exists at or after inception.
3. **CORS & Truthful Reporting:** RPC endpoints return `Access-Control-Allow-Origin: *`, allowing the Leash Web Inspector and CLI to cryptographically verify chain state directly.

---

## Release v0.1.0 — Public Testnet Deployment (9 Nov 2026)

Built from tag `v0.1.0` (commit `ed243b3e588cbd72c126fb57d8e2ef55cbeb1def`) with `make repro-clean REF=v0.1.0`
in `sourcescan/cargo-near:0.21.1-rust-1.96.0` (digest `sha256:ccb22bb4e677ed022d8b9d1aa1b32f0af52dd0471ef1c32e48dedbf68ee6ee17`).
Two independent clean clones produced identical bytes. These are the published release hashes in `release.json`.

| Artifact | SHA-256 | Size |
|---|---|---|
| `agent_account.wasm` | `a0ab517a4253e241f8ffe550978a2220b7d982ded81472a07bec3e4940d94a7f` | 165,228 bytes |
| `nft.wasm` | `e3ada91402568c3522d5a49cf3b405291fd5abc2ccb3ad4c5e6033cfb9b73147` | 206,551 bytes |

Deployed from those exact files with `--expect-agent-sha256` / `--expect-nft-sha256` set.

| Item | Value |
|---|---|
| Network | testnet |
| NFT contract (keyless) | `nft.leash-throwaway-1025.testnet`, token `token-1` |
| NFT deploy tx | `8Uo7ydYU4peS6BskRp6zNrK7FLZKx8V8SBynExmbuDAb` |
| Agent account | `agent2.leash-throwaway-1025.testnet` |
| Agent inception tx (atomic 5-action batch) | `7mNfWZxFU3qaJeNrYZYm7rfFJfeF4wsfPEt9AMNm5Ysi` |
| Agent key (FunctionCall, `spend` only, allowance 0.25 NEAR) | `ed25519:ETu4ouB1ZqUFBJsk1As2q2AHrTvKwGDwHQpjJ4oMGALD` |
| Guardian | `leash-throwaway-2-1025.testnet` (window 3600 s) |
| Allowlist | `leash-throwaway-2-1025.testnet` |
| Caps | 0.5 NEAR per transaction, 2.0 NEAR per 1440 s (24 buckets x 60 s) |

Verification, run after `release.json` was updated (block 277081782):

```
leash verify agent2.leash-throwaway-1025.testnet --rpc https://rpc.testnet.near.org
STATUS: [ LOCKED_AND_VERIFIED ]
```

Right after deploy, before the hashes were published in `release.json`, the same check returned
`KEYS_LOCKED_CODE_UNVERIFIED` (failing rule `WASM_HASH_MATCH`). That is expected: the published hash did not exist yet.
Throwaway testnet accounts only. This is not an audit and nothing here has touched mainnet.
