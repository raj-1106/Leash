#![deny(unused_variables, unused_must_use)]

use integration_tests::setup_fixture;
use near_workspaces::types::{Gas, NearToken};
use serde_json::json;

#[tokio::test]
async fn test_new_bounds_validation() -> Result<(), Box<dyn std::error::Error>> {
    let f = setup_fixture().await?;
    let contract = f.worker.dev_deploy(&f.agent_wasm).await?;

    // 1. Period < 1440 seconds (24 min)
    let res = contract
        .call("new")
        .args_json(json!({
            "nft_contract": f.nft_contract.id(),
            "nft_token_id": "token-1",
            "guardian": f.guardian.id(),
            "agent_key": f.agent_sk.public_key().to_string(),
            "allowlist": [f.bob.id()],
            "per_tx_cap": NearToken::from_near(1).as_yoctonear().to_string(),
            "period_cap": NearToken::from_near(5).as_yoctonear().to_string(),
            "period_seconds": 1000,
            "guardian_window_seconds": 3600
        }))
        .transact()
        .await?;
    assert!(!res.is_success());
    let err = format!("{:?}", res);
    assert!(err.contains("period_seconds must be >= 1440 (24 minutes)"), "got: {}", err);

    // 2. Guardian window < 3600
    let res = contract
        .call("new")
        .args_json(json!({
            "nft_contract": f.nft_contract.id(),
            "nft_token_id": "token-1",
            "guardian": f.guardian.id(),
            "agent_key": f.agent_sk.public_key().to_string(),
            "allowlist": [f.bob.id()],
            "per_tx_cap": NearToken::from_near(1).as_yoctonear().to_string(),
            "period_cap": NearToken::from_near(5).as_yoctonear().to_string(),
            "period_seconds": 86400,
            "guardian_window_seconds": 1800
        }))
        .transact()
        .await?;
    assert!(!res.is_success());
    let err = format!("{:?}", res);
    assert!(err.contains("guardian_window_seconds must be between 3600 (1 hour) and 2592000 (30 days)"), "got: {}", err);

    // 3. Guardian window > 2,592,000 (30 days)
    let res = contract
        .call("new")
        .args_json(json!({
            "nft_contract": f.nft_contract.id(),
            "nft_token_id": "token-1",
            "guardian": f.guardian.id(),
            "agent_key": f.agent_sk.public_key().to_string(),
            "allowlist": [f.bob.id()],
            "per_tx_cap": NearToken::from_near(1).as_yoctonear().to_string(),
            "period_cap": NearToken::from_near(5).as_yoctonear().to_string(),
            "period_seconds": 86400,
            "guardian_window_seconds": 3_000_000
        }))
        .transact()
        .await?;
    assert!(!res.is_success());
    let err = format!("{:?}", res);
    assert!(err.contains("guardian_window_seconds must be between 3600 (1 hour) and 2592000 (30 days)"), "got: {}", err);

    // 4. Allowlist > 10 entries
    let too_many: Vec<String> = (0..11).map(|i| format!("user{}.test.near", i)).collect();
    let res = contract
        .call("new")
        .args_json(json!({
            "nft_contract": f.nft_contract.id(),
            "nft_token_id": "token-1",
            "guardian": f.guardian.id(),
            "agent_key": f.agent_sk.public_key().to_string(),
            "allowlist": too_many,
            "per_tx_cap": NearToken::from_near(1).as_yoctonear().to_string(),
            "period_cap": NearToken::from_near(5).as_yoctonear().to_string(),
            "period_seconds": 86400,
            "guardian_window_seconds": 3600
        }))
        .transact()
        .await?;
    assert!(!res.is_success());
    let err = format!("{:?}", res);
    assert!(err.contains("allowlist must not exceed 10 entries"), "got: {}", err);

    // 5. Positive control & re-initialization rejection
    let ok_res = contract
        .call("new")
        .args_json(json!({
            "nft_contract": f.nft_contract.id(),
            "nft_token_id": "token-1",
            "guardian": f.guardian.id(),
            "agent_key": f.agent_sk.public_key().to_string(),
            "allowlist": [f.bob.id()],
            "per_tx_cap": NearToken::from_near(1).as_yoctonear().to_string(),
            "period_cap": NearToken::from_near(5).as_yoctonear().to_string(),
            "period_seconds": 86400,
            "guardian_window_seconds": 3600
        }))
        .transact()
        .await?;
    assert!(ok_res.is_success());

    let re_init = contract
        .call("new")
        .args_json(json!({
            "nft_contract": f.nft_contract.id(),
            "nft_token_id": "token-1",
            "guardian": f.guardian.id(),
            "agent_key": f.agent_sk.public_key().to_string(),
            "allowlist": [f.bob.id()],
            "per_tx_cap": NearToken::from_near(1).as_yoctonear().to_string(),
            "period_cap": NearToken::from_near(5).as_yoctonear().to_string(),
            "period_seconds": 86400,
            "guardian_window_seconds": 3600
        }))
        .transact()
        .await?;
    assert!(!re_init.is_success());
    let re_err = format!("{:?}", re_init);
    assert!(
        re_err.contains("The contract has already been initialized")
            || re_err.contains("already initialised"),
        "got: {}",
        re_err
    );

    Ok(())
}

#[tokio::test]
async fn test_private_callbacks_reject_external_callers() -> Result<(), Box<dyn std::error::Error>> {
    let f = setup_fixture().await?;

    // 1. spend_callback rejected externally
    let res = f
        .alice
        .call(f.agent_contract.id(), "spend_callback")
        .args_json(json!({
            "amount": NearToken::from_near(1).as_yoctonear().to_string(),
            "bucket_index": 0
        }))
        .transact()
        .await?;
    assert!(!res.is_success());
    let err = format!("{:?}", res);
    assert!(err.contains("Method spend_callback is private"), "got: {}", err);

    // 2. on_owner_confirmed rejected externally
    let res2 = f
        .alice
        .call(f.agent_contract.id(), "on_owner_confirmed")
        .args_json(json!({
            "caller": f.alice.id(),
            "action": "Pause"
        }))
        .transact()
        .await?;
    assert!(!res2.is_success());
    let err2 = format!("{:?}", res2);
    assert!(err2.contains("Method on_owner_confirmed is private"), "got: {}", err2);

    Ok(())
}

#[tokio::test]
async fn test_spend_positive_control_with_scoped_key() -> Result<(), Box<dyn std::error::Error>> {
    let f = setup_fixture().await?;
    let bob_before = f.worker.view_account(f.bob.id()).await?.balance;

    let spend_amount = NearToken::from_millinear(200);
    let res = f
        .agent_caller
        .call(f.agent_contract.id(), "spend")
        .args_json(json!({
            "amount": spend_amount.as_yoctonear().to_string(),
            "recipient": f.bob.id(),
            "memo": "valid scoped spend"
        }))
        .gas(Gas::from_tgas(30))
        .transact()
        .await?;
    assert!(res.is_success(), "Spend failed: {:?}", res);

    let bob_after = f.worker.view_account(f.bob.id()).await?.balance;
    assert_eq!(
        bob_after.as_yoctonear(),
        bob_before.as_yoctonear() + spend_amount.as_yoctonear()
    );

    let current_spend: serde_json::Value = f
        .agent_contract
        .view("get_current_period_spend")
        .await?
        .json()?;
    assert_eq!(current_spend, spend_amount.as_yoctonear().to_string());

    Ok(())
}

#[tokio::test]
async fn test_spend_fails_when_called_by_full_access_key() -> Result<(), Box<dyn std::error::Error>> {
    let f = setup_fixture().await?;

    // Direct contract invocation signs with the contract's own FullAccess deployment key
    let res = f
        .agent_contract
        .call("spend")
        .args_json(json!({
            "amount": NearToken::from_millinear(100).as_yoctonear().to_string(),
            "recipient": f.bob.id(),
            "memo": "fak spend attempt"
        }))
        .gas(Gas::from_tgas(30))
        .transact()
        .await?;
    assert!(!res.is_success());
    let err = format!("{:?}", res);
    assert!(err.contains("wrong signer key"), "Expected 'wrong signer key', got: {}", err);

    Ok(())
}

#[tokio::test]
async fn test_spend_fails_when_predecessor_is_not_self() -> Result<(), Box<dyn std::error::Error>> {
    let f = setup_fixture().await?;

    // External caller Alice attempts to invoke spend
    let res = f
        .alice
        .call(f.agent_contract.id(), "spend")
        .args_json(json!({
            "amount": NearToken::from_millinear(100).as_yoctonear().to_string(),
            "recipient": f.bob.id(),
            "memo": "external call"
        }))
        .gas(Gas::from_tgas(30))
        .transact()
        .await?;
    assert!(!res.is_success());
    let err = format!("{:?}", res);
    assert!(
        err.contains("predecessor must be current_account_id"),
        "Expected predecessor panic, got: {}",
        err
    );

    Ok(())
}

#[tokio::test]
async fn test_spend_fails_on_per_tx_cap() -> Result<(), Box<dyn std::error::Error>> {
    let f = setup_fixture().await?;

    // Per-tx cap is 1 NEAR; attempt 1.1 NEAR
    let res = f
        .agent_caller
        .call(f.agent_contract.id(), "spend")
        .args_json(json!({
            "amount": NearToken::from_millinear(1100).as_yoctonear().to_string(),
            "recipient": f.bob.id(),
            "memo": "over per tx cap"
        }))
        .gas(Gas::from_tgas(30))
        .transact()
        .await?;
    assert!(!res.is_success());
    let err = format!("{:?}", res);
    assert!(err.contains("exceeds per_tx_cap"), "got: {}", err);

    Ok(())
}

#[tokio::test]
async fn test_spend_fails_on_period_cap() -> Result<(), Box<dyn std::error::Error>> {
    let f = setup_fixture().await?;

    // Period cap is 5 NEAR. Spend 5 x 1 NEAR successfully.
    for i in 1..=5 {
        let res = f
            .agent_caller
            .call(f.agent_contract.id(), "spend")
            .args_json(json!({
                "amount": NearToken::from_near(1).as_yoctonear().to_string(),
                "recipient": f.bob.id(),
                "memo": format!("spend {}", i)
            }))
            .gas(Gas::from_tgas(30))
            .transact()
            .await?;
        assert!(res.is_success(), "Spend {} failed: {:?}", i, res);
    }

    // 6th spend of 0.1 NEAR exceeds 5 NEAR period cap
    let res6 = f
        .agent_caller
        .call(f.agent_contract.id(), "spend")
        .args_json(json!({
            "amount": NearToken::from_millinear(100).as_yoctonear().to_string(),
            "recipient": f.bob.id(),
            "memo": "spend 6"
        }))
        .gas(Gas::from_tgas(30))
        .transact()
        .await?;
    assert!(!res6.is_success());
    let err = format!("{:?}", res6);
    assert!(err.contains("exceeds period_cap"), "got: {}", err);

    Ok(())
}

#[tokio::test]
async fn test_spend_fails_on_non_allowlisted_recipient() -> Result<(), Box<dyn std::error::Error>> {
    let f = setup_fixture().await?;

    // Alice is not in allowlist
    let res = f
        .agent_caller
        .call(f.agent_contract.id(), "spend")
        .args_json(json!({
            "amount": NearToken::from_millinear(100).as_yoctonear().to_string(),
            "recipient": f.alice.id(),
            "memo": "spend to non allowlisted alice"
        }))
        .gas(Gas::from_tgas(30))
        .transact()
        .await?;
    assert!(!res.is_success());
    let err = format!("{:?}", res);
    assert!(err.contains("recipient not in allowlist"), "got: {}", err);

    Ok(())
}

#[tokio::test]
async fn test_spend_fails_when_paused() -> Result<(), Box<dyn std::error::Error>> {
    let f = setup_fixture().await?;

    // Guardian pauses contract
    let pause_res = f.guardian.call(f.agent_contract.id(), "pause_as_guardian").transact().await?;
    assert!(pause_res.is_success());

    // Spend attempt while paused fails
    let res = f
        .agent_caller
        .call(f.agent_contract.id(), "spend")
        .args_json(json!({
            "amount": NearToken::from_millinear(100).as_yoctonear().to_string(),
            "recipient": f.bob.id(),
            "memo": "paused spend attempt"
        }))
        .gas(Gas::from_tgas(30))
        .transact()
        .await?;
    assert!(!res.is_success());
    let err = format!("{:?}", res);
    assert!(err.contains("paused"), "got: {}", err);

    Ok(())
}

#[tokio::test]
async fn test_spend_memo_bounds() -> Result<(), Box<dyn std::error::Error>> {
    let f = setup_fixture().await?;

    // Memo > 256 bytes fails
    let long_memo = "a".repeat(257);
    let res = f
        .agent_caller
        .call(f.agent_contract.id(), "spend")
        .args_json(json!({
            "amount": NearToken::from_millinear(50).as_yoctonear().to_string(),
            "recipient": f.bob.id(),
            "memo": long_memo
        }))
        .gas(Gas::from_tgas(30))
        .transact()
        .await?;
    assert!(!res.is_success());
    let err = format!("{:?}", res);
    assert!(err.contains("memo exceeds 256 bytes"), "got: {}", err);

    // Positive control: Exactly 256 bytes memo succeeds
    let exact_memo = "a".repeat(256);
    let ok_res = f
        .agent_caller
        .call(f.agent_contract.id(), "spend")
        .args_json(json!({
            "amount": NearToken::from_millinear(50).as_yoctonear().to_string(),
            "recipient": f.bob.id(),
            "memo": exact_memo
        }))
        .gas(Gas::from_tgas(30))
        .transact()
        .await?;
    assert!(ok_res.is_success(), "256-byte memo spend failed: {:?}", ok_res);
    assert!(
        ok_res.logs().iter().any(|l| l.contains(&format!("memo: {}", exact_memo))),
        "Expected memo to be logged, logs: {:?}",
        ok_res.logs()
    );

    Ok(())
}

#[tokio::test]
async fn test_spend_fails_below_storage_floor() -> Result<(), Box<dyn std::error::Error>> {
    let f = setup_fixture().await?;

    // Deploy an agent to a subaccount funded with 2.2 NEAR (~1.7 NEAR needed for 165KB WASM storage)
    let poor_account = f
        .root
        .create_subaccount("poor-agent")
        .initial_balance(NearToken::from_millinear(2200))
        .transact()
        .await?
        .into_result()?;

    let contract2 = poor_account.deploy(&f.agent_wasm).await?.into_result()?;

    let agent_sk = near_workspaces::types::SecretKey::from_random(near_workspaces::types::KeyType::ED25519);
    let agent_pk = agent_sk.public_key();

    let scoped_key = near_workspaces::types::AccessKey::function_call_access(
        contract2.id(),
        &["spend"],
        Some(NearToken::from_near(5)),
    );

    contract2
        .as_account()
        .batch(contract2.id())
        .add_key(agent_pk.clone(), scoped_key)
        .transact()
        .await?
        .into_result()?;

    let agent_caller2 = near_workspaces::Account::from_secret_key(
        contract2.id().clone(),
        agent_sk.clone(),
        &f.worker,
    );

    contract2
        .call("new")
        .args_json(json!({
            "nft_contract": f.nft_contract.id(),
            "nft_token_id": "token-1",
            "guardian": f.guardian.id(),
            "agent_key": agent_pk.to_string(),
            "allowlist": [f.bob.id()],
            "per_tx_cap": NearToken::from_near(2).as_yoctonear().to_string(),
            "period_cap": NearToken::from_near(5).as_yoctonear().to_string(),
            "period_seconds": 86400,
            "guardian_window_seconds": 3600
        }))
        .transact()
        .await?
        .into_result()?;

    // Account has ~2.15 NEAR total balance. Storage floor requires ~1.76 NEAR.
    // Spending 0.5 NEAR would require total balance >= 0.5 + 1.76 = 2.26 NEAR > 2.15 NEAR.
    let res = agent_caller2
        .call(contract2.id(), "spend")
        .args_json(json!({
            "amount": NearToken::from_millinear(500).as_yoctonear().to_string(),
            "recipient": f.bob.id(),
            "memo": "drain attempt"
        }))
        .gas(Gas::from_tgas(30))
        .transact()
        .await?;
    assert!(!res.is_success());
    let err = format!("{:?}", res);
    assert!(
        err.contains("spend would drop balance below storage floor"),
        "Expected storage floor panic, got: {}",
        err
    );

    Ok(())
}

#[tokio::test]
async fn test_spend_rollback_on_failed_transfer() -> Result<(), Box<dyn std::error::Error>> {
    let f = setup_fixture().await?;

    // Ghost account is allowlisted, but does not exist on chain.
    let res = f
        .agent_caller
        .call(f.agent_contract.id(), "spend")
        .args_json(json!({
            "amount": NearToken::from_millinear(300).as_yoctonear().to_string(),
            "recipient": f.ghost_account_id,
            "memo": "transfer to non-existent account"
        }))
        .gas(Gas::from_tgas(40))
        .transact()
        .await?;

    // Execution completes, but inner transfer promise failed
    assert!(res.is_success());

    // spend_callback rolls back the ring bucket: current spend must be 0!
    let current_spend: serde_json::Value = f
        .agent_contract
        .view("get_current_period_spend")
        .await?
        .json()?;

    assert_eq!(
        current_spend, "0",
        "Rollback failed: expected 0 current_period_spend after failed transfer, got: {}",
        current_spend
    );

    Ok(())
}

#[tokio::test]
async fn test_scoped_key_cannot_call_unauthorized_methods() -> Result<(), Box<dyn std::error::Error>> {
    let f = setup_fixture().await?;

    // Agent caller's key is strictly scoped to ["spend"].
    // Attempting to invoke pause_as_guardian or new must fail at the NEAR protocol layer.
    let res = f
        .agent_caller
        .call(f.agent_contract.id(), "pause_as_guardian")
        .transact()
        .await;

    assert!(res.is_err(), "Protocol should reject unauthorized method on scoped key!");
    let err = format!("{:?}", res.err().unwrap());
    assert!(
        err.contains("MethodNameMismatch") || err.contains("InvalidAccessKeyError") || err.contains("is not allowed"),
        "Expected protocol access key method error, got: {}",
        err
    );

    Ok(())
}

#[tokio::test]
async fn test_owner_calls_gas_budget() -> Result<(), Box<dyn std::error::Error>> {
    let f = setup_fixture().await?;

    // 1. Owner action with 50 TGas attached and 1 yocto deposit succeeds!
    let res_ok = f
        .alice
        .call(f.agent_contract.id(), "pause_as_owner")
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(50))
        .transact()
        .await?;
    assert!(res_ok.is_success(), "50 TGas owner call failed: {:?}", res_ok);

    let state: serde_json::Value = f.agent_contract.view("get_state").await?.json()?;
    assert_eq!(state["paused"], true);

    // 2. Owner action tighten with 45 TGas succeeds!
    let res_tighten = f
        .alice
        .call(f.agent_contract.id(), "tighten")
        .args_json(json!({
            "new_per_tx": NearToken::from_millinear(500).as_yoctonear().to_string(),
            "new_period": NearToken::from_near(2).as_yoctonear().to_string(),
        }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(45))
        .transact()
        .await?;
    assert!(res_tighten.is_success(), "45 TGas tighten call failed: {:?}", res_tighten);

    // 3. Owner call with default 30 TGas fails due to static gas requirement (10 + 30 = 40 TGas static)
    let res_low_gas = f
        .alice
        .call(f.agent_contract.id(), "pause_as_owner")
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(30))
        .transact()
        .await?;
    assert!(!res_low_gas.is_success(), "Expected 30 TGas call to fail from gas exhaustion");

    Ok(())
}

#[tokio::test]
async fn test_gifted_nft_from_rogue_contract_grants_no_authority() -> Result<(), Box<dyn std::error::Error>> {
    let f = setup_fixture().await?;

    let charlie = f.root
        .create_subaccount("charlie")
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;

    // 1. Attacker deploys a separate rogue NFT contract and mints a token to charlie
    let rogue_nft = f.worker.dev_deploy(&f.nft_wasm).await?;
    let rogue_init = rogue_nft
        .call("new")
        .args_json(json!({
            "owner_id": charlie.id(),
            "token_id": "token-1"
        }))
        .transact()
        .await?;
    assert!(rogue_init.is_success());

    // 2. Attacker sends rogue NFT to agent_contract via nft_transfer_call -> fails because agent_contract has no nft_on_transfer
    let res_call = charlie
        .call(rogue_nft.id(), "nft_transfer_call")
        .args_json(json!({
            "receiver_id": f.agent_contract.id(),
            "token_id": "token-1",
            "msg": "gifted rogue token"
        }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(50))
        .transact()
        .await?;
    assert!(res_call.is_success());

    let rogue_token_after: serde_json::Value = rogue_nft
        .view("nft_token")
        .args_json(json!({ "token_id": "token-1" }))
        .await?
        .json()?;
    assert_eq!(
        rogue_token_after["owner_id"],
        charlie.id().to_string(),
        "Gifted token must be refunded to Charlie because agent_contract has no nft_on_transfer!"
    );

    // 3. Attacker sends rogue NFT to agent_contract via plain nft_transfer -> succeeds in custody transfer
    let res_transfer = charlie
        .call(rogue_nft.id(), "nft_transfer")
        .args_json(json!({
            "receiver_id": f.agent_contract.id(),
            "token_id": "token-1"
        }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(30))
        .transact()
        .await?;
    assert!(res_transfer.is_success());

    // 4. Attacker attempts owner action (pause_as_owner) on agent_contract.
    // AgentAccount queries its configured self.nft_contract (where Alice is owner, NOT rogue_nft).
    // The attacker's call fails with "not owner".
    let attack_res = charlie
        .call(f.agent_contract.id(), "pause_as_owner")
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(50))
        .transact()
        .await?;
    assert!(!attack_res.is_success());
    let err = format!("{:?}", attack_res);
    assert!(err.contains("not owner"), "Expected 'not owner', got: {}", err);

    Ok(())
}

#[tokio::test]
async fn test_owner_tighten_caps_instant_and_enforces_monotonicity() -> Result<(), Box<dyn std::error::Error>> {
    let f = setup_fixture().await?;

    // Initial caps: per_tx = 1 NEAR, period = 5 NEAR
    // 1. Attempting to raise per_tx fails
    let fail_per_tx = f
        .alice
        .call(f.agent_contract.id(), "tighten")
        .args_json(json!({
            "new_per_tx": NearToken::from_near(2).as_yoctonear().to_string(),
            "new_period": NearToken::from_near(5).as_yoctonear().to_string(),
        }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(45))
        .transact()
        .await?;
    assert!(!fail_per_tx.is_success());
    let err1 = format!("{:?}", fail_per_tx);
    assert!(err1.contains("tighten cannot raise per_tx_cap"), "got: {}", err1);

    // 2. Attempting to raise period cap fails
    let fail_period = f
        .alice
        .call(f.agent_contract.id(), "tighten")
        .args_json(json!({
            "new_per_tx": NearToken::from_near(1).as_yoctonear().to_string(),
            "new_period": NearToken::from_near(6).as_yoctonear().to_string(),
        }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(45))
        .transact()
        .await?;
    assert!(!fail_period.is_success());
    let err2 = format!("{:?}", fail_period);
    assert!(err2.contains("tighten cannot raise period_cap"), "got: {}", err2);

    // 3. Attempting per_tx > new_period fails
    let fail_order = f
        .alice
        .call(f.agent_contract.id(), "tighten")
        .args_json(json!({
            "new_per_tx": NearToken::from_millinear(900).as_yoctonear().to_string(),
            "new_period": NearToken::from_millinear(800).as_yoctonear().to_string(),
        }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(45))
        .transact()
        .await?;
    assert!(!fail_order.is_success());
    let err3 = format!("{:?}", fail_order);
    assert!(err3.contains("per_tx_cap cannot exceed period_cap"), "got: {}", err3);

    // 4. Valid tighten succeeds instantly without delay
    let ok_tighten = f
        .alice
        .call(f.agent_contract.id(), "tighten")
        .args_json(json!({
            "new_per_tx": NearToken::from_millinear(500).as_yoctonear().to_string(),
            "new_period": NearToken::from_near(2).as_yoctonear().to_string(),
        }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(45))
        .transact()
        .await?;
    assert!(ok_tighten.is_success());

    let state: serde_json::Value = f.agent_contract.view("get_state").await?.json()?;
    assert_eq!(state["per_tx_cap"], NearToken::from_millinear(500).as_yoctonear().to_string());
    assert_eq!(state["period_cap"], NearToken::from_near(2).as_yoctonear().to_string());

    Ok(())
}

#[tokio::test]
async fn test_guardian_cancel_pending_action() -> Result<(), Box<dyn std::error::Error>> {
    let f = setup_fixture().await?;

    // 1. Owner requests Unpause
    let req_res = f
        .alice
        .call(f.agent_contract.id(), "request")
        .args_json(json!({
            "kind": "Unpause"
        }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(45))
        .transact()
        .await?;
    assert!(req_res.is_success());

    let state: serde_json::Value = f.agent_contract.view("get_state").await?.json()?;
    assert_eq!(state["has_pending"], true);

    let slot: Option<serde_json::Value> = f.agent_contract.view("get_owner_slot").await?.json()?;
    assert!(slot.is_some());

    // 2. Non-guardian calling cancel_as_guardian fails
    let fail_cancel = f
        .alice
        .call(f.agent_contract.id(), "cancel_as_guardian")
        .transact()
        .await?;
    assert!(!fail_cancel.is_success());

    // 3. Guardian cancels the pending action
    let ok_cancel = f
        .guardian
        .call(f.agent_contract.id(), "cancel_as_guardian")
        .transact()
        .await?;
    assert!(ok_cancel.is_success());

    let state_after: serde_json::Value = f.agent_contract.view("get_state").await?.json()?;
    assert_eq!(state_after["has_pending"], false);

    let slot_after: Option<serde_json::Value> = f.agent_contract.view("get_owner_slot").await?.json()?;
    assert!(slot_after.is_none());

    // 4. Calling execute now fails with "no pending action"
    let exec_res = f
        .alice
        .call(f.agent_contract.id(), "execute")
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(50))
        .transact()
        .await?;
    assert!(!exec_res.is_success());
    let err = format!("{:?}", exec_res);
    assert!(err.contains("no pending action"), "got: {}", err);

    Ok(())
}

#[tokio::test]
async fn test_owner_sale_clears_approvals_and_transfers_supervisory_control() -> Result<(), Box<dyn std::error::Error>> {
    let f = setup_fixture().await?;

    let dave = f.root
        .create_subaccount("dave")
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;

    // 1. Alice approves Bob for token-1
    let app_res = f
        .alice
        .call(f.nft_contract.id(), "nft_approve")
        .args_json(json!({
            "token_id": "token-1",
            "account_id": f.bob.id()
        }))
        .deposit(NearToken::from_millinear(5)) // covers storage
        .gas(Gas::from_tgas(30))
        .transact()
        .await?;
    assert!(app_res.is_success());

    // 2. Alice requests an action (Unpause)
    let req_res = f
        .alice
        .call(f.agent_contract.id(), "request")
        .args_json(json!({ "kind": "Unpause" }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(45))
        .transact()
        .await?;
    assert!(req_res.is_success());

    // 3. Alice sells / transfers token-1 to Dave
    let transfer_res = f
        .alice
        .call(f.nft_contract.id(), "nft_transfer")
        .args_json(json!({
            "receiver_id": dave.id(),
            "token_id": "token-1"
        }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(30))
        .transact()
        .await?;
    assert!(transfer_res.is_success());

    // 4. Bob's prior approval is cleared: Bob trying to transfer token-1 fails
    let bob_transfer = f
        .bob
        .call(f.nft_contract.id(), "nft_transfer")
        .args_json(json!({
            "receiver_id": f.bob.id(),
            "token_id": "token-1",
            "approval_id": 0
        }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(30))
        .transact()
        .await?;
    assert!(!bob_transfer.is_success(), "Bob's approval must be revoked after sale!");

    // 5. Alice's calls now fail with "not owner"
    let alice_pause = f
        .alice
        .call(f.agent_contract.id(), "pause_as_owner")
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(50))
        .transact()
        .await?;
    assert!(!alice_pause.is_success());
    assert!(format!("{:?}", alice_pause).contains("not owner"));

    // Alice trying to execute her old pending action fails with "not owner"
    let alice_exec = f
        .alice
        .call(f.agent_contract.id(), "execute")
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(50))
        .transact()
        .await?;
    assert!(!alice_exec.is_success());
    assert!(format!("{:?}", alice_exec).contains("not owner"));

    // Dave (the new owner) trying to execute Alice's stale slot fails with "proposer is no longer owner"
    let dave_exec = dave
        .call(f.agent_contract.id(), "execute")
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(50))
        .transact()
        .await?;
    assert!(!dave_exec.is_success());
    assert!(format!("{:?}", dave_exec).contains("proposer is no longer owner"));

    // 6. Dave (the new owner) has full supervisory control
    let dave_pause = dave
        .call(f.agent_contract.id(), "pause_as_owner")
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(50))
        .transact()
        .await?;
    assert!(dave_pause.is_success(), "New owner Dave must be able to exercise control");

    let state: serde_json::Value = f.agent_contract.view("get_state").await?.json()?;
    assert_eq!(state["paused"], true);

    Ok(())
}

#[tokio::test]
async fn test_views_and_guardian_pause() -> Result<(), Box<dyn std::error::Error>> {
    let f = setup_fixture().await?;

    let state: serde_json::Value = f.agent_contract.view("get_state").await?.json()?;
    assert_eq!(state["interface_version"], 1);
    assert_eq!(state["guardian"], f.guardian.id().to_string());
    assert_eq!(state["paused"], false);
    assert_eq!(state["has_pending"], false);

    let slot: Option<serde_json::Value> = f.agent_contract.view("get_owner_slot").await?.json()?;
    assert!(slot.is_none());

    let current_spend: serde_json::Value = f
        .agent_contract
        .view("get_current_period_spend")
        .await?
        .json()?;
    assert_eq!(current_spend, "0");

    // Non-guardian cannot pause
    let fail_pause = f
        .alice
        .call(f.agent_contract.id(), "pause_as_guardian")
        .transact()
        .await?;
    assert!(!fail_pause.is_success());
    assert!(format!("{:?}", fail_pause).contains("not guardian"));

    // Guardian pause succeeds
    let ok_pause = f
        .guardian
        .call(f.agent_contract.id(), "pause_as_guardian")
        .transact()
        .await?;
    assert!(ok_pause.is_success());

    let state_paused: serde_json::Value = f.agent_contract.view("get_state").await?.json()?;
    assert_eq!(state_paused["paused"], true);

    Ok(())
}
#[tokio::test]
async fn test_locked_account_born_without_faks_end_to_end() -> Result<(), Box<dyn std::error::Error>> {
    let f = setup_fixture().await?;

    let locked_agent_id: near_workspaces::AccountId =
        format!("locked-agent.{}", f.root.id()).parse()?;

    let agent_sk = near_workspaces::types::SecretKey::from_random(near_workspaces::types::KeyType::ED25519);
    let agent_pk = agent_sk.public_key();

    let scoped_key = near_workspaces::types::AccessKey::function_call_access(
        &locked_agent_id,
        &["spend"],
        Some(NearToken::from_near(5)),
    );

    // Atomic 5-action batch deployment:
    // 1. CreateAccount
    // 2. Transfer (5 NEAR for contract state + spend balance)
    // 3. Deploy (agent_account WASM)
    // 4. FunctionCall new(...)
    // 5. AddKey (ONLY the scoped FunctionCall key; exactly ZERO FullAccess keys!)
    let batch_res = f.root
        .batch(&locked_agent_id)
        .create_account()
        .transfer(NearToken::from_near(5))
        .deploy(&f.agent_wasm)
        .call(
            near_workspaces::operations::Function::new("new")
                .args_json(json!({
                    "nft_contract": f.nft_contract.id(),
                    "nft_token_id": "token-1",
                    "guardian": f.guardian.id(),
                    "agent_key": agent_pk.to_string(),
                    "allowlist": [f.bob.id()],
                    "per_tx_cap": NearToken::from_near(1).as_yoctonear().to_string(),
                    "period_cap": NearToken::from_near(5).as_yoctonear().to_string(),
                    "period_seconds": 86400,
                    "guardian_window_seconds": 3600
                }))
        )
        .add_key(agent_pk.clone(), scoped_key)
        .transact()
        .await?;

    assert!(batch_res.is_success(), "5-action batch deployment failed: {:?}", batch_res);

    // 1. Check access key list: MUST contain exactly 1 key, and it MUST be FunctionCall (0 FAKs!)
    let keys = f.worker.view_access_keys(&locked_agent_id).await?;
    assert_eq!(keys.len(), 1, "Expected exactly 1 key on locked account!");
    match &keys[0].access_key.permission {
        near_workspaces::types::AccessKeyPermission::FunctionCall(fc) => {
            assert_eq!(fc.receiver_id.as_str(), locked_agent_id.as_str());
            assert_eq!(fc.method_names, vec!["spend".to_string()]);
        }
        near_workspaces::types::AccessKeyPermission::FullAccess => {
            panic!("SECURITY VIOLATION: Locked account has a FullAccess key!");
        }
    }

    // 2. A spend signed with the scoped key works!
    let locked_caller = near_workspaces::Account::from_secret_key(
        locked_agent_id.clone(),
        agent_sk.clone(),
        &f.worker,
    );

    let bob_bal_before = f.worker.view_account(f.bob.id()).await?.balance;
    let spend_res = locked_caller
        .call(&locked_agent_id, "spend")
        .args_json(json!({
            "amount": NearToken::from_millinear(200).as_yoctonear().to_string(),
            "recipient": f.bob.id(),
            "memo": "spend on permanently locked account"
        }))
        .gas(Gas::from_tgas(30))
        .transact()
        .await?;
    assert!(spend_res.is_success(), "Spend on locked account failed: {:?}", spend_res);

    let bob_bal_after = f.worker.view_account(f.bob.id()).await?.balance;
    assert_eq!(
        bob_bal_after.as_yoctonear(),
        bob_bal_before.as_yoctonear() + NearToken::from_millinear(200).as_yoctonear()
    );

    // 3. Second new() from another account fails with "The contract has already been initialized"
    let re_init = f.alice
        .call(&locked_agent_id, "new")
        .args_json(json!({
            "nft_contract": f.nft_contract.id(),
            "nft_token_id": "token-1",
            "guardian": f.guardian.id(),
            "agent_key": agent_pk.to_string(),
            "allowlist": [f.bob.id()],
            "per_tx_cap": NearToken::from_near(1).as_yoctonear().to_string(),
            "period_cap": NearToken::from_near(5).as_yoctonear().to_string(),
            "period_seconds": 86400,
            "guardian_window_seconds": 3600
        }))
        .transact()
        .await?;
    assert!(!re_init.is_success());
    let err = format!("{:?}", re_init);
    assert!(
        err.contains("The contract has already been initialized") || err.contains("already initialised"),
        "Expected re-init error, got: {}",
        err
    );

    Ok(())
}

#[tokio::test]
async fn test_owner_timelock_execute_window_and_expiry() -> Result<(), Box<dyn std::error::Error>> {
    let f = setup_fixture().await?;

    // Create a contract with 5-second window under testing feature
    let agent2 = f.worker.dev_deploy(&f.agent_testing_wasm).await?;
    agent2.call("new").args_json(json!({
        "nft_contract": f.nft_contract.id(),
        "nft_token_id": "token-1",
        "guardian": f.guardian.id(),
        "agent_key": f.agent_sk.public_key().to_string(),
        "allowlist": [f.bob.id()],
        "per_tx_cap": NearToken::from_near(1).as_yoctonear().to_string(),
        "period_cap": NearToken::from_near(5).as_yoctonear().to_string(),
        "period_seconds": 86400,
        "guardian_window_seconds": 5
    })).transact().await?.into_result()?;

    // Pause contract first so we can test Unpause
    let p_res = f.guardian.call(agent2.id(), "pause_as_guardian").transact().await?;
    assert!(p_res.is_success());

    // 1. Alice requests Unpause
    let req = f.alice.call(agent2.id(), "request")
        .args_json(json!({ "kind": "Unpause" }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(45))
        .transact().await?;
    assert!(req.is_success());

    // 2. Calling execute immediately fails with "before deadline"
    let exec_early = f.alice.call(agent2.id(), "execute")
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(50))
        .transact().await?;
    assert!(!exec_early.is_success());
    assert!(format!("{:?}", exec_early).contains("before deadline"));

    // 3. Fast forward past 5-second deadline (~20 blocks)
    f.worker.fast_forward(20).await?;

    // Calling execute within the window succeeds!
    let exec_ok = f.alice.call(agent2.id(), "execute")
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(50))
        .transact().await?;
    assert!(exec_ok.is_success(), "Execution in window failed: {:?}", exec_ok);

    let state: serde_json::Value = agent2.view("get_state").await?.json()?;
    assert_eq!(state["paused"], false, "Unpause execution should set paused to false");

    // 4. Test expiry: Pause again, request Unpause, fast-forward past expiry (window*2 = 10s -> ~50 blocks)
    let p_res2 = f.guardian.call(agent2.id(), "pause_as_guardian").transact().await?;
    assert!(p_res2.is_success());

    let req2 = f.alice.call(agent2.id(), "request")
        .args_json(json!({ "kind": "Unpause" }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(45))
        .transact().await?;
    assert!(req2.is_success());

    // Advance 60 blocks past expiry
    f.worker.fast_forward(60).await?;

    let exec_expired = f.alice.call(agent2.id(), "execute")
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(50))
        .transact().await?;
    assert!(!exec_expired.is_success());
    assert!(format!("{:?}", exec_expired).contains("action expired"));

    Ok(())
}

#[tokio::test]
async fn test_owner_overwrites_stale_slot_with_new_request() -> Result<(), Box<dyn std::error::Error>> {
    let f = setup_fixture().await?;

    let dave = f.root
        .create_subaccount("dave-stale")
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;

    // 1. Alice requests Unpause
    let req1 = f.alice.call(f.agent_contract.id(), "request")
        .args_json(json!({ "kind": "Unpause" }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(45))
        .transact().await?;
    assert!(req1.is_success());

    let slot1: Option<serde_json::Value> = f.agent_contract.view("get_owner_slot").await?.json()?;
    assert_eq!(slot1.unwrap()["proposer"], f.alice.id().to_string());

    // 2. Alice sells NFT to Dave
    let transfer = f.alice.call(f.nft_contract.id(), "nft_transfer")
        .args_json(json!({
            "receiver_id": dave.id(),
            "token_id": "token-1"
        }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(30))
        .transact().await?;
    assert!(transfer.is_success());

    // 3. Dave (new owner) requests a new action: overwrites Alice's stale slot!
    let req2 = dave.call(f.agent_contract.id(), "request")
        .args_json(json!({
            "kind": { "Withdraw": { "amount": NearToken::from_near(1).as_yoctonear().to_string() } }
        }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(45))
        .transact().await?;
    assert!(req2.is_success(), "New owner request should overwrite stale slot: {:?}", req2);

    let slot2: Option<serde_json::Value> = f.agent_contract.view("get_owner_slot").await?.json()?;
    assert_eq!(slot2.unwrap()["proposer"], dave.id().to_string());

    Ok(())
}

#[tokio::test]
async fn test_owner_withdraw_respects_storage_floor_and_pays_current_owner() -> Result<(), Box<dyn std::error::Error>> {
    let f = setup_fixture().await?;

    let agent = f.worker.dev_deploy(&f.agent_testing_wasm).await?;
    agent.call("new").args_json(json!({
        "nft_contract": f.nft_contract.id(),
        "nft_token_id": "token-1",
        "guardian": f.guardian.id(),
        "agent_key": f.agent_sk.public_key().to_string(),
        "allowlist": [f.bob.id()],
        "per_tx_cap": NearToken::from_near(1).as_yoctonear().to_string(),
        "period_cap": NearToken::from_near(5).as_yoctonear().to_string(),
        "period_seconds": 86400,
        "guardian_window_seconds": 5
    })).transact().await?.into_result()?;

    // dev_deploy starts with 100 NEAR balance.
    // 1. Requesting amount > balance at entry is rejected with "insufficient balance"
    let req_unfunded = f.alice.call(agent.id(), "request")
        .args_json(json!({
            "kind": { "Withdraw": { "amount": NearToken::from_near(200).as_yoctonear().to_string() } }
        }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(45))
        .transact().await?;
    assert!(!req_unfunded.is_success());
    assert!(format!("{:?}", req_unfunded).contains("insufficient balance"));

    // 2. Requesting 97 NEAR is valid at entry (100 >= 97 + ~2.1 floor)
    let req_excess = f.alice.call(agent.id(), "request")
        .args_json(json!({
            "kind": { "Withdraw": { "amount": NearToken::from_near(97).as_yoctonear().to_string() } }
        }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(45))
        .transact().await?;
    assert!(req_excess.is_success());

    // During the guardian window, balance drops (agent transfers 2 NEAR to bob)
    agent.as_account().transfer_near(f.bob.id(), NearToken::from_near(2)).await?.into_result()?;

    // Fast-forward past guardian window
    f.worker.fast_forward(20).await?;

    // Now balance is ~98 NEAR < 97 + floor, so execute fails with "withdrawal would drop below storage floor"
    let exec_floor = f.alice.call(agent.id(), "execute")
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(50))
        .transact().await?;
    assert!(!exec_floor.is_success());
    assert!(format!("{:?}", exec_floor).contains("withdrawal would drop below storage floor"));

    // Alice cancels the failed withdrawal action
    let cancel_res = f.alice.call(agent.id(), "cancel_own")
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(45))
        .transact().await?;
    assert!(cancel_res.is_success());

    // 3. Alice requests valid withdrawal of 1 NEAR
    let req_ok = f.alice.call(agent.id(), "request")
        .args_json(json!({
            "kind": { "Withdraw": { "amount": NearToken::from_near(1).as_yoctonear().to_string() } }
        }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(45))
        .transact().await?;
    assert!(req_ok.is_success());

    f.worker.fast_forward(20).await?;

    let alice_bal_before = f.worker.view_account(f.alice.id()).await?.balance;
    let exec_ok = f.alice.call(agent.id(), "execute")
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(50))
        .transact().await?;
    assert!(exec_ok.is_success(), "Valid withdrawal execute failed: {:?}", exec_ok);

    let alice_bal_after = f.worker.view_account(f.alice.id()).await?.balance;
    assert!(alice_bal_after.as_yoctonear() > alice_bal_before.as_yoctonear() + NearToken::from_millinear(900).as_yoctonear());

    // 4. Test paying current owner after NFT transfer
    // Alice transfers NFT token-1 to Bob
    let transfer_res = f.alice.call(f.nft_contract.id(), "nft_transfer")
        .args_json(json!({
            "receiver_id": f.bob.id(),
            "token_id": "token-1"
        }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(30))
        .transact().await?;
    assert!(transfer_res.is_success());

    // Bob (new owner) requests 1 NEAR withdrawal
    let bob_req = f.bob.call(agent.id(), "request")
        .args_json(json!({
            "kind": { "Withdraw": { "amount": NearToken::from_near(1).as_yoctonear().to_string() } }
        }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(45))
        .transact().await?;
    assert!(bob_req.is_success());

    f.worker.fast_forward(20).await?;

    let bob_bal_before = f.worker.view_account(f.bob.id()).await?.balance;
    let bob_exec = f.bob.call(agent.id(), "execute")
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(50))
        .transact().await?;
    assert!(bob_exec.is_success(), "Bob withdrawal failed: {:?}", bob_exec);

    let bob_bal_after = f.worker.view_account(f.bob.id()).await?.balance;
    assert!(bob_bal_after.as_yoctonear() > bob_bal_before.as_yoctonear() + NearToken::from_millinear(900).as_yoctonear());

    Ok(())
}

#[tokio::test]
async fn test_middleman_proxy_contract_cannot_spoof_owner() -> Result<(), Box<dyn std::error::Error>> {
    let f = setup_fixture().await?;

    // Deploy toy identity / proxy contract
    let toy_wasm = std::fs::read("../../target/near/toy_identity/toy_identity.wasm")
        .or_else(|_| std::fs::read("target/near/toy_identity/toy_identity.wasm"))?;
    let proxy = f.worker.dev_deploy(&toy_wasm).await?;
    proxy.call("new").transact().await?.into_result()?;

    // An external contract (proxy) calling pause_as_owner on agent_contract directly
    // arrives with predecessor == proxy.id() != alice.id() (cur_owner)
    let spoof_res = proxy.as_account()
        .call(f.agent_contract.id(), "pause_as_owner")
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(50))
        .transact()
        .await?;
    assert!(!spoof_res.is_success());
    let err = format!("{:?}", spoof_res);
    assert!(err.contains("not owner"), "Middleman must be rejected with 'not owner', got: {}", err);

    Ok(())
}

#[tokio::test]
async fn test_concurrent_executes_pay_once_with_overlap_precondition() -> Result<(), Box<dyn std::error::Error>> {
    let f = setup_fixture().await?;

    let agent = f.worker.dev_deploy(&f.agent_testing_wasm).await?;
    agent.call("new").args_json(json!({
        "nft_contract": f.nft_contract.id(),
        "nft_token_id": "token-1",
        "guardian": f.guardian.id(),
        "agent_key": f.agent_sk.public_key().to_string(),
        "allowlist": [f.bob.id()],
        "per_tx_cap": NearToken::from_near(1).as_yoctonear().to_string(),
        "period_cap": NearToken::from_near(5).as_yoctonear().to_string(),
        "period_seconds": 86400,
        "guardian_window_seconds": 5
    })).transact().await?.into_result()?;

    f.root.transfer_near(agent.id(), NearToken::from_near(5)).await?.into_result()?;

    // Alice requests withdraw of 1 NEAR
    let req = f.alice.call(agent.id(), "request")
        .args_json(json!({
            "kind": { "Withdraw": { "amount": NearToken::from_near(1).as_yoctonear().to_string() } }
        }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(45))
        .transact().await?;
    assert!(req.is_success());

    f.worker.fast_forward(20).await?;

    // Fire two concurrent execute calls asynchronously
    let h1 = f.alice.call(agent.id(), "execute")
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(50))
        .transact_async().await?;

    let h2 = f.alice.call(agent.id(), "execute")
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(50))
        .transact_async().await?;

    let (r1, r2) = tokio::join!(h1, h2);
    let res1 = r1?;
    let res2 = r2?;

    let all_logs: Vec<&str> = res1.logs().into_iter().chain(res2.logs().into_iter()).collect();
    let mut entry_blocks = Vec::new();
    let mut callback_blocks = Vec::new();
    for log in &all_logs {
        if log.starts_with("ENTRY block=") {
            if let Ok(b) = log.trim_start_matches("ENTRY block=").parse::<u64>() {
                entry_blocks.push(b);
            }
        } else if log.starts_with("CALLBACK block=") {
            if let Ok(b) = log.trim_start_matches("CALLBACK block=").parse::<u64>() {
                callback_blocks.push(b);
            }
        }
    }
    if entry_blocks.len() >= 2 && !callback_blocks.is_empty() {
        let entry2 = entry_blocks[1];
        let cb1 = callback_blocks[0];
        if entry2 < cb1 {
            println!("Precondition: concurrency overlap confirmed (entry2_block {} < callback1_block {})", entry2, cb1);
        } else {
            eprintln!("Precondition note: sandbox serialized execution (entry2_block {} >= callback1_block {}); test inconclusive for concurrent overlap, verified sequential slot protection.", entry2, cb1);
        }
    }

    // Concurrency invariant: Exactly one succeeds; the second sees owner_slot taken and fails!
    let s1 = res1.is_success();
    let s2 = res2.is_success();
    assert!(s1 ^ s2, "Expected exactly one execute call to succeed, got s1: {}, s2: {}", s1, s2);

    let failed_res = if !s1 { res1 } else { res2 };
    let err_str = format!("{:?}", failed_res);
    assert!(err_str.contains("no pending action"), "Second concurrent execute must fail with 'no pending action', got: {}", err_str);

    Ok(())
}

#[tokio::test]
async fn test_guardian_replacement_lifecycle() -> Result<(), Box<dyn std::error::Error>> {
    let f = setup_fixture().await?;

    let agent = f.worker.dev_deploy(&f.agent_testing_wasm).await?;
    agent.call("new").args_json(json!({
        "nft_contract": f.nft_contract.id(),
        "nft_token_id": "token-1",
        "guardian": f.guardian.id(),
        "agent_key": f.agent_sk.public_key().to_string(),
        "allowlist": [f.bob.id()],
        "per_tx_cap": NearToken::from_near(1).as_yoctonear().to_string(),
        "period_cap": NearToken::from_near(5).as_yoctonear().to_string(),
        "period_seconds": 86400,
        "guardian_window_seconds": 5
    })).transact().await?.into_result()?;

    let charlie = f.root.create_subaccount("charlie-guardian")
        .initial_balance(NearToken::from_near(10))
        .transact().await?.into_result()?;

    // 1. Non-guardian proposing replacement fails with "not guardian"
    let non_guardian_prop = f.alice.call(agent.id(), "propose_guardian_replacement")
        .args_json(json!({ "new_guardian": charlie.id() }))
        .transact().await?;
    assert!(!non_guardian_prop.is_success());
    assert!(format!("{:?}", non_guardian_prop).contains("not guardian"));

    // 2. Proposing same account fails with "must be different account"
    let same_guardian_prop = f.guardian.call(agent.id(), "propose_guardian_replacement")
        .args_json(json!({ "new_guardian": f.guardian.id() }))
        .transact().await?;
    assert!(!same_guardian_prop.is_success());
    assert!(format!("{:?}", same_guardian_prop).contains("must be different account"));

    // 3. Current guardian proposes Charlie -> succeeds
    let prop_res = f.guardian.call(agent.id(), "propose_guardian_replacement")
        .args_json(json!({ "new_guardian": charlie.id() }))
        .transact().await?;
    assert!(prop_res.is_success());

    // 4. Non-owner attempting to confirm fails with "not owner"
    let bob_confirm = f.bob.call(agent.id(), "confirm_guardian_replacement")
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(50))
        .transact().await?;
    assert!(!bob_confirm.is_success());
    assert!(format!("{:?}", bob_confirm).contains("not owner"));

    // 5. Owner (Alice) confirms guardian replacement
    let alice_confirm = f.alice.call(agent.id(), "confirm_guardian_replacement")
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(50))
        .transact().await?;
    assert!(alice_confirm.is_success(), "Owner confirmation failed: {:?}", alice_confirm);

    // 6. Verify state shows Charlie as new guardian
    let state: serde_json::Value = agent.view("get_state").await?.json()?;
    assert_eq!(state["guardian"], charlie.id().to_string());

    // 7. Old guardian cannot pause
    let old_pause = f.guardian.call(agent.id(), "pause_as_guardian").transact().await?;
    assert!(!old_pause.is_success());
    assert!(format!("{:?}", old_pause).contains("not guardian"));

    // 8. New guardian (Charlie) can pause
    let new_pause = charlie.call(agent.id(), "pause_as_guardian").transact().await?;
    assert!(new_pause.is_success());
    let state_paused: serde_json::Value = agent.view("get_state").await?.json()?;
    assert_eq!(state_paused["paused"], true);

    // 9. Window expiry test
    let dave = f.root.create_subaccount("dave-guardian")
        .initial_balance(NearToken::from_near(10))
        .transact().await?.into_result()?;

    let prop2 = charlie.call(agent.id(), "propose_guardian_replacement")
        .args_json(json!({ "new_guardian": dave.id() }))
        .transact().await?;
    assert!(prop2.is_success());

    // Fast-forward past confirm_by (2 * 5s = 10s -> ~50 blocks)
    f.worker.fast_forward(50).await?;

    let expired_confirm = f.alice.call(agent.id(), "confirm_guardian_replacement")
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(50))
        .transact().await?;
    assert!(!expired_confirm.is_success());
    assert!(format!("{:?}", expired_confirm).contains("window expired"));

    Ok(())
}

#[tokio::test]
async fn test_production_wasm_rejects_testing_flag_and_refuses_testing_method() -> Result<(), Box<dyn std::error::Error>> {
    let f = setup_fixture().await?;

    // 1. Production WASM must NOT have is_testing_build (must fail with MethodNotFound)
    let prod_view = f.agent_contract.view("is_testing_build").await;
    assert!(prod_view.is_err(), "Production WASM must NOT answer is_testing_build!");
    assert!(format!("{:?}", prod_view).contains("MethodNotFound"), "Expected MethodNotFound, got: {:?}", prod_view);

    // 2. Testing WASM must answer is_testing_build == true
    let test_agent = f.worker.dev_deploy(&f.agent_testing_wasm).await?;
    let test_view: bool = test_agent.view("is_testing_build").await?.json()?;
    assert_eq!(test_view, true, "Testing WASM must answer is_testing_build == true");

    Ok(())
}

#[tokio::test]
async fn test_contract_level_sliding_window_advances_and_clears_elapsed_spend() -> Result<(), Box<dyn std::error::Error>> {
    let f = setup_fixture().await?;

    let agent = f.worker.dev_deploy(&f.agent_wasm).await?;
    let agent_sk = near_workspaces::types::SecretKey::from_random(near_workspaces::types::KeyType::ED25519);
    let agent_pk = agent_sk.public_key();

    let scoped_key = near_workspaces::types::AccessKey::function_call_access(
        agent.id(),
        &["spend"],
        Some(NearToken::from_near(5)),
    );
    agent
        .as_account()
        .batch(agent.id())
        .add_key(agent_pk.clone(), scoped_key)
        .transact()
        .await?
        .into_result()?;

    f.root
        .transfer_near(agent.id(), NearToken::from_near(10))
        .await?
        .into_result()?;

    // 1440s minimum period = 24 minutes, 1 NEAR per-tx cap, 1 NEAR period cap
    agent.call("new").args_json(json!({
        "nft_contract": f.nft_contract.id(),
        "nft_token_id": "token-1",
        "guardian": f.guardian.id(),
        "agent_key": agent_pk.to_string(),
        "allowlist": [f.bob.id()],
        "per_tx_cap": NearToken::from_near(1).as_yoctonear().to_string(),
        "period_cap": NearToken::from_near(1).as_yoctonear().to_string(),
        "period_seconds": 1440,
        "guardian_window_seconds": 3600
    })).transact().await?.into_result()?;

    let agent_caller = near_workspaces::Account::from_secret_key(
        agent.id().clone(),
        agent_sk,
        &f.worker,
    );

    // 1. Spend 1 NEAR (hits 100% of period cap)
    let res1 = agent_caller
        .call(agent.id(), "spend")
        .args_json(json!({
            "amount": NearToken::from_near(1).as_yoctonear().to_string(),
            "recipient": f.bob.id(),
            "memo": "initial spend hitting cap"
        }))
        .gas(Gas::from_tgas(30))
        .transact()
        .await?;
    assert!(res1.is_success(), "Spend 1 failed: {:?}", res1);

    // 2. Immediate spend of 0.1 NEAR fails with exceeds period_cap
    let res2 = agent_caller
        .call(agent.id(), "spend")
        .args_json(json!({
            "amount": NearToken::from_millinear(100).as_yoctonear().to_string(),
            "recipient": f.bob.id(),
            "memo": "immediate over-cap spend"
        }))
        .gas(Gas::from_tgas(30))
        .transact()
        .await?;
    assert!(!res2.is_success());
    assert!(format!("{:?}", res2).contains("exceeds period_cap"));

    // 3. Fast-forward past full period: 1440s -> fast_forward 6000 blocks (robust margin)
    f.worker.fast_forward(6000).await?;

    // 4. Spend 1 NEAR again succeeds because r.advance() rolled elapsed buckets to 0
    let res3 = agent_caller
        .call(agent.id(), "spend")
        .args_json(json!({
            "amount": NearToken::from_near(1).as_yoctonear().to_string(),
            "recipient": f.bob.id(),
            "memo": "spend after window elapsed"
        }))
        .gas(Gas::from_tgas(30))
        .transact()
        .await?;
    assert!(res3.is_success(), "Spend 3 after period advance failed: {:?}", res3);

    Ok(())
}

#[tokio::test]
async fn test_measure_real_contract_spend_gas() -> Result<(), Box<dyn std::error::Error>> {
    let f = setup_fixture().await?;

    // 1. Successful spend at 30 TGas
    let ok_res = f
        .agent_caller
        .call(f.agent_contract.id(), "spend")
        .args_json(json!({
            "amount": NearToken::from_millinear(50).as_yoctonear().to_string(),
            "recipient": f.bob.id(),
            "memo": "gas measurement spend"
        }))
        .gas(Gas::from_tgas(30))
        .transact()
        .await?;
    assert!(ok_res.is_success());
    println!("MEASURED SUCCESSFUL SPEND GAS: total_gas_burnt = {:?}", ok_res.total_gas_burnt);
    assert!(ok_res.total_gas_burnt.as_gas() < 8_000_000_000_000, "successful spend exceeded 8 TGas upper bound: {:?}", ok_res.total_gas_burnt);

    // 2. Reverted spend at 30 TGas (exceeds per-tx cap)
    let rev_res = f
        .agent_caller
        .call(f.agent_contract.id(), "spend")
        .args_json(json!({
            "amount": NearToken::from_near(2).as_yoctonear().to_string(),
            "recipient": f.bob.id(),
            "memo": "reverted spend"
        }))
        .gas(Gas::from_tgas(30))
        .transact()
        .await?;
    assert!(!rev_res.is_success());
    println!("MEASURED REVERTED SPEND GAS: total_gas_burnt = {:?}", rev_res.total_gas_burnt);
    assert!(rev_res.total_gas_burnt.as_gas() < 4_000_000_000_000, "reverted spend exceeded 4 TGas upper bound: {:?}", rev_res.total_gas_burnt);

    Ok(())
}

#[tokio::test]
async fn test_offline_demo_runner_and_export_json() -> Result<(), Box<dyn std::error::Error>> {
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;

    let nft_wasm = std::fs::read("../../target/near/nft/nft.wasm")
        .or_else(|_| std::fs::read("target/near/nft/nft.wasm"))?;
    let agent_wasm = std::fs::read("../../target/near/agent_account/agent_account.wasm")
        .or_else(|_| std::fs::read("target/near/agent_account/agent_account.wasm"))?;

    let alice = root.create_subaccount("demo-alice").initial_balance(NearToken::from_near(20)).transact().await?.into_result()?;
    let bob = root.create_subaccount("demo-bob").initial_balance(NearToken::from_near(10)).transact().await?.into_result()?;
    let dave = root.create_subaccount("demo-dave").initial_balance(NearToken::from_near(10)).transact().await?.into_result()?;
    let guardian = root.create_subaccount("demo-guard").initial_balance(NearToken::from_near(10)).transact().await?.into_result()?;

    let nft_id: near_workspaces::AccountId = format!("keyless-nft.{}", root.id()).parse()?;
    let nft_batch_res = root
        .batch(&nft_id)
        .create_account()
        .transfer(NearToken::from_near(5))
        .deploy(&nft_wasm)
        .call(
            near_workspaces::operations::Function::new("new")
                .args_json(json!({
                    "owner_id": alice.id(),
                    "token_id": "token-1"
                }))
        )
        .transact()
        .await?;
    assert!(nft_batch_res.is_success(), "NFT batch failed: {:?}", nft_batch_res);

    let agent_sk = near_workspaces::types::SecretKey::from_random(near_workspaces::types::KeyType::ED25519);
    let agent_pk = agent_sk.public_key();
    let agent_id: near_workspaces::AccountId = format!("locked-agent.{}", root.id()).parse()?;

    let scoped_key = near_workspaces::types::AccessKey::function_call_access(
        &agent_id,
        &["spend"],
        Some(NearToken::from_millinear(250)),
    );

    // Atomic 5-action batch birth with production WASM
    let batch_res = root
        .batch(&agent_id)
        .create_account()
        .transfer(NearToken::from_near(10))
        .deploy(&agent_wasm)
        .call(
            near_workspaces::operations::Function::new("new")
                .args_json(json!({
                    "nft_contract": nft_id.to_string(),
                    "nft_token_id": "token-1",
                    "guardian": guardian.id(),
                    "agent_key": agent_pk.to_string(),
                    "allowlist": [bob.id()],
                    "per_tx_cap": NearToken::from_near(1).as_yoctonear().to_string(),
                    "period_cap": NearToken::from_near(5).as_yoctonear().to_string(),
                    "period_seconds": 86400,
                    "guardian_window_seconds": 3600
                }))
        )
        .add_key(agent_pk.clone(), scoped_key)
        .transact()
        .await?;
    assert!(batch_res.is_success(), "Demo batch failed: {:?}", batch_res);

    let access_keys = worker.view_access_keys(&agent_id).await?;
    assert_eq!(access_keys.len(), 1);
    assert!(matches!(access_keys[0].access_key.permission, near_workspaces::types::AccessKeyPermission::FunctionCall(_)));

    // Real key list computation
    let zero_full_access_keys = access_keys.iter().all(|k| {
        !matches!(k.access_key.permission, near_workspaces::types::AccessKeyPermission::FullAccess)
    });
    let single_scoped_spend_key = access_keys.len() == 1 && access_keys.iter().any(|k| {
        if let near_workspaces::types::AccessKeyPermission::FunctionCall(ref fc) = k.access_key.permission {
            fc.receiver_id.as_str() == agent_id.as_str()
                && fc.method_names == vec!["spend".to_string()]
                && fc.allowance.is_some()
        } else {
            false
        }
    });

    let agent_caller = near_workspaces::Account::from_secret_key(agent_id.clone(), agent_sk, &worker);

    // --- Scenario A: Legitimate Operation Within Cap ---
    println!("=== DEMO SCENARIO A: Legitimate Operation Within Cap ===");
    let spend_a = agent_caller.call(&agent_id, "spend")
        .args_json(json!({
            "amount": NearToken::from_millinear(200).as_yoctonear().to_string(),
            "recipient": bob.id(),
            "memo": "compute inference payment"
        }))
        .gas(Gas::from_tgas(30))
        .transact()
        .await?;
    assert!(spend_a.is_success());
    let gas_a = spend_a.total_gas_burnt;
    let gas_a_numeric = gas_a.as_gas().to_string();
    println!("Scenario A Passed: Gas Burnt = {} ({:?})", gas_a_numeric, gas_a);

    // --- Scenario B: Malicious Over-Cap Invoice ---
    println!("=== DEMO SCENARIO B: Malicious Over-Cap Invoice ===");
    let spend_b = agent_caller.call(&agent_id, "spend")
        .args_json(json!({
            "amount": NearToken::from_near(2).as_yoctonear().to_string(),
            "recipient": bob.id(),
            "memo": "malicious invoice"
        }))
        .gas(Gas::from_tgas(30))
        .transact()
        .await?;
    assert!(!spend_b.is_success());
    let err_b = format!("{:?}", spend_b);
    assert!(err_b.contains("exceeds per_tx_cap"));
    println!("Scenario B Passed: Reverted with 'exceeds per_tx_cap'");

    // --- Scenario C: Supervisory Ownership Sale & Transfer ---
    println!("=== DEMO SCENARIO C: Supervisory Ownership Sale & Transfer ===");
    let req_res = alice.call(&agent_id, "request")
        .args_json(json!({
            "kind": { "Withdraw": { "amount": NearToken::from_near(1).as_yoctonear().to_string() } }
        }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(50))
        .transact()
        .await?;
    assert!(req_res.is_success(), "Request failed: {:?}", req_res);

    // Alice sells/transfers NFT to Dave
    let xfer = alice.call(&nft_id, "nft_transfer")
        .args_json(json!({ "receiver_id": dave.id(), "token_id": "token-1" }))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?;
    assert!(xfer.is_success());

    // Alice (previous owner) attempts to execute pending withdrawal slot -> fails with "not owner"
    let alice_exec = alice.call(&agent_id, "execute")
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(50))
        .transact()
        .await?;
    assert!(!alice_exec.is_success());
    assert!(format!("{:?}", alice_exec).contains("not owner"));
    println!("Scenario C.1 Passed: Old owner execution rejected with 'not owner'");

    // Dave (new owner) attempts to execute Alice's stale proposal -> fails with "proposer is no longer owner"
    let dave_exec = dave.call(&agent_id, "execute")
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(50))
        .transact()
        .await?;
    assert!(!dave_exec.is_success());
    assert!(format!("{:?}", dave_exec).contains("proposer is no longer owner"));
    println!("Scenario C.2 Passed: Stale proposal execution rejected with 'proposer is no longer owner'");

    // --- Spawn CLI leash verify against sandbox accounts ---
    let project_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent().unwrap().parent().unwrap();
    let cli_path = project_root.join("tools/dist/cli.js");
    let dev_rel_path = project_root.join("release.dev.json");
    let prod_rel_path = project_root.join("release.json");
    let rpc_url = worker.rpc_addr().to_string();

    println!("Spawning CLI verify against sandbox RPC: {}", rpc_url);

    // 1. Verify locked agent with dev release -> LOCKED_AND_VERIFIED
    let out_locked_dev = std::process::Command::new("node")
        .arg(&cli_path)
        .arg("verify")
        .arg(agent_id.as_str())
        .arg("--rpc")
        .arg(&rpc_url)
        .arg("--release")
        .arg(&dev_rel_path)
        .output()?;
    let stdout_locked_dev = String::from_utf8_lossy(&out_locked_dev.stdout).to_string();
    assert!(stdout_locked_dev.contains("STATUS: [ LOCKED_AND_VERIFIED ]"), "expected LOCKED_AND_VERIFIED, got: {}", stdout_locked_dev);

    // 2. Verify locked agent with official release.json -> KEYS_LOCKED_CODE_UNVERIFIED (since release.json hashes are null until release tag)
    let out_locked_prod = std::process::Command::new("node")
        .arg(&cli_path)
        .arg("verify")
        .arg(agent_id.as_str())
        .arg("--rpc")
        .arg(&rpc_url)
        .arg("--release")
        .arg(&prod_rel_path)
        .output()?;
    let stdout_locked_prod = String::from_utf8_lossy(&out_locked_prod.stdout).to_string();
    assert!(stdout_locked_prod.contains("STATUS: [ KEYS_LOCKED_CODE_UNVERIFIED ]"), "expected KEYS_LOCKED_CODE_UNVERIFIED, got: {}", stdout_locked_prod);

    // 3. Verify dev account with FullAccess key (alice) -> NOT_LOCKED
    let out_unlocked = std::process::Command::new("node")
        .arg(&cli_path)
        .arg("verify")
        .arg(alice.id().as_str())
        .arg("--rpc")
        .arg(&rpc_url)
        .output()?;
    let stdout_unlocked = String::from_utf8_lossy(&out_unlocked.stdout).to_string();
    assert!(stdout_unlocked.contains("STATUS: [ NOT_LOCKED ]"), "expected NOT_LOCKED, got: {}", stdout_unlocked);

    let timestamp_iso = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);

    // Export demo-run.json
    let demo_run = json!({
        "timestamp": timestamp_iso,
        "environment": "near-sandbox-offline",
        "agent_account_id": agent_id.to_string(),
        "zero_full_access_keys": zero_full_access_keys,
        "single_scoped_spend_key": single_scoped_spend_key,
        "production_wasm_deployed": true,
        "cli_verification": {
            "locked_agent_account": {
                "account_id": agent_id.to_string(),
                "outcome_with_dev_release": "LOCKED_AND_VERIFIED",
                "outcome_with_official_release": "KEYS_LOCKED_CODE_UNVERIFIED",
                "cli_output": stdout_locked_dev.trim()
            },
            "unlocked_dev_account": {
                "account_id": alice.id().to_string(),
                "outcome": "NOT_LOCKED",
                "cli_output": stdout_unlocked.trim()
            }
        },
        "scenarios": [
            {
                "id": "A",
                "name": "Legitimate Operation Within Cap",
                "action": "spend",
                "amount": "0.2 NEAR",
                "recipient": bob.id().to_string(),
                "expected": "SUCCESS",
                "status": "PASSED",
                "gas_burnt": gas_a_numeric
            },
            {
                "id": "B",
                "name": "Malicious Over-Cap Invoice",
                "action": "spend",
                "amount": "2.0 NEAR",
                "recipient": bob.id().to_string(),
                "expected": "REVERT",
                "status": "PASSED",
                "error": "exceeds per_tx_cap"
            },
            {
                "id": "C",
                "name": "Supervisory Ownership Sale & Transfer",
                "action": "supervisory_action(Execute)",
                "expected": "REVERT",
                "status": "PASSED",
                "steps": [
                    {
                        "step": 1,
                        "action": "nft_transfer",
                        "sender": alice.id().to_string(),
                        "receiver": dave.id().to_string(),
                        "outcome": "SUCCESS"
                    },
                    {
                        "step": 2,
                        "action": "execute",
                        "sender": alice.id().to_string(),
                        "outcome": "REVERT",
                        "error": "not owner"
                    },
                    {
                        "step": 3,
                        "action": "execute",
                        "sender": dave.id().to_string(),
                        "outcome": "REVERT",
                        "error": "proposer is no longer owner"
                    }
                ]
            }
        ]
    });

    let demo_str = serde_json::to_string_pretty(&demo_run)?;
    for out_path in &[
        "demo-run.json",
        "../../demo-run.json",
        "../../web/demo-run.json",
        "../../demo-run.sample.json"
    ] {
        let _ = std::fs::write(out_path, &demo_str);
    }
    println!("✓ demo-run.json and demo-run.sample.json generated successfully.");

    Ok(())
}

#[tokio::test]
async fn test_measure_key_allowance_burn_at_30_and_100_tgas() -> Result<(), Box<dyn std::error::Error>> {
    let f = setup_fixture().await?;
    let pk = f.agent_sk.public_key();

    let keys0 = f.worker.view_access_keys(f.agent_contract.id()).await?;
    let mut allow0 = 0u128;
    for k in &keys0 {
        if k.public_key == pk {
            if let near_workspaces::types::AccessKeyPermission::FunctionCall(ref fc) = k.access_key.permission {
                allow0 = fc.allowance.map(|a| a.as_yoctonear()).unwrap_or(0);
            }
        }
    }

    // Call spend with 30 TGas
    let res30 = f
        .agent_caller
        .call(f.agent_contract.id(), "spend")
        .args_json(json!({
            "amount": NearToken::from_millinear(50).as_yoctonear().to_string(),
            "recipient": f.bob.id(),
            "memo": "allowance check 30 Tgas"
        }))
        .gas(near_workspaces::types::Gas::from_tgas(30))
        .transact()
        .await?;
    assert!(res30.is_success());

    let keys1 = f.worker.view_access_keys(f.agent_contract.id()).await?;
    let mut allow1 = 0u128;
    for k in &keys1 {
        if k.public_key == pk {
            if let near_workspaces::types::AccessKeyPermission::FunctionCall(ref fc) = k.access_key.permission {
                allow1 = fc.allowance.map(|a| a.as_yoctonear()).unwrap_or(0);
            }
        }
    }
    let delta30 = allow0 - allow1;

    // Call spend with 100 TGas
    let res100 = f
        .agent_caller
        .call(f.agent_contract.id(), "spend")
        .args_json(json!({
            "amount": NearToken::from_millinear(50).as_yoctonear().to_string(),
            "recipient": f.bob.id(),
            "memo": "allowance check 100 Tgas"
        }))
        .gas(near_workspaces::types::Gas::from_tgas(100))
        .transact()
        .await?;
    assert!(res100.is_success());

    let keys2 = f.worker.view_access_keys(f.agent_contract.id()).await?;
    let mut allow2 = 0u128;
    for k in &keys2 {
        if k.public_key == pk {
            if let near_workspaces::types::AccessKeyPermission::FunctionCall(ref fc) = k.access_key.permission {
                allow2 = fc.allowance.map(|a| a.as_yoctonear()).unwrap_or(0);
            }
        }
    }
    let delta100 = allow1 - allow2;

    println!("ALLOWANCE MEASUREMENT:");
    println!("ALLOWANCE_0 (initial): {}", allow0);
    println!("ALLOWANCE_1 (after 30 TGas spend):  {} | DELTA_30:  {} yoctoNEAR", allow1, delta30);
    println!("ALLOWANCE_2 (after 100 TGas spend): {} | DELTA_100: {} yoctoNEAR", allow2, delta100);
    println!("TOTAL GAS BURNT 30 TGas call:  {:?}", res30.total_gas_burnt);
    println!("TOTAL GAS BURNT 100 TGas call: {:?}", res100.total_gas_burnt);

    Ok(())
}
