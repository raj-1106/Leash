# Leash — Give AI a budget, not your life savings

> An AI agent that can spend needs a key, and a key held by an LLM can be stolen or tricked into draining the wallet. Leash is a NEAR account for an agent that is born with no full-access key. The agent holds one scoped key that can only call `spend`, and the contract enforces a per-transaction cap, a rolling period cap and a recipient allowlist. The agent is owned by an NFT, and anyone can check the setup with `leash verify`.

**Built at NEAR HACKATHON 2026 (NFTs and Security tracks), solo.** Status: tested on testnet, not audited, no mainnet deployment. See [Limits](#limits).

---

## ⚡ 5-Minute Judge & Evaluator Path

- **Live Web Inspector:** [https://leash-near.vercel.app/](https://leash-near.vercel.app/)
- **Testnet Agent Account:** `agent2.leash-throwaway-1025.testnet`
- **RPC Endpoint:** `https://rpc.testnet.near.org`
- **Supervisory NFT Contract:** `nft.leash-throwaway-1025.testnet` (Token `token-1`, keyless)
- **Live Inception Tx:** [`7mNfWZxFU3qaJeNrYZYm7rfFJfeF4wsfPEt9AMNm5Ysi`](https://testnet.nearblocks.io/txns/7mNfWZxFU3qaJeNrYZYm7rfFJfeF4wsfPEt9AMNm5Ysi)
- **Live Verdict:** **`LOCKED_AND_VERIFIED`** (Zero FullAccess Keys, Single Scoped Spend Key, Bytecode SHA-256 Match, Keyless NFT).
- **Release:** tag `v0.1.0` (commit `ed243b3`), built reproducibly in a pinned Docker image. Hashes are in [`release.json`](release.json).

**Try it in 30 seconds (needs Node 20+):**

```bash
git clone https://github.com/raj-1106/Leash && cd Leash/tools && npm ci && npm run build
node dist/src/cli.js verify agent2.leash-throwaway-1025.testnet --rpc https://rpc.testnet.near.org
# STATUS: [ LOCKED_AND_VERIFIED ]
```

---

## What It Is

Leash is an account security kernel for autonomous AI agents. The agent account is created with zero FullAccess keys, holding only a single restricted FunctionCall access key. The contract limits what that key can spend.

```
┌────────────────────────────────────────────────────────┐
│                   Agent Account                        │
│                                                        │
│  [Scoped Key] ──► spend()                              │
│                    ├── 1. Paused?                      │
│                    ├── 2. Predecessor == Self?         │
│                    ├── 3. Signer PK == Agent Key?      │
│                    ├── 4. Memo <= 256 bytes?           │
│                    ├── 5. Amount <= Per-Tx Cap?        │
│                    ├── 6. Sum + Amount <= Period Cap?  │
│                    │     (24-Bucket Sliding Window)    │
│                    ├── 7. Recipient in Allowlist?      │
│                    └── 8. Balance - Amount >= Floor?   │
│                                                        │
│  [NEP-171 NFT] ──► Supervisory Owner                   │
│                    ├── Instant: Pause, Tighten Caps    │
│                    └── Timelocked: Loosen, Withdraw    │
└────────────────────────────────────────────────────────┘
```

---

## Core Security Invariants

1. **Zero FullAccess Keys (Keyless at Birth):** Created via an atomic 5-action batch transaction (`CreateAccount`, `Transfer`, `Deploy`, `new`, `AddKey`). The account has no master password.
2. **24-Bucket Sliding Window:** Period spending limits advance across 24 discrete rolling time buckets, preventing burst draining across window boundaries. Failed transfers trigger private indexed rollbacks.
3. **NEP-171 Bearer Supervisory Ownership:** Ownership is represented by a single-supply NFT. The bearer of the NFT can pause the agent or tighten limits instantly. Loosening caps or withdrawing balance requires a guardian timelock delay.
4. **Storage Floor Preservation:** The contract keeps a balance floor for its own storage costs (~2.1 NEAR). Spends and withdrawals that would drop the balance below the floor are rejected.

---

## Real Contract Gas & Resource Budget

Measured directly against the production contract in NEAR Sandbox:
- **Successful `spend()`:** `total_gas_burnt = 4,391,658,230,052 gas` (about 4.39 TGas, 0.000439 NEAR).
- **Reverted `spend()` (exceeding cap):** `total_gas_burnt = 1,585,532,441,294 gas` (about 1.59 TGas, 0.000159 NEAR).
- **Upfront attached gas reservation:** ~0.0309 NEAR (at 30 TGas attached).
- **Call Capacity (Approximate, 0.25 NEAR Gas Allowance at 30 TGas Attached):**
  - **Successful calls:** about 499, from (0.25 - 0.0309) / 0.000439.
  - **Reverted calls:** about 1,380, from (0.25 - 0.0309) / 0.000159.

---

## Live Demo on Testnet

`make demo-testnet` signs as the agent's scoped key on testnet and tries three spends:

| | Spend | Result |
|---|---|---|
| A | 0.1 NEAR to an allowlisted account | succeeds |
| B | 0.6 NEAR, over the 0.5 NEAR per-tx cap | reverts: `exceeds per_tx_cap` |
| C | 0.1 NEAR to an account not on the allowlist | reverts: `recipient not in allowlist` |

Both attacks fail inside the contract, not in client code. A fourth scenario, a supervisory NFT transfer that invalidates the previous owner's pending requests, is covered by the integration tests.

---

## Verification & Quickstart

### Prerequisites
- Node 20+ (verifier CLI and web inspector)
- Rust (version pinned in `rust-toolchain.toml`) with the `wasm32-unknown-unknown` target
- `cargo-near` CLI
- Docker (for reproducible release verification)

### Do X → See Y Verification

```bash
# 1. Build contract artifacts (production and testing wasms)
make build
# Expected output:
# ✓ Contract successfully built! Binary: target/near/agent_account/agent_account.wasm
# ✓ Contract successfully built! Binary: target/near/nft/nft.wasm

# 2. Run the complete test suite (7 unit + 31 integration + 42 verifier & parity tests = 80 total)
make test
# Expected output:
# test result: ok. 7 passed; 0 failed; finished in 0.00s
# test result: ok. 31 passed; 0 failed; finished in ~100s
# ℹ tests 42, pass 42, fail 0

# 3. Verify mutation testing defense (all 14 mutants caught cleanly)
./scripts/run_all_mutants.sh
# Expected output:
# 🎯 ALL 14 / 14 MUTANTS CAUGHT CLEANLY!

# 4. Run live sandbox harness with deployed agent and keyless NFT contracts
make demo-live

# 4b. Run the live testnet spend demo (needs the agent key file, see Live Demo)
# make demo-testnet

# 5. Verify zero DOM sinks in frontend inspector
make ui-test
# Expected output:
# 0 sinks detected (0 innerHTML/eval/document.write)

# 6. Reproducible Docker verification (verifies byte-for-byte compiler reproducibility)
# Note: Requires Docker daemon running. Takes ~1-2 min for working tree, ~3-4 min for 2x clean-clone verification.
make repro                # Builds from working tree HEAD in Docker container
make repro-clean          # 2x clean-clone hash stability check (usage: make repro-clean REF=v0.1.0)
# Expected output:
# 🎉 HASH STABILITY CONFIRMED! (2x RUN MATCHES 100%)
```

> **Security & CSP Architecture**:
> - **Script Execution (`script-src 'self'`)**: Strictly prohibits inline scripts, eval, and third-party remote scripts. Zero DOM sinks (`innerHTML`, `outerHTML`, `eval`, `document.write` are forbidden and enforced via `make ui-test`).
> - **Styling (`style-src 'self' 'unsafe-inline'`)**: Allows inline styles for dynamic fuel meters, progress bars, and reactive CSS custom properties.
> - **RPC Connectivity (`connect-src`)**: Deployed builds (e.g. Vercel) connect exclusively to public RPC endpoints (`https://rpc.testnet.near.org` and `https://rpc.mainnet.near.org`). Local development environments additionally allow `http://127.0.0.1:*` / `http://localhost:*` to interact with `near-kit/sandbox`.

---

## Verifier CLI & Static Fallback UI (`--html`)

The Leash Verifier CLI inspects any agent account on-chain or in local sandbox and outputs truthful verdicts:

```bash
# Terminal output:
cd tools && node dist/src/cli.js verify <agent_account_id> --rpc http://localhost:3030

# Generate a self-contained, zero-runtime-JS HTML verification report:
cd tools && node dist/src/cli.js verify <agent_account_id> --rpc http://localhost:3030 --html report.html
```

Outputs one of these states:
- `LOCKED_AND_VERIFIED` (0 FullAccess keys, exactly 1 scoped FunctionCall key, bytecode matches `release.json`)
- `KEYS_LOCKED_CODE_UNVERIFIED` (Keys strictly locked, but bytecode hash is unreleased or differs)
- `NOT_LOCKED` (FullAccess keys or unauthorized permissions detected)
- `TESTING_BUILD` (the bytecode exports testing-only methods)
- `ERROR` (the account could not be read)

---

## Truthful Web Inspector & Landing Editor

Run the local web inspector:
```bash
make ui-dev
# Serves at http://localhost:8080
```
- Includes the IDE Landing Page Editor (`README.md`, explorer sidebar, interactive CLI runner).
- Computes single-verdict parity against `tools/src/evaluator.ts` with zero DOM sinks.
- Features dynamic SVG gas meters, character-level hash diffs, and 375px mobile responsiveness.
- Ready for 1-click cloud deployment via root `vercel.json`.

---

## Limits

- Tested, not audited. Do not put real funds behind it.
- Deployed on testnet only. There is no mainnet deployment.
- The cap logic bounds what the scoped key can spend. It does not protect a recipient on the allowlist from being malicious.
- The spend key's gas allowance is not refunded, so a compromised key can still burn its allowance (0.25 NEAR here) on failed calls.

## About this project

Built solo for NEAR HACKATHON 2026. Design and early prototyping started about 25 Oct, before the 1 Nov submission window, with the organizers' approval. This public repository was created on 9 Nov and its history starts there.

---

## License

MIT