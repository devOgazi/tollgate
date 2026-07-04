//! BudgetPolicy — defines and enforces an agent's spending allowance.
//!
//! Responsibilities (from README):
//!   - max total spend
//!   - max per-call spend
//!   - time window enforcement
//!   - revocation by the grantor

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env};

// ── Storage keys ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Policy(Address),
}

// ── Data types ────────────────────────────────────────────────────────────────

/// On-chain representation of an agent's spending policy.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Policy {
    /// Grantor (developer / user) who created this policy.
    pub grantor: Address,
    /// Agent address this policy governs.
    pub agent: Address,
    /// Maximum total amount the agent may spend (in smallest asset unit).
    pub max_total: i128,
    /// Maximum amount per individual call.
    pub max_per_call: i128,
    /// Ledger timestamp after which the policy expires (0 = no expiry).
    pub window_end: u64,
    /// Cumulative amount spent so far.
    pub spent: i128,
    /// Whether the grantor has revoked this policy.
    pub revoked: bool,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct BudgetPolicyContract;

#[contractimpl]
impl BudgetPolicyContract {
    /// Create or replace a spending policy for `agent`. Only `grantor` may call this.
    pub fn create_policy(
        env: Env,
        grantor: Address,
        agent: Address,
        max_total: i128,
        max_per_call: i128,
        window_end: u64,
    ) {
        grantor.require_auth();

        let policy = Policy {
            grantor: grantor.clone(),
            agent: agent.clone(),
            max_total,
            max_per_call,
            window_end,
            spent: 0,
            revoked: false,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Policy(agent.clone()), &policy);

        env.events()
            .publish((symbol_short!("created"), agent), grantor);
    }

    /// Check whether a proposed spend of `amount` is permitted.
    /// Returns `true` if allowed; does NOT mutate state.
    pub fn check_spend(env: Env, agent: Address, amount: i128) -> bool {
        let policy = Self::get_policy_internal(&env, &agent);

        if policy.revoked {
            return false;
        }
        if policy.window_end > 0 && env.ledger().timestamp() > policy.window_end {
            return false;
        }
        if amount > policy.max_per_call {
            return false;
        }
        policy.spent + amount <= policy.max_total
    }

    /// Record a spend of `amount` against the agent's policy. Panics if the
    /// spend would violate the policy.
    pub fn record_spend(env: Env, agent: Address, amount: i128) {
        let mut policy = Self::get_policy_internal(&env, &agent);

        assert!(!policy.revoked, "policy revoked");
        assert!(
            policy.window_end == 0 || env.ledger().timestamp() <= policy.window_end,
            "policy expired"
        );
        assert!(amount <= policy.max_per_call, "exceeds per-call cap");
        assert!(
            policy.spent + amount <= policy.max_total,
            "exceeds total budget"
        );

        policy.spent += amount;
        env.storage()
            .persistent()
            .set(&DataKey::Policy(agent.clone()), &policy);

        env.events()
            .publish((symbol_short!("spent"), agent), amount);
    }

    /// Revoke a policy immediately. Only the grantor may call this.
    pub fn revoke(env: Env, grantor: Address, agent: Address) {
        grantor.require_auth();

        let mut policy = Self::get_policy_internal(&env, &agent);
        assert!(policy.grantor == grantor, "not grantor");

        policy.revoked = true;
        env.storage()
            .persistent()
            .set(&DataKey::Policy(agent.clone()), &policy);

        env.events()
            .publish((symbol_short!("revoked"), agent), grantor);
    }

    /// Return the current policy for an agent.
    pub fn get_policy(env: Env, agent: Address) -> Policy {
        Self::get_policy_internal(&env, &agent)
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    fn get_policy_internal(env: &Env, agent: &Address) -> Policy {
        env.storage()
            .persistent()
            .get(&DataKey::Policy(agent.clone()))
            .expect("no policy found for agent")
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::Env;

    fn setup() -> (Env, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, BudgetPolicyContract);
        let grantor = Address::generate(&env);
        let agent = Address::generate(&env);
        (env, contract_id, grantor, agent)
    }

    // ── Existing tests ────────────────────────────────────────────────────────

    #[test]
    fn test_create_and_read_policy() {
        let (env, contract_id, grantor, agent) = setup();
        let client = BudgetPolicyContractClient::new(&env, &contract_id);

        client.create_policy(&grantor, &agent, &1_000_000, &100_000, &0);

        let policy = client.get_policy(&agent);
        assert_eq!(policy.max_total, 1_000_000);
        assert_eq!(policy.max_per_call, 100_000);
        assert_eq!(policy.spent, 0);
        assert!(!policy.revoked);
    }

    #[test]
    fn test_check_spend_within_limits() {
        let (env, contract_id, grantor, agent) = setup();
        let client = BudgetPolicyContractClient::new(&env, &contract_id);

        client.create_policy(&grantor, &agent, &1_000_000, &100_000, &0);

        assert!(client.check_spend(&agent, &50_000));
    }

    #[test]
    fn test_check_spend_exceeds_per_call() {
        let (env, contract_id, grantor, agent) = setup();
        let client = BudgetPolicyContractClient::new(&env, &contract_id);

        client.create_policy(&grantor, &agent, &1_000_000, &100_000, &0);

        assert!(!client.check_spend(&agent, &200_000));
    }

    #[test]
    fn test_record_spend_accumulates() {
        let (env, contract_id, grantor, agent) = setup();
        let client = BudgetPolicyContractClient::new(&env, &contract_id);

        client.create_policy(&grantor, &agent, &1_000_000, &100_000, &0);
        client.record_spend(&agent, &50_000);
        client.record_spend(&agent, &50_000);

        let policy = client.get_policy(&agent);
        assert_eq!(policy.spent, 100_000);
    }

    #[test]
    fn test_revoke_blocks_spend() {
        let (env, contract_id, grantor, agent) = setup();
        let client = BudgetPolicyContractClient::new(&env, &contract_id);

        client.create_policy(&grantor, &agent, &1_000_000, &100_000, &0);
        client.revoke(&grantor, &agent);

        assert!(!client.check_spend(&agent, &1));
    }

    #[test]
    fn test_expired_policy_blocks_spend() {
        let (env, contract_id, grantor, agent) = setup();
        let client = BudgetPolicyContractClient::new(&env, &contract_id);

        // window_end = 1 (a timestamp in the past once we advance the ledger)
        client.create_policy(&grantor, &agent, &1_000_000, &100_000, &1);

        env.ledger().with_mut(|l| {
            l.timestamp = 1000;
        });

        assert!(!client.check_spend(&agent, &1));
    }

    // ── New tests ─────────────────────────────────────────────────────────────

    /// record_spend should panic when the cumulative spend would exceed max_total.
    #[test]
    #[should_panic(expected = "exceeds total budget")]
    fn test_record_spend_over_total_panics() {
        let (env, contract_id, grantor, agent) = setup();
        let client = BudgetPolicyContractClient::new(&env, &contract_id);

        // max_total = 100, max_per_call = 100 — first spend consumes the whole budget
        client.create_policy(&grantor, &agent, &100, &100, &0);
        client.record_spend(&agent, &100); // ok: spent = 100
        client.record_spend(&agent, &1);  // panics: 100 + 1 > 100
    }

    /// record_spend should panic when amount exceeds the per-call cap.
    #[test]
    #[should_panic(expected = "exceeds per-call cap")]
    fn test_record_spend_over_per_call_panics() {
        let (env, contract_id, grantor, agent) = setup();
        let client = BudgetPolicyContractClient::new(&env, &contract_id);

        // max_per_call = 50, amount = 100 — violates per-call cap
        client.create_policy(&grantor, &agent, &1_000_000, &50, &0);
        client.record_spend(&agent, &100); // panics: 100 > 50
    }

    /// record_spend should panic when the policy has been revoked.
    #[test]
    #[should_panic(expected = "policy revoked")]
    fn test_record_spend_on_revoked_panics() {
        let (env, contract_id, grantor, agent) = setup();
        let client = BudgetPolicyContractClient::new(&env, &contract_id);

        client.create_policy(&grantor, &agent, &1_000_000, &100_000, &0);
        client.revoke(&grantor, &agent);
        client.record_spend(&agent, &1); // panics: policy revoked
    }

    /// record_spend should panic when the policy's time window has expired.
    #[test]
    #[should_panic(expected = "policy expired")]
    fn test_record_spend_on_expired_panics() {
        let (env, contract_id, grantor, agent) = setup();
        let client = BudgetPolicyContractClient::new(&env, &contract_id);

        client.create_policy(&grantor, &agent, &1_000_000, &100_000, &1);

        // Advance ledger past window_end
        env.ledger().with_mut(|l| {
            l.timestamp = 1000;
        });

        client.record_spend(&agent, &1); // panics: policy expired
    }

    /// revoke should panic when called by an address that is not the grantor.
    /// (mock_all_auths bypasses require_auth, so the panic comes from the
    ///  `assert!(policy.grantor == grantor, "not grantor")` check inside revoke.)
    #[test]
    #[should_panic(expected = "not grantor")]
    fn test_revoke_only_by_grantor() {
        let (env, contract_id, grantor, agent) = setup();
        let client = BudgetPolicyContractClient::new(&env, &contract_id);

        // Create the policy with `grantor`
        client.create_policy(&grantor, &agent, &1_000_000, &100_000, &0);

        // A different address tries to revoke — must panic
        let attacker = Address::generate(&env);
        client.revoke(&attacker, &agent); // panics: not grantor
    }

    /// check_spend should return false when the remaining budget is less than
    /// the requested amount (even if the amount itself is within the per-call cap).
    #[test]
    fn test_check_spend_after_total_exhausted() {
        let (env, contract_id, grantor, agent) = setup();
        let client = BudgetPolicyContractClient::new(&env, &contract_id);

        // max_total = 100, max_per_call = 100
        client.create_policy(&grantor, &agent, &100, &100, &0);

        // Consume the entire budget
        client.record_spend(&agent, &100);

        // Any further spend — even 1 unit — should be denied
        assert!(!client.check_spend(&agent, &1));
    }
}
