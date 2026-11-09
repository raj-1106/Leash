use near_sdk::{
    env, ext_contract, near, near_bindgen, require,
    AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue, PublicKey,
};

mod ring;
mod spend;
pub mod types;

use ring::BUCKETS;
use types::{Action, ActionKind, PendingAction, PendingGuardian};

pub const INTERFACE_VERSION: u32 = 1;
pub const MIN_PERIOD_SECONDS: u64 = 24 * 60; // 1,440 s (24 minutes)
#[cfg(feature = "testing")]
pub const MIN_GUARDIAN_WINDOW_SECONDS: u64 = 1; // 1 second for fast testing in sandbox
#[cfg(not(feature = "testing"))]
pub const MIN_GUARDIAN_WINDOW_SECONDS: u64 = 3_600; // 1 hour
pub const MAX_GUARDIAN_WINDOW_SECONDS: u64 = 30 * 86_400; // 30 days (2,592,000 s)

pub const NFT_QUERY_GAS: Gas = Gas::from_tgas(10);
pub const OWNER_CALLBACK_GAS: Gas = Gas::from_tgas(30);

#[ext_contract(ext_self)]
pub trait SelfCallbacks {
    fn spend_callback(&mut self, amount: NearToken, bucket_index: u8);
    fn on_owner_confirmed(&mut self, caller: AccountId, action: Action);
}

#[derive(near_sdk::serde::Serialize, near_sdk::serde::Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct TokenOwner {
    pub owner_id: AccountId,
}

#[ext_contract(ext_nft)]
pub trait NftContract {
    fn nft_token(&self, token_id: String) -> Option<TokenOwner>;
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct AgentAccount {
    pub nft_contract:        AccountId,
    pub nft_token_id:        String,
    pub guardian:            AccountId,
    pub agent_key:           PublicKey,
    /// Immutable after new() — bounded to max 10 entries
    pub allowlist:           Vec<AccountId>,
    pub guardian_window_ns:  u64,

    pub per_tx_cap:          NearToken,
    pub period_cap:          NearToken,
    pub period_ns:           u64,

    pub paused:              bool,

    pub owner_slot:          Option<PendingAction>,

    pub pending_guardian:    Option<PendingGuardian>,

    pub ring:                [u128; BUCKETS],
    pub ring_head:           u8,
    pub ring_head_start_ns:  u64,
}

#[near_bindgen]
impl AgentAccount {
    #[init]
    pub fn new(
        nft_contract:            AccountId,
        nft_token_id:            String,
        guardian:                AccountId,
        agent_key:               PublicKey,
        allowlist:               Vec<AccountId>,
        per_tx_cap:              NearToken,
        period_cap:              NearToken,
        period_seconds:          u64,
        guardian_window_seconds: u64,
    ) -> Self {
        require!(!env::state_exists(), "already initialised");
        require!(!allowlist.is_empty(), "allowlist must not be empty");
        require!(allowlist.len() <= 10, "allowlist must not exceed 10 entries");
        require!(per_tx_cap <= period_cap, "per_tx_cap must not exceed period_cap");
        require!(
            period_seconds >= MIN_PERIOD_SECONDS,
            "period_seconds must be >= 1440 (24 minutes)"
        );
        require!(
            guardian_window_seconds >= MIN_GUARDIAN_WINDOW_SECONDS
                && guardian_window_seconds <= MAX_GUARDIAN_WINDOW_SECONDS,
            "guardian_window_seconds must be between 3600 (1 hour) and 2592000 (30 days)"
        );

        let period_ns          = period_seconds * 1_000_000_000;
        let guardian_window_ns = guardian_window_seconds * 1_000_000_000;

        Self {
            nft_contract,
            nft_token_id,
            guardian,
            agent_key,
            allowlist,
            guardian_window_ns,
            per_tx_cap,
            period_cap,
            period_ns,
            paused: false,
            owner_slot: None,
            pending_guardian: None,
            ring: [0u128; BUCKETS],
            ring_head: 0,
            ring_head_start_ns: env::block_timestamp(),
        }
    }
}

#[near_bindgen]
impl AgentAccount {
    /// Agent-key entry point. Guards ordered cheapest first.
    pub fn spend(
        &mut self,
        amount:    NearToken,
        recipient: AccountId,
        memo:      Option<String>,
    ) -> Promise {
        self.spend_inner(amount, recipient, memo)
    }

    /// Private rollback callback.
    #[private]
    pub fn spend_callback(&mut self, amount: NearToken, bucket_index: u8) {
        self.spend_callback_inner(amount, bucket_index)
    }
}

#[near_bindgen]
impl AgentAccount {
    pub fn pause_as_guardian(&mut self) {
        require!(
            env::predecessor_account_id() == self.guardian,
            "not guardian"
        );
        self.paused = true;
    }
}

#[near_bindgen]
impl AgentAccount {
    #[payable]
    pub fn pause_as_owner(&mut self) -> Promise {
        require_one_yocto();
        let caller = env::predecessor_account_id();
        self.initiate_owner_action(caller, Action::Pause)
    }

    /// Instantly tighten caps. Both non-increasing; at least one strictly lower.
    #[payable]
    pub fn tighten(&mut self, new_per_tx: NearToken, new_period: NearToken) -> Promise {
        require_one_yocto();
        validate_tighten(new_per_tx, new_period, self.per_tx_cap, self.period_cap);
        let caller = env::predecessor_account_id();
        self.initiate_owner_action(caller, Action::Tighten { new_per_tx, new_period })
    }

    /// Request an action requiring guardian delay (Loosen, Withdraw, Unpause).
    #[payable]
    pub fn request(&mut self, kind: ActionKind) -> Promise {
        require_one_yocto();
        self.validate_kind_at_entry(&kind);
        let caller = env::predecessor_account_id();
        self.initiate_owner_action(caller, Action::Request { kind })
    }

    /// Cancel own pending action.
    #[payable]
    pub fn cancel_own(&mut self) -> Promise {
        require_one_yocto();
        let caller = env::predecessor_account_id();
        self.initiate_owner_action(caller, Action::CancelOwn)
    }

    /// Execute a pending action after its guardian window has elapsed.
    #[payable]
    pub fn execute(&mut self) -> Promise {
        require_one_yocto();
        let caller = env::predecessor_account_id();
        self.initiate_owner_action(caller, Action::Execute)
    }

    /// Guardian cancels any pending action (synchronous, no delay).
    pub fn cancel_as_guardian(&mut self) {
        require!(
            env::predecessor_account_id() == self.guardian,
            "not guardian"
        );
        require!(self.owner_slot.is_some(), "no pending action");
        self.owner_slot = None;
    }

    /// Propose a new guardian. Initiates replacement window.
    pub fn propose_guardian_replacement(&mut self, new_guardian: AccountId) {
        require!(
            env::predecessor_account_id() == self.guardian,
            "not guardian"
        );
        require!(new_guardian != self.guardian, "must be different account");
        let confirm_by = env::block_timestamp() + 2 * self.guardian_window_ns;
        self.pending_guardian = Some(PendingGuardian { new_guardian, confirm_by });
    }

    /// Owner confirms the guardian replacement.
    #[payable]
    pub fn confirm_guardian_replacement(&mut self) -> Promise {
        require_one_yocto();
        let caller = env::predecessor_account_id();
        self.initiate_owner_action(caller, Action::ConfirmGuardianReplacement)
    }
}

#[derive(near_sdk::serde::Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct StateView {
    pub interface_version:  u32,
    pub nft_contract:       AccountId,
    pub nft_token_id:       String,
    pub guardian:           AccountId,
    pub agent_key:          PublicKey,
    pub per_tx_cap:         NearToken,
    pub period_cap:         NearToken,
    pub period_ns:          u64,
    pub guardian_window_ns: u64,
    pub paused:             bool,
    pub allowlist:          Vec<AccountId>,
    pub has_pending:        bool,
}

#[derive(near_sdk::serde::Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct PendingActionView {
    pub kind:     ActionKind,
    pub proposer: AccountId,
    pub deadline: u64,
    pub expiry:   u64,
}

#[near_bindgen]
impl AgentAccount {
    #[cfg(feature = "testing")]
    pub fn is_testing_build() -> bool {
        true
    }

    pub fn get_state(&self) -> StateView {
        StateView {
            interface_version:  INTERFACE_VERSION,
            nft_contract:       self.nft_contract.clone(),
            nft_token_id:       self.nft_token_id.clone(),
            guardian:           self.guardian.clone(),
            agent_key:          self.agent_key.clone(),
            per_tx_cap:         self.per_tx_cap,
            period_cap:         self.period_cap,
            period_ns:          self.period_ns,
            guardian_window_ns: self.guardian_window_ns,
            paused:             self.paused,
            allowlist:          self.allowlist.clone(),
            has_pending:        self.owner_slot.is_some(),
        }
    }

    pub fn get_owner_slot(&self) -> Option<PendingActionView> {
        self.owner_slot.as_ref().map(|s| PendingActionView {
            kind:     s.kind.clone(),
            proposer: s.proposer.clone(),
            deadline: s.deadline,
            expiry:   s.expiry,
        })
    }

    /// Computes current period spend on a local stack copy of the ring buffer.
    /// Does NOT advance or mutate contract state during a view call.
    pub fn get_current_period_spend(&self) -> NearToken {
        let mut ring_copy = self.ring;
        let mut head_copy = self.ring_head;
        let mut start_copy = self.ring_head_start_ns;
        let mut r = ring::RingRef {
            ring: &mut ring_copy,
            ring_head: &mut head_copy,
            ring_head_start_ns: &mut start_copy,
            period_ns: self.period_ns,
        };
        r.advance(env::block_timestamp());
        NearToken::from_yoctonear(r.sum())
    }
}

impl AgentAccount {
    /// Fetches nft_token with explicit static gas, then dispatches into on_owner_confirmed callback with explicit static gas.
    pub(crate) fn initiate_owner_action(
        &self,
        caller: AccountId,
        action: Action,
    ) -> Promise {
        env::log_str(&format!("ENTRY block={}", env::block_height()));
        ext_nft::ext(self.nft_contract.clone())
            .with_static_gas(NFT_QUERY_GAS)
            .nft_token(self.nft_token_id.clone())
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(OWNER_CALLBACK_GAS)
                    .on_owner_confirmed(caller, action),
            )
    }
}

#[near_bindgen]
impl AgentAccount {
    /// All owner mutations happen here, after re-validation.
    /// Uses slot.take() to prevent concurrent double-execution.
    #[private]
    pub fn on_owner_confirmed(
        &mut self,
        caller: AccountId,
        action: Action,
        #[callback_result] result: Result<Option<TokenOwner>, near_sdk::PromiseError>,
    ) -> PromiseOrValue<()> {
        env::log_str(&format!("CALLBACK block={}", env::block_height()));
        let token     = result.expect("nft_token call failed").expect("token not found");
        let cur_owner = token.owner_id;

        // Auth: caller must be the current NFT owner
        require!(caller == cur_owner, "not owner");

        match action {
            Action::Pause => {
                self.paused = true;
                PromiseOrValue::Value(())
            }

            Action::Tighten { new_per_tx, new_period } => {
                validate_tighten(new_per_tx, new_period, self.per_tx_cap, self.period_cap);
                self.per_tx_cap = new_per_tx;
                self.period_cap  = new_period;
                if matches!(
                    self.owner_slot.as_ref().map(|s| &s.kind),
                    Some(ActionKind::Loosen { .. })
                ) {
                    self.owner_slot = None;
                }
                PromiseOrValue::Value(())
            }

            Action::Request { kind } => {
                let now = env::block_timestamp();
                self.validate_kind_in_callback(&kind);
                match &self.owner_slot {
                    None => {}
                    Some(s) if s.expiry <= now => {}
                    Some(s) if s.proposer != cur_owner => {}
                    Some(_) => panic!("pending action exists — cancel_own first"),
                }
                self.owner_slot = Some(PendingAction {
                    kind,
                    proposer: caller,
                    deadline: now + self.guardian_window_ns,
                    expiry:   now + 2 * self.guardian_window_ns,
                });
                PromiseOrValue::Value(())
            }

            Action::CancelOwn => {
                let slot = self.owner_slot.as_ref().expect("no pending action");
                require!(slot.proposer == cur_owner, "not your pending action");
                self.owner_slot = None;
                PromiseOrValue::Value(())
            }

            Action::Execute => {
                let slot = self.owner_slot.take().expect("no pending action");
                require!(slot.proposer == cur_owner, "proposer is no longer owner");
                let now = env::block_timestamp();
                require!(now >= slot.deadline, "before deadline");
                require!(now <  slot.expiry,   "action expired");

                match slot.kind {
                    ActionKind::Loosen { new_per_tx, new_period } => {
                        validate_loosen(new_per_tx, new_period, self.per_tx_cap, self.period_cap);
                        self.per_tx_cap = new_per_tx;
                        self.period_cap  = new_period;
                        PromiseOrValue::Value(())
                    }
                    ActionKind::Withdraw { amount } => {
                        let floor = self.storage_floor();
                        require!(
                            env::account_balance().as_yoctonear()
                                >= amount.as_yoctonear() + floor,
                            "withdrawal would drop below storage floor"
                        );
                        PromiseOrValue::Promise(Promise::new(cur_owner).transfer(amount))
                    }
                    ActionKind::Unpause => {
                        self.paused = false;
                        PromiseOrValue::Value(())
                    }
                }
            }

            Action::ConfirmGuardianReplacement => {
                let pg = self.pending_guardian.take().expect("no pending guardian");
                require!(env::block_timestamp() <= pg.confirm_by, "window expired");
                self.guardian = pg.new_guardian;
                PromiseOrValue::Value(())
            }
        }
    }
}

pub fn validate_tighten(
    new_per_tx: NearToken, new_period: NearToken,
    cur_per_tx: NearToken, cur_period: NearToken,
) {
    require!(new_per_tx <= cur_per_tx, "tighten cannot raise per_tx_cap");
    require!(new_period  <= cur_period,  "tighten cannot raise period_cap");
    require!(
        new_per_tx < cur_per_tx || new_period < cur_period,
        "tighten must reduce at least one cap"
    );
    require!(new_per_tx <= new_period, "per_tx_cap cannot exceed period_cap");
}

pub fn validate_loosen(
    new_per_tx: NearToken, new_period: NearToken,
    cur_per_tx: NearToken, cur_period: NearToken,
) {
    require!(new_per_tx >= cur_per_tx, "loosen cannot lower per_tx_cap");
    require!(new_period  >= cur_period,  "loosen cannot lower period_cap");
    require!(
        new_per_tx > cur_per_tx || new_period > cur_period,
        "loosen must raise at least one cap"
    );
    require!(new_per_tx <= new_period, "per_tx_cap cannot exceed period_cap");
}

impl AgentAccount {
    fn validate_kind_at_entry(&self, kind: &ActionKind) {
        match kind {
            ActionKind::Loosen { new_per_tx, new_period } => {
                validate_loosen(*new_per_tx, *new_period, self.per_tx_cap, self.period_cap);
            }
            ActionKind::Withdraw { amount } => {
                let floor = self.storage_floor();
                require!(
                    env::account_balance().as_yoctonear() >= amount.as_yoctonear() + floor,
                    "insufficient balance"
                );
            }
            ActionKind::Unpause => {}
        }
    }

    fn validate_kind_in_callback(&self, kind: &ActionKind) {
        self.validate_kind_at_entry(kind);
    }
}

fn require_one_yocto() {
    require!(
        env::attached_deposit() == NearToken::from_yoctonear(1),
        "requires exactly 1 yoctoNEAR"
    );
}