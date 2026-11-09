use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{AccountId, NearToken};

// ── Pending owner slot ──────────────────────────────────────────────────────

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct PendingAction {
    pub kind:     ActionKind,
    /// predecessor_account_id captured at entry — never re-read from env in callback
    pub proposer: AccountId,
    /// earliest execute: block_timestamp_ns
    /// SPIKE-3: switch to block_index if fast_forward does not advance block_timestamp
    pub deadline: u64,
    /// latest execute = deadline + guardian_window_ns
    pub expiry:   u64,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub enum ActionKind {
    Loosen  { new_per_tx: NearToken, new_period: NearToken },
    Unpause,
    Withdraw { amount: NearToken },
}

// ── Guardian replacement ─────────────────────────────────────────────────────

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct PendingGuardian {
    pub new_guardian: AccountId,
    /// owner must confirm before this timestamp ("confirm_by", not "deadline")
    pub confirm_by:   u64,
}

// ── Action enum for on_owner_confirmed dispatch ──────────────────────────────

/// Passed as a serialised argument through the cross-contract callback chain.
/// Values are validated at entry; the callback re-validates against current state.
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub enum Action {
    Pause,
    Tighten    { new_per_tx: NearToken, new_period: NearToken },
    Request    { kind: ActionKind },
    CancelOwn,
    Execute,
    ConfirmGuardianReplacement,
}
