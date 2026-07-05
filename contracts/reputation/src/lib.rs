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
    /// Unified API: record either a success or failure for `subject`.
    ///
    /// `success = true`  → increments the success counter  
    /// `success = false` → increments the failure counter
    ///
    /// This is the preferred entry-point for the backend's fulfill/refund
    /// handlers so they only need one function signature to call.
    pub fn record_result(env: Env, subject: Address, success: bool) {
        if success {
            Self::record_success(env, subject);
        } else {
            Self::record_failure(env, subject);
        }
    }

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

    fn setup(env: &Env) -> (Address, Address) {
        env.mock_all_auths();
        let contract_id = env.register_contract(None, ReputationContract);
        let subject = Address::generate(env);
        (contract_id, subject)
    }

    // ── a. Initial state ─────────────────────────────────────────────────────

    #[test]
    fn test_initial_score_is_zero() {
        let env = Env::default();
        let (contract_id, subject) = setup(&env);
        let client = ReputationContractClient::new(&env, &contract_id);

        assert_eq!(client.trust_score_bps(&subject), 0);
    }

    #[test]
    fn test_initial_get_score_fields() {
        let env = Env::default();
        let (contract_id, subject) = setup(&env);
        let client = ReputationContractClient::new(&env, &contract_id);

        let score = client.get_score(&subject);
        assert_eq!(score.successes, 0);
        assert_eq!(score.failures, 0);
    }

    // ── b. record_success / record_failure ───────────────────────────────────

    #[test]
    fn test_all_successes_gives_full_score() {
        let env = Env::default();
        let (contract_id, subject) = setup(&env);
        let client = ReputationContractClient::new(&env, &contract_id);

        client.record_success(&subject);
        client.record_success(&subject);
        client.record_success(&subject);

        assert_eq!(client.trust_score_bps(&subject), 10_000);
    }

    #[test]
    fn test_all_failures_gives_zero_score() {
        let env = Env::default();
        let (contract_id, subject) = setup(&env);
        let client = ReputationContractClient::new(&env, &contract_id);

        client.record_failure(&subject);
        client.record_failure(&subject);

        assert_eq!(client.trust_score_bps(&subject), 0);
    }

    #[test]
    fn test_mixed_score() {
        let env = Env::default();
        let (contract_id, subject) = setup(&env);
        let client = ReputationContractClient::new(&env, &contract_id);

        // 3 successes, 1 failure → 75 % = 7500 bps
        client.record_success(&subject);
        client.record_success(&subject);
        client.record_success(&subject);
        client.record_failure(&subject);

        assert_eq!(client.trust_score_bps(&subject), 7_500);
    }

    #[test]
    fn test_get_score_fields() {
        let env = Env::default();
        let (contract_id, subject) = setup(&env);
        let client = ReputationContractClient::new(&env, &contract_id);

        client.record_success(&subject);
        client.record_failure(&subject);

        let score = client.get_score(&subject);
        assert_eq!(score.successes, 1);
        assert_eq!(score.failures, 1);
    }

    // ── c. record_result unified API ─────────────────────────────────────────

    #[test]
    fn test_record_result_true_increments_successes() {
        let env = Env::default();
        let (contract_id, subject) = setup(&env);
        let client = ReputationContractClient::new(&env, &contract_id);

        client.record_result(&subject, &true);
        client.record_result(&subject, &true);

        let score = client.get_score(&subject);
        assert_eq!(score.successes, 2);
        assert_eq!(score.failures, 0);
    }

    #[test]
    fn test_record_result_false_increments_failures() {
        let env = Env::default();
        let (contract_id, subject) = setup(&env);
        let client = ReputationContractClient::new(&env, &contract_id);

        client.record_result(&subject, &false);

        let score = client.get_score(&subject);
        assert_eq!(score.successes, 0);
        assert_eq!(score.failures, 1);
    }

    #[test]
    fn test_record_result_mixed() {
        let env = Env::default();
        let (contract_id, subject) = setup(&env);
        let client = ReputationContractClient::new(&env, &contract_id);

        // 2 successes via unified API, 1 failure via unified API
        client.record_result(&subject, &true);
        client.record_result(&subject, &true);
        client.record_result(&subject, &false);

        // 2/3 ≈ 6666 bps
        assert_eq!(client.trust_score_bps(&subject), 6_666);
    }

    // ── d. Multiple independent subjects ─────────────────────────────────────

    #[test]
    fn test_independent_subjects() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, ReputationContract);
        let client = ReputationContractClient::new(&env, &contract_id);

        let subject_a = Address::generate(&env);
        let subject_b = Address::generate(&env);

        client.record_success(&subject_a);
        client.record_success(&subject_a);
        client.record_failure(&subject_b);

        assert_eq!(client.trust_score_bps(&subject_a), 10_000);
        assert_eq!(client.trust_score_bps(&subject_b), 0);
    }

    // ── e. Score accumulates correctly across many calls ─────────────────────

    #[test]
    fn test_score_accumulates() {
        let env = Env::default();
        let (contract_id, subject) = setup(&env);
        let client = ReputationContractClient::new(&env, &contract_id);

        for _ in 0..10 {
            client.record_success(&subject);
        }
        for _ in 0..5 {
            client.record_failure(&subject);
        }

        let score = client.get_score(&subject);
        assert_eq!(score.successes, 10);
        assert_eq!(score.failures, 5);
        // 10/15 ≈ 6666 bps
        assert_eq!(client.trust_score_bps(&subject), 6_666);
    }
}
