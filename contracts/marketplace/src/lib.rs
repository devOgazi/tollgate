//! Marketplace — service listing registry, price discovery, request routing.
//!
//! Responsibilities (from README):
//!   - Service listing registry
//!   - Price discovery
//!   - Request routing

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, vec, Address, Bytes, Env, String, Vec,
};

// ── Storage keys ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Listing(u64),
    NextListingId,
    AllListings,
}

// ── Data types ────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug)]
pub struct Listing {
    pub id: u64,
    pub owner: Address,
    pub name: String,
    /// Asset identifier encoded as bytes (e.g. b"XLM" or a contract address).
    pub price_asset: Bytes,
    pub price_per_call: i128,
    /// Endpoint URL encoded as bytes.
    pub endpoint: Bytes,
    pub active: bool,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct MarketplaceContract;

#[contractimpl]
impl MarketplaceContract {
    /// Register a new service listing. Returns the listing id.
    pub fn register_listing(
        env: Env,
        owner: Address,
        name: String,
        price_asset: Bytes,
        price_per_call: i128,
        endpoint: Bytes,
    ) -> u64 {
        owner.require_auth();

        let id = Self::next_listing_id(&env);

        let listing = Listing {
            id,
            owner: owner.clone(),
            name,
            price_asset,
            price_per_call,
            endpoint,
            active: true,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Listing(id), &listing);
        Self::append_listing_id(&env, id);

        env.events()
            .publish((symbol_short!("listed"), id), owner);

        id
    }

    /// Deactivate a listing. Only the owner may call this.
    pub fn deactivate_listing(env: Env, owner: Address, listing_id: u64) {
        owner.require_auth();

        let mut listing = Self::get_listing_internal(&env, listing_id);
        assert_eq!(listing.owner, owner, "not listing owner");

        listing.active = false;
        env.storage()
            .persistent()
            .set(&DataKey::Listing(listing_id), &listing);

        env.events()
            .publish((symbol_short!("delisted"), listing_id), owner);
    }

    /// Return a listing by id.
    pub fn get_listing(env: Env, listing_id: u64) -> Listing {
        Self::get_listing_internal(&env, listing_id)
    }

    /// Return all listing ids (active or not — filtering is a client concern).
    pub fn list_all(env: Env) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::AllListings)
            .unwrap_or(vec![&env])
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    fn next_listing_id(env: &Env) -> u64 {
        let id: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::NextListingId)
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::NextListingId, &(id + 1));
        id
    }

    fn append_listing_id(env: &Env, id: u64) {
        let mut ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::AllListings)
            .unwrap_or(vec![env]);
        ids.push_back(id);
        env.storage()
            .persistent()
            .set(&DataKey::AllListings, &ids);
    }

    fn get_listing_internal(env: &Env, id: u64) -> Listing {
        env.storage()
            .persistent()
            .get(&DataKey::Listing(id))
            .expect("listing not found")
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{Bytes, Env, String};

    fn setup(env: &Env) -> (Address, Address) {
        env.mock_all_auths();
        let contract_id = env.register_contract(None, MarketplaceContract);
        let owner = Address::generate(env);
        (contract_id, owner)
    }

    #[test]
    fn test_register_and_get_listing() {
        let env = Env::default();
        let (contract_id, owner) = setup(&env);
        let client = MarketplaceContractClient::new(&env, &contract_id);

        let name = String::from_str(&env, "sentiment-v1");
        let asset = Bytes::from_slice(&env, b"XLM");
        let endpoint = Bytes::from_slice(&env, b"https://example.com/infer");

        let id = client.register_listing(&owner, &name, &asset, &500, &endpoint);
        let listing = client.get_listing(&id);

        assert_eq!(listing.price_per_call, 500);
        assert!(listing.active);
    }

    #[test]
    fn test_list_all_returns_ids() {
        let env = Env::default();
        let (contract_id, owner) = setup(&env);
        let client = MarketplaceContractClient::new(&env, &contract_id);

        let name = String::from_str(&env, "svc-a");
        let asset = Bytes::from_slice(&env, b"XLM");
        let ep = Bytes::from_slice(&env, b"https://a.example.com");

        client.register_listing(&owner, &name, &asset, &100, &ep);
        client.register_listing(&owner, &name, &asset, &200, &ep);

        let ids = client.list_all();
        assert_eq!(ids.len(), 2);
    }

    #[test]
    fn test_deactivate_listing() {
        let env = Env::default();
        let (contract_id, owner) = setup(&env);
        let client = MarketplaceContractClient::new(&env, &contract_id);

        let name = String::from_str(&env, "svc-b");
        let asset = Bytes::from_slice(&env, b"USDC");
        let ep = Bytes::from_slice(&env, b"https://b.example.com");

        let id = client.register_listing(&owner, &name, &asset, &300, &ep);
        client.deactivate_listing(&owner, &id);

        let listing = client.get_listing(&id);
        assert!(!listing.active);
    }
}
