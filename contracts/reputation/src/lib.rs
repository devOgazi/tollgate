//! Reputation — tracks fulfillment success/failure per agent/service for
//! trust scoring.
//!
//! Responsibilities (from README):
//!   - Track fulfillment success/failure per agent/service
//!   - Trust scoring

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env};

// ── Storage keys ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Score(Address),
}

// ── Data types ────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ReputationScore {
    pub subject: Address,
    pub successes: u64,
    pub failures: u64,
}

impl ReputationScore {
    /// Integer trust score in basis points [0, 10_000].
    /// Returns 0 when there are no recorded interactions.
    pub fn score_bps(&self) -> u64 {
        let total = self.successes + self.failures;
        if total == 0 {
            return 0;
        }
        self.successes * 10_000 / total
    }
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct ReputationContract;

#[contractimpl]
impl ReputationContract {
    /// Record a successful fulfillment for `subject`.
    pub fn record_success(env: Env, subject: Address) {
        let mut score = Self::get_or_default(&env, &subject);
        score.successes += 1;
        env.storage()
            .persistent()
            .set(&DataKey::Score(subject.clone()), &score);
        env.events()
            .publish((symbol_short!("success"), subject), score.successes);
    }

    /// Record a failed fulfillment for `subject`.
    pub fn record_failure(env: Env, subject: Address) {
        let mut score = Self::get_or_default(&env, &subject);
        score.failures += 1;
        env.storage()
            .persistent()
            .set(&DataKey::Score(subject.clone()), &score);
        env.events()
            .publish((symbol_short!("failure"), subject), score.failures);
    }

    /// Return the reputation record for `subject`.
    pub fn get_score(env: Env, subject: Address) -> ReputationScore {
        Self::get_or_default(&env, &subject)
    }

    /// Return the trust score in basis points [0, 10_000].
    pub fn trust_score_bps(env: Env, subject: Address) -> u64 {
        Self::get_or_default(&env, &subject).score_bps()
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    fn get_or_default(env: &Env, subject: &Address) -> ReputationScore {
        env.storage()
            .persistent()
            .get(&DataKey::Score(subject.clone()))
            .unwrap_or(ReputationScore {
                subject: subject.clone(),
                successes: 0,
                failures: 0,
            })
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Env;

    #[test]
    fn test_initial_score_is_zero() {
        let env = Env::default();
        env.mock_all_auths();
        let subject = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        let bps = client.trust_score_bps(&subject);
        assert_eq!(bps, 0);
    }

    #[test]
    fn test_all_successes_gives_full_score() {
        let env = Env::default();
        env.mock_all_auths();
        let subject = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        client.record_success(&subject);
        client.record_success(&subject);
        client.record_success(&subject);

        assert_eq!(client.trust_score_bps(&subject), 10_000);
    }

    #[test]
    fn test_mixed_score() {
        let env = Env::default();
        env.mock_all_auths();
        let subject = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        // 3 successes, 1 failure → 75 %  = 7500 bps
        client.record_success(&subject);
        client.record_success(&subject);
        client.record_success(&subject);
        client.record_failure(&subject);

        assert_eq!(client.trust_score_bps(&subject), 7500);
    }

    #[test]
    fn test_get_score_fields() {
        let env = Env::default();
        env.mock_all_auths();
        let subject = Address::generate(&env);
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        client.record_success(&subject);
        client.record_failure(&subject);

        let score = client.get_score(&subject);
        assert_eq!(score.successes, 1);
        assert_eq!(score.failures, 1);
    }
}
