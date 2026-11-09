#![deny(unused_variables, unused_must_use)]

use near_workspaces::network::Sandbox;
use near_workspaces::types::{AccessKey, KeyType, NearToken, SecretKey};
use near_workspaces::{Account, Contract, Worker};
use serde_json::json;

pub struct Fixture {
    pub worker: Worker<Sandbox>,
    pub root: Account,
    pub alice: Account,
    pub bob: Account,
    pub guardian: Account,
    pub nft_contract: Contract,
    pub agent_contract: Contract,
    pub agent_sk: SecretKey,
    pub agent_caller: Account,
    pub ghost_account_id: near_workspaces::AccountId,
    pub agent_wasm: Vec<u8>,
    pub agent_testing_wasm: Vec<u8>,
    pub nft_wasm: Vec<u8>,
}

pub async fn setup_fixture() -> Result<Fixture, Box<dyn std::error::Error>> {
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;

    let nft_wasm = std::fs::read("../../target/near/nft/nft.wasm")
        .or_else(|_| std::fs::read("target/near/nft/nft.wasm"))?;
    let agent_wasm = std::fs::read("../../target/near/agent_account/agent_account.wasm")
        .or_else(|_| std::fs::read("target/near/agent_account/agent_account.wasm"))?;
    let agent_testing_wasm = std::fs::read("../../target/near/agent_account/agent_account_testing.wasm")
        .or_else(|_| std::fs::read("target/near/agent_account/agent_account_testing.wasm"))
        .unwrap_or_else(|_| agent_wasm.clone());

    let alice = root
        .create_subaccount("alice")
        .initial_balance(NearToken::from_near(20))
        .transact()
        .await?
        .into_result()?;

    let bob = root
        .create_subaccount("bob")
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;

    let guardian = root
        .create_subaccount("guardian")
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;

    // 1. Deploy NFT contract
    let nft_contract = worker.dev_deploy(&nft_wasm).await?;
    nft_contract
        .call("new")
        .args_json(json!({
            "owner_id": alice.id(),
            "token_id": "token-1"
        }))
        .transact()
        .await?
        .into_result()?;

    // 2. Deploy Agent Account
    let agent_contract = worker.dev_deploy(&agent_wasm).await?;

    // 3. Add strictly scoped FunctionCall key to agent account and construct agent_caller
    let agent_sk = SecretKey::from_random(KeyType::ED25519);
    let agent_pk = agent_sk.public_key();

    let scoped_key = AccessKey::function_call_access(
        agent_contract.id(),
        &["spend"],
        Some(NearToken::from_near(5)),
    );

    agent_contract
        .as_account()
        .batch(agent_contract.id())
        .add_key(agent_pk.clone(), scoped_key)
        .transact()
        .await?
        .into_result()?;

    let agent_caller = Account::from_secret_key(
        agent_contract.id().clone(),
        agent_sk.clone(),
        &worker,
    );

    let ghost_account_id: near_workspaces::AccountId =
        format!("ghost-uncreated.{}", root.id()).parse()?;

    // 4. Initialize agent_contract with bob and ghost_account_id in allowlist
    agent_contract
        .call("new")
        .args_json(json!({
            "nft_contract": nft_contract.id(),
            "nft_token_id": "token-1",
            "guardian": guardian.id(),
            "agent_key": agent_pk.to_string(),
            "allowlist": [bob.id(), &ghost_account_id],
            "per_tx_cap": NearToken::from_near(1).as_yoctonear().to_string(),
            "period_cap": NearToken::from_near(5).as_yoctonear().to_string(),
            "period_seconds": 86400,
            "guardian_window_seconds": 3600
        }))
        .transact()
        .await?
        .into_result()?;

    // 5. Fund agent_contract with 10 NEAR
    root.transfer_near(agent_contract.id(), NearToken::from_near(10))
        .await?
        .into_result()?;

    Ok(Fixture {
        worker,
        root,
        alice,
        bob,
        guardian,
        nft_contract,
        agent_contract,
        agent_sk,
        agent_caller,
        ghost_account_id,
        agent_wasm,
        agent_testing_wasm,
        nft_wasm,
    })
}
