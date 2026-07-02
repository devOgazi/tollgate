//! tollgate-sdk — Rust SDK for native/Rust AI agents.
//!
//! Stubs for the core SDK surfaces described in the README.
//! Full implementation comes in a later milestone.

#![no_std]

/// Wallet surfaces — connect to a Soroban wallet and create budget sessions.
pub mod wallet {
    /// Placeholder for a connected wallet handle.
    pub struct TollgateWallet;

    impl TollgateWallet {
        /// Connect to the Tollgate wallet. Full implementation TBD.
        pub fn connect() -> Self {
            TollgateWallet
        }
    }
}

/// Budget policy surfaces — create and query scoped spending allowances.
pub mod budget {
    /// Represents a session-scoped budget granted to an agent.
    pub struct BudgetSession {
        pub max_total: i128,
        pub max_per_call: i128,
        pub window_seconds: u64,
    }

    impl BudgetSession {
        /// Create a new budget session stub.
        pub fn new(max_total: i128, max_per_call: i128, window_seconds: u64) -> Self {
            BudgetSession {
                max_total,
                max_per_call,
                window_seconds,
            }
        }
    }
}

/// x402 payment handshake — handles HTTP 402 responses automatically.
pub mod x402 {
    /// Placeholder for an x402 fetch client.
    pub struct X402Client;

    impl X402Client {
        /// Construct a new x402 client. Full implementation TBD.
        pub fn new() -> Self {
            X402Client
        }
    }

    impl Default for X402Client {
        fn default() -> Self {
            Self::new()
        }
    }
}

/// Marketplace surfaces — register and discover service listings.
pub mod marketplace {
    /// Minimal listing descriptor.
    pub struct ListingParams {
        pub name: &'static str,
        pub price_per_call: i128,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wallet_connects() {
        let _wallet = wallet::TollgateWallet::connect();
    }

    #[test]
    fn test_budget_session_fields() {
        let session = budget::BudgetSession::new(5_000_000, 100_000, 86400);
        assert_eq!(session.max_total, 5_000_000);
        assert_eq!(session.max_per_call, 100_000);
        assert_eq!(session.window_seconds, 86400);
    }

    #[test]
    fn test_x402_client_default() {
        let _client = x402::X402Client::default();
    }
}
