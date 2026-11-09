use near_sdk::{env, near, near_bindgen, Gas, NearToken, Promise, PanicOnDefault, require};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct ToyIdentity {
    pub guard: u64,
}

#[near_bindgen]
impl ToyIdentity {
    #[init]
    pub fn new() -> Self {
        require!(!env::state_exists(), "already initialised");
        Self { guard: 0 }
    }

    pub fn panic_test(&self) {
        env::panic_str("custom_panic_test_123");
    }

    pub fn entry(&mut self) -> Promise {
        let h = env::block_height();
        env::log_str(&format!("ENTRY block={} guard={}", h, self.guard));
        self.guard += 1;

        Promise::new(env::current_account_id()).function_call(
            "callback".to_string(),
            vec![],
            NearToken::from_yoctonear(0),
            Gas::from_tgas(5),
        )
    }

    pub fn callback(&mut self) {
        let h = env::block_height();
        env::log_str(&format!("CALLBACK block={} guard={}", h, self.guard));
    }
}
