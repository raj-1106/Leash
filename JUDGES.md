# Leash — AI & Hackathon Judges Guide

## Executive Overview
**Leash** is a cryptographic supervisory control and bounded expenditure kernel for autonomous AI agents on NEAR Protocol. It converts an unconstrained, high-risk agent wallet into a verifiable, non-custodial cryptographic sandbox with tested expenditure bounds.

---

## 1. Quick Verification & Execution Commands

Every command can be run offline using the pre-compiled artifacts and sandbox harness:

```bash
# 1. Build all contracts, dev releases, tools/dist, and web ESM evaluator
make build

# 2. Run the complete test suite (7 unit, 31 integration, 42 verifier, parity & html export tests = 80 total)
make test

# 3. Execute the 5-action offline sandbox demo and export demo-run.json
make demo

# 4. Spin up persistent live near-kit sandbox with pre-funded accounts and deploy contracts
make demo-live

# 5. Verify ZERO DOM sinks in the frontend inspector
make ui-test

# 6. Serve the truthful offline Inspector UI
make ui-dev

# 7. Generate a self-contained, zero-JS cryptographic verification report
cd tools && node dist/src/cli.js verify agent.test.near --rpc http://127.0.0.1:43989 --html report.html

# 8. Reproducible Docker verification (verifies byte-for-byte build reproducibility)
# Note: Requires Docker daemon running. Takes ~1-2 min for working tree, ~3-4 min for 2x clean clones.
make repro                # Builds from working tree HEAD in Docker
make repro-clean          # 2x clean-clone hash stability check across independent clones (usage: make repro-clean REF=v0.1.0)
# Expected output:
# 🎉 HASH STABILITY CONFIRMED! (2x RUN MATCHES 100%)
```

---

## 2. Test & Verification Evidence Summary

### Suite Results
- **Unit Tests:** `cargo test -p agent-account --lib` -> **7 / 7 pass**
- **Integration Tests:** `cargo test -p integration-tests` -> **31 / 31 pass**
  - Includes real-contract gas measurement test, time-travel sliding window tests, storage floor tests, and NFT supervisory handoff tests.
- **Verifier Core, Parity & HTML Export Tests:** `npm test --prefix tools` -> **42 / 42 pass**
  - Covers all 15 verifier fixtures, strict single-file release loading, parity between `tools/src/evaluator.ts` and `web/evaluator.js`, WCAG AA contrast check, and self-contained zero-JS HTML report export.
- **Total Automated Test Gate:** **80 / 80 PASS**

### Mutation Testing Score: 14 / 14 Caught
All 14 deliberately introduced semantic defects in expenditure caps, sliding window index math, and permissions are cleanly caught by the test harness (`./scripts/run_all_mutants.sh`).

---

## 3. Verifier CLI & Standalone Fallback UI (`--html`)

The Leash Verifier provides both a terminal inspector and a self-contained HTML verification report generator:

```bash
# Terminal output:
leash verify <account_id> --rpc <url>

# Zero-JS Self-Contained Fallback Verification Report:
leash verify <account_id> --rpc <url> --html report.html
```

### Fallback Report Invariants:
1. **Zero Runtime JavaScript:** Contains `0` `<script>` tags and `0` `javascript:` references.
2. **Self-Contained Styling:** Inlined `.lt` / `.dk` design system with IBM Plex Mono typography.
3. **Truthful & Pinned:** Binds to the single block height and hash queried, distinguishing between `KEY STRUCTURE VERIFIED`, `KEYS LOOK LOCKED, CODE NOT VERIFIED`, and `NOT_LOCKED`.
4. **XSS Escaped:** All untrusted chain metadata (account IDs, hashes, notes) is strictly HTML-entity escaped.

---

## 4. Live Sandbox & Frontend Inspector (`make demo-live`)

Leash includes an automated integration harness via `near-kit/sandbox` (`scripts/demo_live.mjs`):
1. Boots a local NEAR sandbox node (`near-sandbox-2.14.0-rc.4`).
2. Provisions a keyless NEP-171 NFT contract (`nft.test.near`) in an atomic 4-action batch with `0` access keys.
3. Provisions a locked agent account (`agent.test.near`) with `10 NEAR` balance, deployed `agent_account.wasm`, and exactly `1` scoped `spend` key.
4. Serves the web inspector at `http://localhost:8080`, allowing live single-block verification and gas consumption metering.

---

## 5. Mathematical Spending Bounds & Gas Economics

NEAR transactions require an upfront reservation that is refunded upon completion. The net burn is what drains the FunctionCall key allowance:

$$\text{Estimated Calls} = \left\lfloor \frac{\text{allowance} - \text{reservation}}{\text{netBurnGas} \times 10^8} \right\rfloor$$

- **Attached Gas:** `30 TGas` (`30 \times 10^{12}` gas).
- **Upfront Reservation:** $\approx 0.0289\text{ NEAR}$ (sandbox-measured) to $0.0309\text{ NEAR}$ (testnet-measured).
- **Net Gas Burnt (Success):** $\approx 4.39\text{ TGas}$ ($\approx 0.000439\text{ NEAR}$).
- **Net Gas Burnt (Reverted Cap Exceeded):** $\approx 1.59\text{ TGas}$ ($\approx 0.000159\text{ NEAR}$).
- **Call Capacity (0.25 NEAR key allowance):**
  - $\approx 499$ successful calls ($0.25 - 0.0309) / 0.000439$.
  - If $\text{allowance} \le \text{reservation}$, the UI reports: `"cannot clear the gateway"`.

---

## 6. Truthful Offline Frontend Inspector

1. **Deterministic Single Verdict:**
   The frontend inspector computes a single verdict from the exact same rules as the CLI:
   - `LOCKED_AND_VERIFIED` (Green): Key invariants pass and bytecode matches published `release.json`.
   - `KEYS_LOCKED_CODE_UNVERIFIED` (Yellow): Keys are strictly locked, but bytecode hash is unpublished (`null`) or differs.
   - `NOT_LOCKED` (Red): FullAccess keys or unauthorized permissions detected.
2. **Strict Zero-DOM-Sinks Policy:**
   Verified via:
   ```bash
   make ui-test
   # grep -rnE 'innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function' web/
   # -> ZERO MATCHES
   ```
3. **Single Source of Truth:**
   `web/evaluator.js` is compiled directly from `tools/src/evaluator.ts` via `make web`. Both Node CLI and Browser use the identical verdict state machine.
4. **Mockup Transparency:**
   The top banner explicitly warns when viewing static fixtures vs live RPC data:
   `Sample data. Mockup. Not a real account or verdict.`
   Transitions dynamically to:
   `LIVE CHAIN VERIFICATION · Pinned single-block query · Testnet/Sandbox`
5. **Content Security Policy & Network Scoping:**
   - `script-src 'self'`: Forbids inline scripts, eval, and third-party scripts.
   - `style-src 'self' 'unsafe-inline'`: Allows inline styles for dynamic fuel meters and custom property adjustments.
   - `connect-src`: Cloud deployments (Vercel) connect strictly to public NEAR RPC (`https://rpc.testnet.near.org`, `https://rpc.mainnet.near.org`). Local dev additionally allows `http://127.0.0.1:*` / `http://localhost:*` for sandbox queries.

---

## 7. Repository Layout

| Directory / File | Description |
|---|---|
| `contracts/agent-account/` | Core supervisor-controlled agent account with 24-bucket sliding window. |
| `contracts/nft/` | Keyless NEP-171 supervisory controller NFT. |
| `contracts/toy-identity/` | Allowlisted mock vendor contract for tests and demos. |
| `tests/integration-tests/` | Near-workspaces sandbox test suite with offline demo runner. |
| `tools/src/evaluator.ts` | Pure verdict logic (zero Node imports, compiles to ESM). |
| `tools/src/verifier.ts` | CLI and RPC verifier with single-file release loading. |
| `tools/src/html_report.ts` | Zero-JS self-contained HTML verification report generator. |
| `web/` | Offline verification report, live inspector & transaction replay UI. |
| `release.json` | Release configuration (published hashes are set at git tag `v0.1.0`; holds `null` prior to tag). |
| `THREAT_MODEL.md` | Threat model, tested invariants, and security properties. |
| `JUDGES.md` | This evaluation guide. |
