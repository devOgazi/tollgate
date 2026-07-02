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

    fn setup_token(env: &Env, admin: &Address) -> Address {
        let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token_addr = token_contract.address();
        StellarAssetClient::new(env, &token_addr).mint(admin, &10_000_000);
        token_addr
    }

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

        assert_eq!(record.amount, 500_000);
        assert_eq!(record.status, EscrowStatus::Locked);
    }

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
        client.release(&buyer, &escrow_id);

        let record = client.get_escrow(&escrow_id);
        assert_eq!(record.status, EscrowStatus::Released);
    }

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

        env.ledger().with_mut(|l| {
            l.timestamp = 200;
        });

        client.refund(&buyer, &escrow_id);

        let record = client.get_escrow(&escrow_id);
        assert_eq!(record.status, EscrowStatus::Refunded);
    }

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
        assert_eq!(id1, id0 + 1);
    }
}
