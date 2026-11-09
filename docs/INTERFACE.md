# Leash — Smart Contract Interface Specification

Version: `v0.1.0`  
Standard: NEAR Protocol Smart Contract Specification  
Primary Contracts:
- `agent_account` (Security Kernel & Spending Controller)
- `nft` (NEP-171 Supervisory Ownership Token)

---

## 1. `agent_account` Contract Interface

### Initialization

#### `new`
Initializes the agent account with spending parameters, access key, and supervisory bindings. Must be called once during account creation batch. Re-initialization panics with `"contract already initialized"`.

```json
{
  "nft_contract": "nft.leash.near",
  "nft_token_id": "token-1",
  "guardian": "guardian.leash.near",
  "agent_key": "ed25519:...",
  "allowlist": ["vendor1.near", "vendor2.near"],
  "per_tx_cap": "1000000000000000000000000",
  "period_cap": "5000000000000000000000000",
  "period_seconds": 86400,
  "guardian_window_seconds": 86400
}
```

**Preconditions:**
- `per_tx_cap <= period_cap`
- `period_seconds >= 1440` (24 minutes minimum, enforcing >= 60s per rolling bucket)
- `guardian_window_seconds >= 3600` (1 hour) in production; `>= 1` in testing builds
- `guardian_window_seconds <= 2592000` (30 days maximum)
- `allowlist.len() <= 10`

---

### Agent Operations

#### `spend`
Dispatches a transfer from the agent account to an allowlisted recipient within calibrated spending caps. Must be signed by the restricted FunctionCall key (`agent_key`).

```json
{
  "amount": "200000000000000000000000",
  "recipient": "vendor1.near",
  "memo": "compute inference payment"
}
```

**Guard Enforcement Sequence:**
1. `!self.paused` (Panic: `"contract is paused"`)
2. `predecessor == current_account_id` (Panic: `"only self"`)
3. `signer_pk == self.agent_key` (Panic: `"only agent key"`)
4. `memo.len() <= 256` (Panic: `"memo too long"`)
5. `amount <= self.per_tx_cap` (Panic: `"exceeds per_tx_cap"`)
6. `ring.sum() + amount <= self.period_cap` (Panic: `"exceeds period_cap"`)
7. `self.allowlist.contains(recipient)` (Panic: `"recipient not allowlisted"`)
8. `account_balance - amount >= storage_floor` (Panic: `"spend would breach storage floor"`)

**Callback Handling:**
Dispatches `Promise::new(recipient).transfer(amount)` followed by `.then(on_transfer_complete(amount, bucket_index))`. If the transfer promise fails, the added amount in `bucket_index` is rolled back via `ring.sub(bucket_index, amount)`.

---

### View Methods (Read-Only)

#### `is_testing_build`
Stateless view function returning `true` only if compiled with `--features testing`. Production builds return `MethodNotFound`.

```json
{} -> bool
```

#### `get_status`
Returns public configuration and state status.

```json
{} -> {
  "paused": false,
  "per_tx_cap": "1000000000000000000000000",
  "period_cap": "5000000000000000000000000",
  "period_seconds": 86400,
  "guardian_window_seconds": 86400,
  "allowlist": ["vendor1.near"],
  "guardian": "guardian.near",
  "has_pending": false
}
```

#### `get_current_period_spend`
Calculates instantaneous spending sum across active buckets without mutating state.

```json
{} -> "200000000000000000000000"
```

#### `get_owner_slot`
Returns currently pending timelocked action, or `null`.

```json
{} -> {
  "kind": { "Loosen": { "new_per_tx": "...", "new_period": "..." } },
  "proposer": "alice.near",
  "deadline": 1793080000000000000,
  "expiry": 1793166400000000000
}
```

---

### Supervisory Owner Interface (Bearer via NEP-171)

#### `supervisory_action`
Entrypoint for the holder of the supervisory NFT token. Triggers a cross-contract lookup to verify token ownership before executing or enqueuing.

```json
{
  "action": {
    "Pause": {}
  }
}
```

Supported `Action` variants:
1. `Pause`: Instantly sets `paused = true`.
2. `Tighten { new_per_tx, new_period }`: Instantly lowers caps. Precondition: non-increasing and at least one strictly lower. Cancels any pending `Loosen` in slot.
3. `Request { kind }`: Enqueues an action subject to guardian delay (`deadline = now + guardian_window`, `expiry = now + 2 * guardian_window`). Overwrites expired or transfer-stale pending slot.
4. `CancelOwn`: Cancels currently pending action proposed by current owner.
5. `Execute`: Executes approved pending action once `now >= deadline && now < expiry`.

Supported `ActionKind` variants for `Request`:
- `Loosen { new_per_tx, new_period }`
- `AddAllowlist { account }`
- `RemoveAllowlist { account }`
- `ReplaceGuardian { new_guardian }`
- `Withdraw { amount }` (preserves storage floor; transfers directly to current NFT owner)
- `Unpause` (subject to timelock delay)

---

### Guardian Interface

#### `guardian_cancel`
Guardian cancels any pending timelocked action in `owner_slot`.

```json
{} -> null
```

#### `guardian_pause`
Guardian instantly freezes agent account (`paused = true`).

```json
{} -> null
```