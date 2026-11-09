# Leash Threat Model & Security Properties

## 1. Executive Summary

Leash provides cryptographic supervisory control and deterministic expenditure bounds for autonomous AI agents on NEAR Protocol. 

Traditional autonomous agents present existential financial risk: if an LLM is hijacked via prompt injection, corrupted by hallucinations, or suffers key exfiltration, an unconstrained private key can instantly drain all account funds, delete account state, or deploy malicious contracts.

Leash bounds the damage of these failure modes by enforcing that the agent operates under contract-enforced spending limits where:
1. **The agent holds zero FullAccess keys.**
2. **The agent's sole key is a restricted `FunctionCall` key constrained to `spend()`.**
3. **Outbound transfers are strictly capped by a sliding-window rate limiter, per-transaction limits, counterparty allowlists, and a liquid balance storage floor.**
4. **Supervisory governance is tokenized into a keyless NEP-171 NFT controller, enabling timelocked pauses and withdrawals without permanent key custody.**

---

## 2. Adversarial Model

We define the adversary ($\mathcal{A}$) as having **full and arbitrary control over the agent's signing key and runtime logic**:
- **Prompt Injection & Memory Corruption:** $\mathcal{A}$ can induce the LLM agent to sign arbitrary payloads calling `spend()`.
- **Arbitrary Parameter Fuzzing:** $\mathcal{A}$ can pass negative, zero, maximal $u128$, or malformed arguments.
- **Key Exfiltration:** $\mathcal{A}$ possesses the Ed25519 private key corresponding to the agent's access key.
- **RPC & Network Reordering:** $\mathcal{A}$ can submit concurrent transactions, flood the network, or attempt front-running.

### Out of Scope / Fundamental Assumptions
- **NEAR Protocol Consensus:** We assume NEAR's cryptographic primitives (Ed25519, SHA-256) and consensus layer are secure.
- **Supervisory Controller Integrity:** The holder of the NEP-171 Controller NFT is assumed to act in good faith when approving timelocked upgrades or withdrawals.

---

## 3. Trust Boundaries & Security Invariants

### Invariant 1: Zero FullAccess Keys
The agent account must have exactly zero FullAccess keys at all times.
- **Enforcement:** Verified during atomic birth batch and continuously checked by the Verifier.
- **Tested Security Property:** The agent cannot execute `AddKey`, `DeleteKey`, `DeployContract`, `DeleteAccount`, or call arbitrary smart contract methods outside `spend()`.

### Invariant 2: Scoped FunctionCall Key
The agent account possesses at most one FunctionCall key, strictly restricted to:
$$\text{receiver\_id} = \text{self}$$
$$\text{method\_names} = [\text{"spend"}]$$
$$\text{allowance} \in (0, \infty)$$
- **Tested Security Property:** The key cannot sign transactions to external contracts. All gas and transaction fees must be routed through the on-chain validation kernel.

### Invariant 3: Sliding-Window Rate Limiting
Outbound expenditure is bounded by a discrete 24-bucket circular ring buffer:
- Each bucket represents $\Delta t = \text{period} / 24$.
- The effective rolling expenditure window is at least $\text{period} - \Delta t$.
- **Tested Rate-Limit Bound:** In the event of catastrophic agent compromise, the empirical maximum value an adversary can extract before supervisory intervention is:
$$L_{\max} = \min(\text{cap}_{\text{period}}, \text{spendable\_balance})$$

### Invariant 4: Storage Floor Protection
The contract calculates the exact storage staking requirements for state and code plus an immutable safety cushion (2.1 NEAR):
$$\text{balance}_{\text{liquid}} - \text{amount} \ge \text{storage\_floor}$$
- **Tested Security Property:** An agent cannot spend funds down to a level that causes storage eviction or contract freezing.

### Invariant 5: NEP-171 Supervisory Ownership
All administrative privileges (emergency pausing, parameter adjustment, timelocked withdrawals) are bound to the holder of token `token-1` on an independent keyless NFT contract (`nft.leash.near`).
- When the NFT is transferred or sold, in-flight supervisory proposals initiated by the prior owner are instantly invalidated.
- Execution requires an asynchronous cross-contract call (`nft_token`) confirming current ownership at execution time.

### Invariant 6: Concurrency & Re-Entrancy Nullification
All timelocked proposals use an atomic `slot.take()` pattern:
```rust
let proposal = self.timelocked_slot.take()
    .expect("no pending proposal or already executed");
```
- **Tested Concurrency Property:** If multiple callbacks or concurrent execution transactions arrive in the same block, exactly one succeeds; subsequent executions fail immediately with no state mutation.

---

## 4. Gas Capacity Economics & Drainage Model

Because the agent's key has a finite gas allowance, every transaction drains the allowance based on net execution burn, even though NEAR upfront reserves gas:

$$\text{Estimated Calls} = \left\lfloor \frac{\text{allowance} - \text{reservation}}{\text{netBurnGas} \times 10^8} \right\rfloor$$

Where:
- $\text{reservation} = \text{gasAttached} \times 10^9 + 918{,}880{,}207{,}164{,}400{,}000{,}000\text{ yN}$ (base receipt fee)
- $\text{netBurnGas} = 4.39\text{ TGas}$ (measured on-chain for successful transfer)
- $\text{netBurnGas} = 1.59\text{ TGas}$ (measured on-chain for contract panic / revert)

If $\text{allowance} \le \text{reservation}$, the key cannot clear the protocol gateway.

---

## 5. Verification Matrix & Verdict Mapping

The Verifier implements a 5-outcome deterministic state machine:

| Verdict | Conditions | Security Implication |
| :--- | :--- | :--- |
| `LOCKED_AND_VERIFIED` | 0 FullAccess keys, 1 scoped `spend()` key, deployed WASM matches published release SHA-256, NFT contract is keyless and valid. | Full cryptographic containment active. Production ready. |
| `KEYS_LOCKED_CODE_UNVERIFIED` | Keys are properly locked, but published hash is null (`v0.1.0-unreleased`) or does not match deployed bytecode. | Keys are constrained, but contract logic authenticity is unverified. |
| `TESTING_BUILD` | Bytecode exports `is_testing_build` or matches known test build hashes. | **INSECURE:** Time-travel or test bypass functions present. Strictly rejected. |
| `NOT_LOCKED` | Any FullAccess key exists, allowance is null/zero, or receiver is not self. | **INSECURE:** Account can be drained or upgraded arbitrarily. |
| `ERROR` | RPC connection failed, block query failed, or account does not exist. | Verification indeterminate. Re-run against live RPC. |
