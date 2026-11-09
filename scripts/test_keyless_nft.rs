use near_workspaces::types::NearToken;
use serde_json::json;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("=== TESTING KEYLESS NFT DEPLOYMENT ===");

    let nft_wasm = std::fs::read("target/near/nft/nft.wasm")?;
    println!("NFT WASM size: {} bytes", nft_wasm.len());

    // 1. Sandbox verification first
    println!("\n[1] Testing on local Sandbox...");
    let sandbox = near_workspaces::sandbox().await?;
    let root = sandbox.root_account()?;

    let owner = root.create_subaccount("owner").initial_balance(NearToken::from_near(10)).transact().await?.into_result()?;
    let keyless_id: near_workspaces::AccountId = format!("keyless-nft.{}", root.id()).parse()?;

    // Atomic 4-action batch: CreateAccount, Transfer 3.5 NEAR, Deploy, FunctionCall new
    println!("Executing atomic 4-action keyless batch on sandbox...");
    let res = root.batch(&keyless_id)
        .create_account()
        .transfer(NearToken::from_millinear(3500))
        .deploy(&nft_wasm)
        .call(
            near_workspaces::operations::Function::new("new")
                .args_json(json!({
                    "owner_id": owner.id(),
                    "token_id": "token-1"
                }))
        )
        .transact()
        .await?;

    println!("Batch transaction success: {}", res.is_success());
    assert!(res.is_success(), "Sandbox keyless batch failed: {:?}", res);

    // Verify 0 access keys
    let keys = sandbox.view_access_keys(&keyless_id).await?;
    println!("Access keys count: {}", keys.len());
    assert_eq!(keys.len(), 0, "Expected 0 access keys on keyless contract!");
    println!("✓ Sandbox confirmed 0 access keys (keyless)!");

    // Verify token ownership
    let token: serde_json::Value = sandbox.view(&keyless_id, "nft_token")
        .args_json(json!({ "token_id": "token-1" }))
        .await?
        .json()?;
    println!("Token owner: {}", token["owner_id"]);
    assert_eq!(token["owner_id"], owner.id().to_string());
    println!("✓ Sandbox confirmed token-1 owner is {}", owner.id());

    // 2. Testnet verification
    println!("\n[2] Testing on NEAR Testnet...");
    match near_workspaces::testnet().await {
        Ok(testnet) => {
            println!("Connected to NEAR testnet.");
            let t_root = testnet.dev_create_account().await?;
            let t_keyless_id: near_workspaces::AccountId = format!("k-{}.{}", &t_root.id().to_string()[..10], t_root.id()).parse()?;

            println!("Deploying keyless NFT batch to testnet account: {}...", t_keyless_id);
            let t_res = t_root.batch(&t_keyless_id)
                .create_account()
                .transfer(NearToken::from_millinear(3500))
                .deploy(&nft_wasm)
                .call(
                    near_workspaces::operations::Function::new("new")
                        .args_json(json!({
                            "owner_id": t_root.id(),
                            "token_id": "token-1"
                        }))
                )
                .transact()
                .await?;

            println!("Testnet batch success: {}", t_res.is_success());
            if !t_res.is_success() {
                eprintln!("Testnet batch details: {:?}", t_res);
            }
            assert!(t_res.is_success());

            let t_keys = testnet.view_access_keys(&t_keyless_id).await?;
            println!("Testnet Access keys count: {}", t_keys.len());
            assert_eq!(t_keys.len(), 0, "Testnet expected 0 access keys!");

            let t_token: serde_json::Value = testnet.view(&t_keyless_id, "nft_token")
                .args_json(json!({ "token_id": "token-1" }))
                .await?
                .json()?;
            println!("Testnet Token owner: {}", t_token["owner_id"]);
            assert_eq!(t_token["owner_id"], t_root.id().to_string());
            println!("✅ EMPIRICALLY CONFIRMED ON TESTNET: Keyless NFT created with exactly 0 keys and valid token-1 owner!");
        }
        Err(e) => {
            println!("Testnet connection error: {:?}", e);
        }
    }

    Ok(())
}
