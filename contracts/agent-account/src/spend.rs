/// spend.rs — core spend logic as a plain impl block (no #[near_bindgen]).
///
/// Rule: NO near-sdk macros here. All #[near_bindgen] method declarations live
/// in lib.rs. This avoids the AgentAccountExt-not-in-scope error that occurs
/// when near_bindgen is used in a submodule that can't see the type generated
/// in the root module.
use near_sdk::{env, AccountId, Gas, NearToken, Promise};

use crate::ring::RingRef;
use crate::AgentAccount;
// ext_self is declared in lib.rs; import it here for use in spend_inner.
use crate::ext_self;

/// Extra storage headroom reserved above actual usage (bytes).
const STORAGE_MARGIN_BYTES: u64 = 10_000;
/// Gas reserved for private rollback callback.
const CALLBACK_GAS: Gas = Gas::from_tgas(5);

impl AgentAccount {
    // ── Storage floor ──────────────────────────────────────────────────────

    pub(crate) fn storage_floor(&self) -> u128 {
        let bytes = env::storage_usage() + STORAGE_MARGIN_BYTES;
        bytes as u128 * env::storage_byte_cost().as_yoctonear()
    }

    // ── Ring buffer borrow ─────────────────────────────────────────────────

    pub(crate) fn ring_ref(&mut self) -> RingRef<'_> {
        RingRef {
            ring:               &mut self.ring,
            ring_head:          &mut self.ring_head,
            ring_head_start_ns: &mut self.ring_head_start_ns,
            period_ns:          self.period_ns,
        }
    }

    // ── Core spend logic ───────────────────────────────────────────────────

    /// All guards, ordered cheapest first.
    pub(crate) fn spend_inner(
        &mut self,
        amount:    NearToken,
        recipient: AccountId,
        memo:      Option<String>,
    ) -> Promise {
        // 1. Boolean flag — cheapest guard
        assert!(!self.paused, "paused");

        // 2. Predecessor must be self (agent account caller)
        assert_eq!(
            env::predecessor_account_id(),
            env::current_account_id(),
            "predecessor must be current_account_id"
        );

        // 3. Key identity — one env call
        assert_eq!(
            env::signer_account_pk(),
            self.agent_key,
            "wrong signer key"
        );

        // 4. Memo length bound
        if let Some(ref m) = memo {
            assert!(m.len() <= 256, "memo exceeds 256 bytes");
            env::log_str(&format!("memo: {}", m));
        }

        // 5. Per-tx cap — arithmetic only
        assert!(amount <= self.per_tx_cap, "exceeds per_tx_cap");

        // 6. Period cap — advance ring then sum in one borrow scope
        let current_sum = {
            let mut r = self.ring_ref();
            r.advance(env::block_timestamp());
            r.sum()
        };
        assert!(
            current_sum.saturating_add(amount.as_yoctonear()) <= self.period_cap.as_yoctonear(),
            "exceeds period_cap"
        );

        // 7. Allowlist — linear scan (≤10 entries)
        assert!(
            self.allowlist.contains(&recipient),
            "recipient not in allowlist"
        );

        // 8. Storage floor — most expensive (several env calls); last guard
        let floor = self.storage_floor();
        assert!(
            env::account_balance().as_yoctonear() >= amount.as_yoctonear() + floor,
            "spend would drop balance below storage floor"
        );

        // All guards passed — record spend in ring before transfer
        let bucket_index = {
            let mut r = self.ring_ref();
            r.add(amount.as_yoctonear())
        };

        Promise::new(recipient)
            .transfer(amount)
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .spend_callback(amount, bucket_index),
            )
    }

    // ── Core spend_callback logic ──────────────────────────────────────────

    /// Roll back the ring bucket if the transfer failed.
    /// `bucket_index` is the slot active at spend time — may differ from current head.
    pub(crate) fn spend_callback_inner(&mut self, amount: NearToken, bucket_index: u8) {
        let succeeded = env::promise_result_checked(0, 0).is_ok();
        if !succeeded {
            let mut r = self.ring_ref();
            r.sub(amount.as_yoctonear(), bucket_index);
        }
    }
}
