use near_contract_standards::non_fungible_token::metadata::{
    NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata, NFT_METADATA_SPEC,
};
use near_contract_standards::non_fungible_token::{NonFungibleToken, Token, TokenId};
use near_sdk::collections::LazyOption;
use near_sdk::{
    env, near, near_bindgen, require, AccountId, BorshStorageKey, PanicOnDefault,
    Promise, PromiseOrValue,
};

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    NonFungibleToken,
    Metadata,
    TokenMetadata,
    Enumeration,
    Approval,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct NftContract {
    tokens:   NonFungibleToken,
    metadata: LazyOption<NFTContractMetadata>,
}

#[near_bindgen]
impl NftContract {
    #[init]
    pub fn new(owner_id: AccountId, token_id: TokenId) -> Self {
        require!(!env::state_exists(), "already initialised");
        let mut tokens = NonFungibleToken::new(
            StorageKey::NonFungibleToken,
            owner_id.clone(),
            Some(StorageKey::TokenMetadata),
            Some(StorageKey::Enumeration),
            Some(StorageKey::Approval),
        );
        let metadata = LazyOption::new(
            StorageKey::Metadata,
            Some(&NFTContractMetadata {
                spec:           NFT_METADATA_SPEC.to_string(),
                name:           "Leash NFT".to_string(),
                symbol:         "LEASH".to_string(),
                icon:           None,
                base_uri:       None,
                reference:      None,
                reference_hash: None,
            }),
        );

        // Fixed single-token supply: mint token_id to owner_id upon contract deployment without deposit check (refund_id = None)
        tokens.internal_mint_with_refund(
            token_id,
            owner_id,
            Some(TokenMetadata {
                title: Some("Leash Controller NFT".to_string()),
                description: Some("Bearer supervisory and ownership asset for Leash Agent Account".to_string()),
                media: None,
                media_hash: None,
                copies: Some(1),
                issued_at: Some(env::block_timestamp().to_string()),
                expires_at: None,
                starts_at: None,
                updated_at: None,
                extra: None,
                reference: None,
                reference_hash: None,
            }),
            None,
        );

        Self { tokens, metadata }
    }
}

// ── NEP-171 standard implementation (macro-generated) ───────────────────────

near_contract_standards::impl_non_fungible_token_core!(NftContract, tokens);
near_contract_standards::impl_non_fungible_token_approval!(NftContract, tokens);
near_contract_standards::impl_non_fungible_token_enumeration!(NftContract, tokens);

#[near_bindgen]
impl NonFungibleTokenMetadataProvider for NftContract {
    fn nft_metadata(&self) -> NFTContractMetadata {
        self.metadata.get().unwrap()
    }
}
