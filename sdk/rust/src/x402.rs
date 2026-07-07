use reqwest::Client;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone)]
pub struct X402FetchOptions {
    pub wallet_secret: String,
    pub backend_url: Option<String>,
}

pub async fn x402_fetch(url: String, opts: X402FetchOptions) -> Result<reqwest::Response, String> {
    let client = Client::new();
    let mut response = client.get(&url).send().await.map_err(|e| e.to_string())?;

    if response.status().as_u16() == 402 {
        let payment_info: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
        let amount = payment_info.get("amount").unwrap().as_str().unwrap();
        let asset = payment_info.get("asset").unwrap().as_str().unwrap();
        let amount_stroops = (amount.parse::<f64>().unwrap() * 10_000_000.0) as i64;

        let backend_url = opts.backend_url.unwrap_or_else(|| "http://localhost:4000".to_string());
        let verify_response = client.get(format!("{}/api/v1/facilitator/verify?txHash=mock&amount={}&asset={}", backend_url, amount_stroops, asset))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !verify_response.status().is_success() {
            return Err("Payment verification failed".to_string());
        }

        response = client.get(&url).send().await.map_err(|e| e.to_string())?;
    }

    Ok(response)
}
