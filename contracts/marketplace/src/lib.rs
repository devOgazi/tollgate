//! Marketplace — service listing registry, price discovery, request routing.
//!
//! Responsibilities (from README):
//!   - Service listing registry
//!   - Price discovery
//!   - Request routing (create_request with cross-contract Escrow::lock)

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
    Request(u64),
    NextRequestId,
    AllRequests,
    EscrowContract,
}

// ── Data types ────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum RequestStatus {
    Pending,
    Locked,
    Fulfilled,
    Refunded,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Listing {
    pub id: u64,
    pub owner: Address,
    pub name: String,
    /// Asset identifier encoded as bytes (e.g. b"XLM" or a contract address).
    pub price_asset: Bytes,
    /// Token contract address used for escrow payments.
    pub token_addr: Address,
    pub price_per_call: i128,
    /// Endpoint URL encoded as bytes.
    pub endpoint: Bytes,
    pub active: bool,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct MarketRequest {
    pub id: u64,
    pub listing_id: u64,
    pub buyer: Address,
    pub seller: Address,
    pub amount: i128,
    /// Escrow ID returned by Escrow::lock().
    pub escrow_id: u64,
    pub status: RequestStatus,
}

// ── Escrow cross-contract interface ───────────────────────────────────────────

mod escrow_interface {
    use soroban_sdk::{contractclient, Address, Env};

    #[contractclient(name = "EscrowClient")]
    pub trait EscrowInterface {
        fn lock(
            env: Env,
            buyer: Address,
            seller: Address,
            token_addr: Address,
            amount: i128,
            timeout: u64,
        ) -> u64;

        fn release(env: Env, buyer: Address, escrow_id: u64);
    }
}

use escrow_interface::EscrowClient;

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct MarketplaceContract;

#[contractimpl]
impl MarketplaceContract {
    /// Initialise the contract by recording the address of the Escrow contract.
    /// Must be called once after deployment.
    pub fn initialize(env: Env, escrow_contract: Address) {
        assert!(
            !env.storage()
                .persistent()
                .has(&DataKey::EscrowContract),
            "already initialized"
        );
        env.storage()
            .persistent()
            .set(&DataKey::EscrowContract, &escrow_contract);
    }

    // ── Listings ──────────────────────────────────────────────────────────────

    /// Register a new service listing. Returns the listing id.
    pub fn register_listing(
        env: Env,
        owner: Address,
        name: String,
        price_asset: Bytes,
        token_addr: Address,
        price_per_call: i128,
        endpoint: Bytes,
    ) -> u64 {
        owner.require_auth();

        assert!(price_per_call > 0, "price must be positive");

        let id = Self::next_listing_id(&env);

        let listing = Listing {
            id,
            owner: owner.clone(),
            name,
            price_asset,
            token_addr,
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

    // ── Requests ──────────────────────────────────────────────────────────────

    /// Create a request for a listing, locking funds in escrow via a
    /// cross-contract call to Escrow::lock().
    ///
    /// `buyer` must have approved the Escrow contract to pull `amount` tokens.
    /// `timeout` is the Unix ledger timestamp after which the buyer may refund.
    /// Returns the marketplace request id.
    pub fn create_request(
        env: Env,
        buyer: Address,
        listing_id: u64,
        timeout: u64,
    ) -> u64 {
        buyer.require_auth();

        let listing = Self::get_listing_internal(&env, listing_id);
        assert!(listing.active, "listing is not active");

        let escrow_contract: Address = env
            .storage()
            .persistent()
            .get(&DataKey::EscrowContract)
            .expect("not initialized");

        let escrow_client = EscrowClient::new(&env, &escrow_contract);

        // Cross-contract call — locks buyer's funds in the Escrow contract.
        let escrow_id = escrow_client.lock(
            &buyer,
            &listing.owner,
            &listing.token_addr,
            &listing.price_per_call,
            &timeout,
        );

        let request_id = Self::next_request_id(&env);

        let request = MarketRequest {
            id: request_id,
            listing_id,
            buyer: buyer.clone(),
            seller: listing.owner,
            amount: listing.price_per_call,
            escrow_id,
            status: RequestStatus::Locked,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Request(request_id), &request);
        Self::append_request_id(&env, request_id);

        env.events()
            .publish((symbol_short!("requested"), request_id), buyer);

        request_id
    }

    /// Return a request by id.
    pub fn get_request(env: Env, request_id: u64) -> MarketRequest {
        Self::get_request_internal(&env, request_id)
    }

    /// Return all request ids.
    pub fn list_requests(env: Env) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::AllRequests)
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

    fn next_request_id(env: &Env) -> u64 {
        let id: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::NextRequestId)
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::NextRequestId, &(id + 1));
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

    fn append_request_id(env: &Env, id: u64) {
        let mut ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::AllRequests)
            .unwrap_or(vec![env]);
        ids.push_back(id);
        env.storage()
            .persistent()
            .set(&DataKey::AllRequests, &ids);
    }

    fn get_listing_internal(env: &Env, id: u64) -> Listing {
        env.storage()
            .persistent()
            .get(&DataKey::Listing(id))
            .expect("listing not found")
    }

    fn get_request_internal(env: &Env, id: u64) -> MarketRequest {
        env.storage()
            .persistent()
            .get(&DataKey::Request(id))
            .expect("request not found")
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use escrow::EscrowContract;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{token::StellarAssetClient, token, Bytes, Env, String};

    fn setup_token(env: &Env, admin: &Address) -> Address {
        let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token_addr = token_contract.address();
        StellarAssetClient::new(env, &token_addr).mint(admin, &10_000_000);
        token_addr
    }

    fn setup(env: &Env) -> (Address, Address, Address, Address, Address) {
        env.mock_all_auths();
        let marketplace_id = env.register_contract(None, MarketplaceContract);
        let escrow_id = env.register_contract(None, EscrowContract);
        let owner = Address::generate(env);
        let buyer = Address::generate(env);
        let token_addr = setup_token(env, &buyer);

        // wire the escrow contract into the marketplace
        let mp_client = MarketplaceContractClient::new(env, &marketplace_id);
        mp_client.initialize(&escrow_id);

        (marketplace_id, escrow_id, owner, buyer, token_addr)
    }

    // ── a. Register a listing ────────────────────────────────────────────────

    #[test]
    fn test_register_and_get_listing() {
        let env = Env::default();
        let (contract_id, _escrow_id, owner, _buyer, token_addr) = setup(&env);
        let client = MarketplaceContractClient::new(&env, &contract_id);

        let name = String::from_str(&env, "sentiment-v1");
        let asset = Bytes::from_slice(&env, b"XLM");
        let endpoint = Bytes::from_slice(&env, b"https://example.com/infer");

        let id = client.register_listing(&owner, &name, &asset, &token_addr, &500, &endpoint);
        let listing = client.get_listing(&id);

        assert_eq!(listing.id, id);
        assert_eq!(listing.price_per_call, 500);
        assert!(listing.active);
    }

    // ── b. list_all returns correct count ────────────────────────────────────

    #[test]
    fn test_list_all_returns_ids() {
        let env = Env::default();
        let (contract_id, _escrow_id, owner, _buyer, token_addr) = setup(&env);
        let client = MarketplaceContractClient::new(&env, &contract_id);

        let name = String::from_str(&env, "svc-a");
        let asset = Bytes::from_slice(&env, b"XLM");
        let ep = Bytes::from_slice(&env, b"https://a.example.com");

        client.register_listing(&owner, &name, &asset, &token_addr, &100, &ep);
        client.register_listing(&owner, &name, &asset, &token_addr, &200, &ep);

        let ids = client.list_all();
        assert_eq!(ids.len(), 2);
    }

    // ── c. Deactivate a listing ──────────────────────────────────────────────

    #[test]
    fn test_deactivate_listing() {
        let env = Env::default();
        let (contract_id, _escrow_id, owner, _buyer, token_addr) = setup(&env);
        let client = MarketplaceContractClient::new(&env, &contract_id);

        let name = String::from_str(&env, "svc-b");
        let asset = Bytes::from_slice(&env, b"USDC");
        let ep = Bytes::from_slice(&env, b"https://b.example.com");

        let id = client.register_listing(&owner, &name, &asset, &token_addr, &300, &ep);
        client.deactivate_listing(&owner, &id);

        let listing = client.get_listing(&id);
        assert!(!listing.active);
    }

    // ── d. create_request locks escrow and returns request ───────────────────

    #[test]
    fn test_create_request_locks_escrow() {
        let env = Env::default();
        let (contract_id, escrow_id, owner, buyer, token_addr) = setup(&env);
        let client = MarketplaceContractClient::new(&env, &contract_id);

        let name = String::from_str(&env, "api-v1");
        let asset = Bytes::from_slice(&env, b"XLM");
        let ep = Bytes::from_slice(&env, b"https://api.example.com");

        let listing_id = client.register_listing(&owner, &name, &asset, &token_addr, &500_000, &ep);

        let request_id = client.create_request(&buyer, &listing_id, &9999);
        let request = client.get_request(&request_id);

        assert_eq!(request.listing_id, listing_id);
        assert_eq!(request.buyer, buyer);
        assert_eq!(request.amount, 500_000);
        assert_eq!(request.status, RequestStatus::Locked);

        // Verify funds moved into escrow contract
        let token_client = token::Client::new(&env, &token_addr);
        assert_eq!(token_client.balance(&escrow_id), 500_000);
    }

    // ── e. create_request panics on inactive listing ──────────────────────────

    #[test]
    #[should_panic(expected = "listing is not active")]
    fn test_create_request_inactive_listing_panics() {
        let env = Env::default();
        let (contract_id, _escrow_id, owner, buyer, token_addr) = setup(&env);
        let client = MarketplaceContractClient::new(&env, &contract_id);

        let name = String::from_str(&env, "dead-svc");
        let asset = Bytes::from_slice(&env, b"XLM");
        let ep = Bytes::from_slice(&env, b"https://dead.example.com");

        let listing_id = client.register_listing(&owner, &name, &asset, &token_addr, &100, &ep);
        client.deactivate_listing(&owner, &listing_id);

        // Should panic — listing is inactive
        client.create_request(&buyer, &listing_id, &9999);
    }

    // ── f. Multiple requests get sequential IDs ──────────────────────────────

    #[test]
    fn test_multiple_requests_sequential_ids() {
        let env = Env::default();
        let (contract_id, _escrow_id, owner, buyer, token_addr) = setup(&env);
        let client = MarketplaceContractClient::new(&env, &contract_id);

        let name = String::from_str(&env, "svc-multi");
        let asset = Bytes::from_slice(&env, b"XLM");
        let ep = Bytes::from_slice(&env, b"https://multi.example.com");

        let listing_id = client.register_listing(&owner, &name, &asset, &token_addr, &100_000, &ep);

        let id0 = client.create_request(&buyer, &listing_id, &9999);
        let id1 = client.create_request(&buyer, &listing_id, &9999);

        assert_eq!(id0, 0);
        assert_eq!(id1, 1);
    }

    // ── g. deactivate_listing panics for non-owner ───────────────────────────

    #[test]
    #[should_panic(expected = "not listing owner")]
    fn test_deactivate_wrong_owner_panics() {
        let env = Env::default();
        let (contract_id, _escrow_id, owner, buyer, token_addr) = setup(&env);
        let client = MarketplaceContractClient::new(&env, &contract_id);

        let name = String::from_str(&env, "svc-c");
        let asset = Bytes::from_slice(&env, b"XLM");
        let ep = Bytes::from_slice(&env, b"https://c.example.com");

        let id = client.register_listing(&owner, &name, &asset, &token_addr, &100, &ep);
        // buyer is not the owner — should panic
        client.deactivate_listing(&buyer, &id);
    }
}
