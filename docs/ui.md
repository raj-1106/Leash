# LEASH // User Interface Architecture & Security Inspector Specification

## 1. Executive Summary & Design System

The Leash Security Console is a tactical cryptographic supervisory interface built for autonomous AI agent accounts on NEAR Protocol. It departs entirely from generic administrative dashboards, utilizing a cybernetic mission-control cockpit aesthetic:
- **Aesthetic Palette:** Deep Obsidian (`#07090e`), High-Contrast Electric Cyan (`#00f0ff`), Emerald Green (`#10b981`), Radiant Violet (`#a855f7`), and Alert Coral (`#ff3366`).
- **Ambient Canvas:** Particle constellation canvas with mouse proximity repulsion.
- **Synthesized SFX:** Web Audio API procedural oscillator sound effects for button clicks, cryptographic verification chimes, and safety alert buzzers.
- **Responsive Architecture:** Fully responsive down to 375px mobile viewports with zero horizontal overflow, flexible CSS grid columns, and touch-optimized controls.

---

## 2. Real Shapes & u64 Nanosecond Timestamp Precision

NEAR Protocol block timestamps and contract timelocks are represented as 64-bit unsigned integers in nanoseconds (`u64`, values $pprox 1.79 \times 10^{18}$). 
JavaScript numbers are IEEE 754 double-precision floats where `Number.MAX_SAFE_INTEGER` is $2^{53} - 1 = 9,007,199,254,740,991$ ($pprox 9 \times 10^{15}$). Standard `JSON.parse` will silently corrupt u64 nanosecond values.

### Handling Strategy:
- Contract responses quote timestamp strings (`"deadline_ns": "..."`, `"expiry_ns": "..."`).
- The parser processes values using native JavaScript `BigInt(val)`.
- Boundary evaluation:
  1. `nowNs < deadlineNs`: Timelock Delay Active (Guardian Review Window open, countdown displayed).
  2. `deadlineNs <= nowNs && nowNs <= expiryNs`: Executable Window Open (Owner can execute proposal).
  3. `nowNs > expiryNs`: Proposal Expired (Slot ready for cancellation/reuse).

---

## 3. Spending Meter & Financial Loss Mechanics

The contract implements a 24-bucket sliding ring buffer. Public view methods (`get_state`) return the aggregate window expenditure.

- **Aggregate Reporting:** A prominent informational disclaimer explicitly states that per-bucket spend is kept in internal contract storage and is not exposed in public views without an indexer or raw `view_state` traversal.
- **Spendable Balance & Storage Floor:** Spendable balance is calculated as:
  $$\text{Spendable Balance} = \text{Total Account Balance} - \text{Storage Reserve Floor (\approx 2.1 NEAR)}$$
- **Maximum Financial Loss:**
  $$\text{Max Loss} = \min(\text{Period Cap}, \text{Spendable Balance})$$
- **Gas Capacity Arithmetic:**
  With 0.25 NEAR key allowance and 30 TGas attached:
  $$\text{Estimated Calls} = \frac{\text{Allowance} - \text{Reservation Burn}}{\text{Net Gas Burn}}$$
  - Successful spend (4.39 TGas net burn): **~499 calls**
  - Reverted spend (1.59 TGas net burn): **~1,380 calls**

---

## 4. Cryptographic Key Structure Verification & Honest Caveat

The header verification banner is titled **KEY STRUCTURE VERIFIED** (retitled from "Keys cannot change" to reflect exact cryptographic realities):
- **Single-Block Pinning:** All RPC queries are pinned to a specific block hash via `{ "block_id": "..." }` to prevent time-of-check to time-of-use (TOCTOU) race conditions.
- **Verification Criteria:**
  1. Total access keys equals 1.
  2. Total FullAccess keys equals 0.
  3. FunctionCall key is strictly scoped to `spend()` on `current_account_id`.
  4. Allowance is bounded and positive.
  5. Controller NFT contract holds zero access keys.
  6. Deployed WASM hash matches `release.json`.
- **Cryptographic Caveat Disclosure:**
  *The release SHA-256 hash proves deployed bytecode equals the reproducible build (`ca56984...2e04`). Standard near-sdk runtime imports host functions (`promise_batch_action_*`). Bytecode hash matching proves the binary is identical to the verified build; proving the key-adding host function is mathematically unreachable requires WebAssembly call-graph analysis.*

---

## 5. Warnings Engine (7 Evaluated Invariants)

1. **Cap Exceeds Spendable Balance:** Fires if `period_cap >= spendable_balance` or `per_tx_cap >= spendable_balance`.
2. **Guardian Collusion Risk:** Fires if `state.guardian.toLowerCase() === state.nft_owner.toLowerCase()`.
3. **Emergency Paused:** Fires if `state.paused === true`.
4. **Pending Supervisory Action:** Fires if `state.has_pending === true`.
5. **Low Key Gas Allowance:** Fires if allowance is below 20 reservation burns ($< 0.06$ NEAR).
6. **Key Mismatch (Split-Brain):** Fires if `state.agent_key !== on_chain_key`.
7. **Max Loss Display:** Continuously computes and surfaces $\min(\text{Period Cap}, \text{Spendable Balance})$.

---

## 6. NEP-171 Supervisory NFT Card & 3D Visualizer

- Surfaces `nft_contract`, `token_id`, and `owner_id`.
- Renders an interactive 3D CSS holographic rotating cube displaying token metadata.
- Tags status as "VERIFIED ON-CHAIN" when confirmed via cross-contract NEP-171 query, or "SELF-REPORTED" otherwise.
- Handles missing NFT data gracefully by rendering "Unavailable" and skipping guardian-equals-owner collision checks.

---

## 7. Deterministic Sandbox Replay Player (`demo-run.json`)

The replay engine reads the deterministic execution output of `make demo` (Scenarios A, B, C):
- **Scenario A (Legitimate Spend):** 0.2 NEAR spend within cap $\rightarrow$ Success, 4.38 TGas net burn. Animated cyan packet passes through the security firewall.
- **Scenario B (Over-Cap Invoice):** 2.0 NEAR spend $\rightarrow$ Revert (`exceeds per_tx_cap`). Animated red packet triggers firewall alert shield.
- **Scenario C (Supervisory Ownership Transfer):** Dave acquires NFT $\rightarrow$ Alice rejected with `not owner`, Dave rejected with `proposer is no longer owner`.
- **Playback Controls:** Step backward, Play/Pause, Step forward, Speed selection ($0.5\times, 1\times, 2\times, 5\times$), Custom JSON upload, and Log Clipboard copy.

---

## 8. Deployment & Makefile Targets

- `make ui`: Serves the console locally via Python HTTP server at `http://localhost:8080`.
- `make ui-docker`: Builds and runs the Docker container with `nginx:alpine` on port 8080.
- `make demo`: Re-executes the offline nearcore sandbox scenario test and refreshes `demo-run.json`.
