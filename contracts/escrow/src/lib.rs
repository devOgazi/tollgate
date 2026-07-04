//! Escrow — locks funds on a marketplace request, releases on verified
//! delivery, and refunds on timeout or failure.
//!
//! Responsibilities (from README):
//!   - Lock funds on request
//!   - Release on verified delivery
//!   - Refund on timeout / failure

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, token, Address, Env};

// ── Storage keys ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Escrow(u64),
    NextId,
}

// ── Data types ────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum EscrowStatus {
    Locked,
    Released,
    Refunded,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct EscrowRecord {
    pub id: u64,
    pub buyer: Address,
    pub seller: Address,
    pub token: Address,
    pub amount: i128,
    /// Ledger timestamp after which the buyer may reclaim funds.
    pub timeout: u64,
    pub status: EscrowStatus,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    /// Lock `amount` of `token` from `buyer` into the contract.
    /// Returns the new escrow id.
    pub fn lock(
        env: Env,
        buyer: Address,
        seller: Address,
        token_addr: Address,
        amount: i128,
        timeout: u64,
    ) -> u64 {
        buyer.require_auth();

        let id = Self::next_id(&env);

        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&buyer, &env.current_contract_address(), &amount);

        let record = EscrowRecord {
            id,
            buyer: buyer.clone(),
            seller,
            token: token_addr,
            amount,
            timeout,
            status: EscrowStatus::Locked,
        };

        env.storage().persistent().set(&DataKey::Escrow(id), &record);
        env.events().publish((symbol_short!("locked"), id), buyer);

        id
    }

    /// Release escrowed funds to the seller upon verified delivery.
    /// Only the buyer confirms delivery.
    pub fn release(env: Env, buyer: Address, escrow_id: u64) {
        buyer.require_auth();

        let mut record = Self::get_record(&env, escrow_id);
        assert_eq!(record.buyer, buyer, "only buyer may release");
        assert_eq!(record.status, EscrowStatus::Locked, "escrow not locked");

        let token_client = token::Client::new(&env, &record.token);
        token_client.transfer(
            &env.current_contract_address(),
            &record.seller,
            &record.amount,
        );

        record.status = EscrowStatus::Released;
        env.storage()
            .persistent()
            .set(&DataKey::Escrow(escrow_id), &record);

        env.events()
            .publish((symbol_short!("released"), escrow_id), record.seller);
    }

    /// Refund escrowed funds to the buyer after the timeout has passed.
    pub fn refund(env: Env, buyer: Address, escrow_id: u64) {
        buyer.require_auth();

        let mut record = Self::get_record(&env, escrow_id);
        assert_eq!(record.buyer, buyer, "only buyer may refund");
        assert_eq!(record.status, EscrowStatus::Locked, "escrow not locked");
        assert!(
            env.ledger().timestamp() >= record.timeout,
            "timeout not reached"
        );

        let token_client = token::Client::new(&env, &record.token);
        token_client.transfer(
            &env.current_contract_address(),
            &record.buyer,
            &record.amount,
        );

        record.status = EscrowStatus::Refunded;
        env.storage()
            .persistent()
            .set(&DataKey::Escrow(escrow_id), &record);

        env.events()
            .publish((symbol_short!("refunded"), escrow_id), record.buyer);
    }

    /// Return the escrow record for the given id.
    pub fn get_escrow(env: Env, escrow_id: u64) -> EscrowRecord {
        Self::get_record(&env, escrow_id)
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    fn next_id(env: &Env) -> u64 {
        let id: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::NextId)
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::NextId, &(id + 1));
        id
    }

    fn get_record(env: &Env, id: u64) -> EscrowRecord {
        env.storage()
            .persistent()
            .get(&DataKey::Escrow(id))
            .expect("escrow not found")
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::{token::StellarAssetClient, Env};

    /// Register a Stellar asset contract, mint `10_000_000` units to `admin`,
    /// and return the token address.
    fn setup_token(env: &Env, admin: &Address) -> Address {
        let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token_addr = token_contract.address();
        StellarAssetClient::new(env, &token_addr).mint(admin, &10_000_000);
        token_addr
    }

    // ── a. Happy path: lock creates a record ─────────────────────────────────

    #[test]
    fn test_lock_creates_record() {
        let env = Env::default();
        env.mock_all_auths();

        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let token_addr = setup_token(&env, &buyer);

        let contract_id = env.register_contract(None, EscrowContract);
        let client = EscrowContractClient::new(&env, &contract_id);

        let escrow_id = client.lock(&buyer, &seller, &token_addr, &500_000, &9999);
        let record = client.get_escrow(&escrow_id);

        assert_eq!(record.id, escrow_id);
        assert_eq!(record.buyer, buyer);
        assert_eq!(record.seller, seller);
        assert_eq!(record.token, token_addr);
        assert_eq!(record.amount, 500_000);
        assert_eq!(record.timeout, 9999);
        assert_eq!(record.status, EscrowStatus::Locked);
    }

    // ── b. Happy path: release transfers funds to seller ─────────────────────

    #[test]
    fn test_release_transfers_to_seller() {
        let env = Env::default();
        env.mock_all_auths();

        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let token_addr = setup_token(&env, &buyer);

        let contract_id = env.register_contract(None, EscrowContract);
        let client = EscrowContractClient::new(&env, &contract_id);

        let escrow_id = client.lock(&buyer, &seller, &token_addr, &500_000, &9999);

        // Verify funds moved to the contract on lock.
        let token_client = token::Client::new(&env, &token_addr);
        assert_eq!(token_client.balance(&contract_id), 500_000);
        assert_eq!(token_client.balance(&seller), 0);

        client.release(&buyer, &escrow_id);

        // After release the seller should hold the funds.
        assert_eq!(token_client.balance(&contract_id), 0);
        assert_eq!(token_client.balance(&seller), 500_000);

        let record = client.get_escrow(&escrow_id);
        assert_eq!(record.status, EscrowStatus::Released);
    }

    // ── c. Happy path: refund after timeout ───────────────────────────────────

    #[test]
    fn test_refund_after_timeout() {
        let env = Env::default();
        env.mock_all_auths();

        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let token_addr = setup_token(&env, &buyer);

        let contract_id = env.register_contract(None, EscrowContract);
        let client = EscrowContractClient::new(&env, &contract_id);

        let escrow_id = client.lock(&buyer, &seller, &token_addr, &500_000, &100);

        // Advance the ledger past the timeout.
        env.ledger().with_mut(|l| {
            l.timestamp = 200;
        });

        let token_client = token::Client::new(&env, &token_addr);
        let buyer_balance_before = token_client.balance(&buyer);

        client.refund(&buyer, &escrow_id);

        // Buyer recovers the locked amount.
        assert_eq!(
            token_client.balance(&buyer),
            buyer_balance_before + 500_000
        );
        assert_eq!(token_client.balance(&contract_id), 0);

        let record = client.get_escrow(&escrow_id);
        assert_eq!(record.status, EscrowStatus::Refunded);
    }

    // ── d. Multiple escrows get sequential IDs ────────────────────────────────

    #[test]
    fn test_sequential_escrow_ids() {
        let env = Env::default();
        env.mock_all_auths();

        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let token_addr = setup_token(&env, &buyer);

        let contract_id = env.register_contract(None, EscrowContract);
        let client = EscrowContractClient::new(&env, &contract_id);

        let id0 = client.lock(&buyer, &seller, &token_addr, &100_000, &9999);
        let id1 = client.lock(&buyer, &seller, &token_addr, &100_000, &9999);
        let id2 = client.lock(&buyer, &seller, &token_addr, &100_000, &9999);

        assert_eq!(id0, 0);
        assert_eq!(id1, id0 + 1);
        assert_eq!(id2, id1 + 1);
    }

    // ── e. Release panics if called by someone other than buyer ───────────────

    #[test]
    #[should_panic]
    fn test_release_wrong_buyer_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let impostor = Address::generate(&env);
        let token_addr = setup_token(&env, &buyer);

        let contract_id = env.register_contract(None, EscrowContract);
        let client = EscrowContractClient::new(&env, &contract_id);

        let escrow_id = client.lock(&buyer, &seller, &token_addr, &500_000, &9999);

        // Should panic: impostor is not the buyer recorded in the escrow.
        client.release(&impostor, &escrow_id);
    }

    // ── f. Refund panics if timeout not reached yet ───────────────────────────

    #[test]
    #[should_panic]
    fn test_refund_before_timeout_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let token_addr = setup_token(&env, &buyer);

        let contract_id = env.register_contract(None, EscrowContract);
        let client = EscrowContractClient::new(&env, &contract_id);

        // Timeout is far in the future; ledger timestamp starts at 0.
        let escrow_id = client.lock(&buyer, &seller, &token_addr, &500_000, &9999);

        // Do NOT advance the ledger — timestamp (0) < timeout (9999).
        // Should panic: "timeout not reached".
        client.refund(&buyer, &escrow_id);
    }

    // ── g. Release panics if status is already Released ───────────────────────

    #[test]
    #[should_panic]
    fn test_release_already_released_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let token_addr = setup_token(&env, &buyer);

        let contract_id = env.register_contract(None, EscrowContract);
        let client = EscrowContractClient::new(&env, &contract_id);

        let escrow_id = client.lock(&buyer, &seller, &token_addr, &500_000, &9999);
        client.release(&buyer, &escrow_id);

        // Second release should panic: status is Released, not Locked.
        client.release(&buyer, &escrow_id);
    }

    // ── h. Refund panics if status is already Refunded ────────────────────────

    #[test]
    #[should_panic]
    fn test_refund_already_refunded_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let token_addr = setup_token(&env, &buyer);

        let contract_id = env.register_contract(None, EscrowContract);
        let client = EscrowContractClient::new(&env, &contract_id);

        // Use a timeout of 0 so the first refund succeeds immediately.
        let escrow_id = client.lock(&buyer, &seller, &token_addr, &500_000, &0);
        client.refund(&buyer, &escrow_id);

        // Second refund should panic: status is Refunded, not Locked.
        client.refund(&buyer, &escrow_id);
    }

    // ── i. Two independent escrows — release one, refund the other ────────────

    #[test]
    fn test_multiple_escrows_independent() {
        let env = Env::default();
        env.mock_all_auths();

        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        let token_addr = setup_token(&env, &buyer);

        let contract_id = env.register_contract(None, EscrowContract);
        let client = EscrowContractClient::new(&env, &contract_id);

        // Lock two separate escrows with different timeouts.
        let id_a = client.lock(&buyer, &seller, &token_addr, &200_000, &9999);
        let id_b = client.lock(&buyer, &seller, &token_addr, &300_000, &50);

        // Both should start as Locked.
        assert_eq!(client.get_escrow(&id_a).status, EscrowStatus::Locked);
        assert_eq!(client.get_escrow(&id_b).status, EscrowStatus::Locked);

        // Release escrow A (buyer confirms delivery).
        client.release(&buyer, &id_a);

        // Advance ledger past escrow B's timeout, then refund it.
        env.ledger().with_mut(|l| {
            l.timestamp = 100;
        });
        client.refund(&buyer, &id_b);

        // Verify independent final states.
        let record_a = client.get_escrow(&id_a);
        let record_b = client.get_escrow(&id_b);

        assert_eq!(record_a.status, EscrowStatus::Released);
        assert_eq!(record_b.status, EscrowStatus::Refunded);

        // Verify correct amounts were transferred.
        let token_client = token::Client::new(&env, &token_addr);
        assert_eq!(token_client.balance(&contract_id), 0);
        assert_eq!(token_client.balance(&seller), 200_000); // from escrow A
        // buyer got back 300_000 from escrow B (plus kept 10_000_000 - 500_000 = 9_500_000)
        assert_eq!(token_client.balance(&buyer), 10_000_000 - 200_000 - 300_000 + 300_000);
    }
}
