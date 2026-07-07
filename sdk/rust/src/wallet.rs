use soroban_sdk::{Address, Env, symbol_short, IntoVal, Val, xdr::WriteXdr};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletConnectOptions {
    pub network: String,
    pub root_secret: String,
    pub soroban_rpc_url: Option<String>,
    pub budget_policy_contract_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateBudgetOptions {
    pub asset: String,
    pub max_total: String,
    pub max_per_call: String,
    pub window_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BudgetSession {
    pub session_signer_secret: String,
    pub budget_policy_contract_id: String,
    pub grantor_pubkey: String,
    pub asset: String,
    pub max_total: String,
    pub max_per_call: String,
    pub window_end: u64,
}

pub struct TollgateWallet {
    network: String,
    root_secret: String,
    soroban_rpc_url: String,
    budget_policy_contract_id: Option<String>,
}

impl TollgateWallet {
    pub fn connect(opts: WalletConnectOptions) -> Self {
        let soroban_rpc_url = opts.soroban_rpc_url.unwrap_or_else(|| match opts.network.as_str() {
            "testnet" => "https://soroban-testnet.stellar.org".to_string(),
            "futurenet" => "https://soroban-futurenet.stellar.org".to_string(),
            "mainnet" => "https://soroban.stellar.org".to_string(),
            _ => "https://soroban-testnet.stellar.org".to_string(),
        });

        TollgateWallet {
            network: opts.network,
            root_secret: opts.root_secret,
            soroban_rpc_url,
            budget_policy_contract_id: opts.budget_policy_contract_id,
        }
    }

    pub async fn create_budget(&self, opts: CreateBudgetOptions) -> Result<BudgetSession, String> {
        let budget_policy_contract_id = self.budget_policy_contract_id.as_ref().ok_or("budget_policy_contract_id is required")?;

        // Generate random agent keypair (simplified for now)
        let session_signer_secret = "SA76QYV4VZ6VZ6VZ6VZ6VZ6VZ6VZ6VZ6VZ6VZ6VZ6VZ6VZ6VZ6".to_string();
        let grantor_pubkey = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5".to_string();
        let window_end = (std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()) + opts.window_seconds;

        Ok(BudgetSession {
            session_signer_secret,
            budget_policy_contract_id: budget_policy_contract_id.clone(),
            grantor_pubkey,
            asset: opts.asset,
            max_total: opts.max_total,
            max_per_call: opts.max_per_call,
            window_end,
        })
    }
}
