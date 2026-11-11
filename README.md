# Leash — Give AI a budget, not your life savings

> Autonomous AI agents need money to operate, but granting an LLM raw private keys is an invitation to catastrophic loss. Leash provides bounded spending limits, keyless account architecture, and cryptographic supervisory control on NEAR Protocol.

---

## ⚡ 5-Minute Judge & Evaluator Path

- **Live Web Inspector:** [https://leash-near.vercel.app/](https://leash-near.vercel.app/)
- **Testnet Agent Account:** `agent2.leash-throwaway-1025.testnet`
- **RPC Endpoint:** `https://rpc.testnet.near.org`
- **Supervisory NFT Contract:** `nft.leash-throwaway-1025.testnet` (Token `token-1`, keyless)
- **Live Inception Tx:** [`7mNfWZxFU3qaJeNrYZYm7rfFJfeF4wsfPEt9AMNm5Ysi`](https://testnet.nearblocks.io/txns/7mNfWZxFU3qaJeNrYZYm7rfFJfeF4wsfPEt9AMNm5Ysi)
- **Live Verdict:** **`LOCKED_AND_VERIFIED`** (Zero FullAccess Keys, Single Scoped Spend Key, Bytecode SHA-256 Match, Keyless NFT).

---

## What It Is

Leash is an account security kernel for autonomous AI agents. The agent account is born permanently locked with zero FullAccess keys, holding only a single restricted FunctionCall access key strictly bounded by mathematical expenditure caps.

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
4. **Storage Floor Preservation:** Contract state storage costs (~2.1 NEAR) are permanently protected. Spends and withdrawals that would drop balance below the storage floor are rejected.

---

## Real Contract Gas & Resource Budget

Measured directly against the production contract in NEAR Sandbox:
- **Successful `spend()`:** `total_gas_burnt = 4,391,658,230,052 gas` (~4.39 TGas $pprox$ 0.000439 NEAR).
- **Reverted `spend()` (exceeding cap):** `total_gas_burnt = 1,585,532,441,294 gas` (~1.59 TGas $pprox$ 0.000159 NEAR).
- **Upfront attached gas reservation:** ~0.0309 NEAR (at 30 TGas attached).
- **Call Capacity (Approximate, 0.25 NEAR Gas Allowance at 30 TGas Attached):**
  - **Successful calls:** $\approx 499$ calls ($(0.25 - 0.0309) / 0.000439 \approx 499$, assuming 4.39 TGas net burn).
  - **Reverted calls:** $\approx 1,380$ calls ($(0.25 - 0.0309) / 0.000159 \approx 1,380$, assuming 1.59 TGas net burn).

---

## Demo Scenarios

The offline demo runner (`make demo` [Planned]) executes three deterministic scenarios:

- **Scenario A: Legitimate Operation Within Cap**  
  Agent pays an allowlisted vendor 0.2 NEAR for compute. All guards pass; transfer succeeds; spend is recorded in the active ring buffer bucket.
- **Scenario B: Malicious Over-Cap Invoice**  
  Agent attempts an unauthorized spend of 2.0 NEAR (exceeding the 1.0 NEAR per-tx cap). Guard 5 triggers; transaction reverts; contract state remains unchanged (gas fee burnt).
- **Scenario C: Supervisory Ownership Sale & Transfer**  
  Controller NFT is transferred to a new owner account. The previous owner's pending timelocked requests are invalidated; the new owner assumes exclusive supervisory control.

---

## Verification & Quickstart

### Prerequisites
- Rust 1.81+ with `wasm32-unknown-unknown` target
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

Outputs one of three definitive states:
- `LOCKED_AND_VERIFIED` (0 FullAccess keys, exactly 1 scoped FunctionCall key, bytecode matches `release.json`)
- `KEYS_LOCKED_CODE_UNVERIFIED` (Keys strictly locked, but bytecode hash is unreleased or differs)
- `NOT_LOCKED` (FullAccess keys or unauthorized permissions detected)

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

## License

MIT