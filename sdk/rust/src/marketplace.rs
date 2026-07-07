use serde::{Deserialize, Serialize};
use reqwest::Client;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListingParams {
    pub name: String,
    pub price_asset: String,
    pub price_per_call: String,
    pub endpoint: String,
    pub schema: std::collections::HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Listing {
    pub id: String,
    pub name: String,
    pub price_asset: String,
    pub price_per_call: String,
    pub endpoint: String,
    pub schema: std::collections::HashMap<String, String>,
    pub active: bool,
    pub seller_pubkey: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct MarketplaceOptions {
    pub backend_url: Option<String>,
}

pub struct Marketplace {
    backend_url: String,
    client: Client,
}

impl Marketplace {
    pub fn new(opts: MarketplaceOptions) -> Self {
        Marketplace {
            backend_url: opts.backend_url.unwrap_or_else(|| "http://localhost:4000".to_string()),
            client: Client::new(),
        }
    }

    pub async fn register_listing(&self, params: ListingParams, seller_pubkey: String) -> Result<Listing, String> {
        let price_per_call_stroops = (params.price_per_call.parse::<f64>().unwrap() * 10_000_000.0) as i64;

        let request_body = serde_json::json!({
            "name": params.name,
            "sellerPubkey": seller_pubkey,
            "endpoint": params.endpoint,
            "pricePerCall": price_per_call_stroops,
            "asset": params.price_asset,
            "schema": params.schema,
        });

        let response = self.client
            .post(format!("{}/api/v1/marketplace/listings", self.backend_url))
            .json(&request_body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(error_text);
        }

        let data: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
        let listing = data.get("listing").ok_or("listing not found in response")?;

        Ok(Listing {
            id: listing.get("id").unwrap().as_str().unwrap().to_string(),
            name: listing.get("name").unwrap().as_str().unwrap().to_string(),
            price_asset: listing.get("asset").unwrap().as_str().unwrap().to_string(),
            price_per_call: (listing.get("pricePerCall").unwrap().as_i64().unwrap() as f64 / 10_000_000.0).to_string(),
            endpoint: listing.get("endpoint").unwrap().as_str().unwrap().to_string(),
            schema: serde_json::from_value(listing.get("schema").unwrap().clone()).unwrap(),
            active: listing.get("active").unwrap().as_bool().unwrap(),
            seller_pubkey: listing.get("sellerPubkey").unwrap().as_str().unwrap().to_string(),
            created_at: listing.get("createdAt").unwrap().as_str().unwrap().to_string(),
            updated_at: listing.get("updatedAt").unwrap().as_str().unwrap().to_string(),
        })
    }
}
