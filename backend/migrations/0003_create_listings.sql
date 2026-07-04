-- Migration 0003: listings table
--
-- Stores service listings registered via POST /api/v1/marketplace/listings.
-- A listing describes a callable endpoint, its price, and what it provides.

CREATE TABLE IF NOT EXISTS listings (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Human-readable service name, e.g. "sentiment-analysis-v2"
    name            TEXT        NOT NULL,
    -- Seller's Stellar public key
    seller_pubkey   TEXT        NOT NULL,
    -- Publicly reachable endpoint that accepts paid requests
    endpoint        TEXT        NOT NULL,
    -- Price per call in the asset's smallest unit
    price_per_call  BIGINT      NOT NULL CHECK (price_per_call > 0),
    -- Settlement asset, e.g. "XLM" or "USDC:..."
    asset           TEXT        NOT NULL DEFAULT 'XLM',
    -- JSON schema describing the service's input/output contract
    schema          JSONB,
    -- Whether the listing is currently accepting requests
    active          BOOLEAN     NOT NULL DEFAULT true,
    -- On-chain listing ID if registered via Marketplace.rs contract
    on_chain_id     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS listings_seller_idx   ON listings (seller_pubkey);
CREATE INDEX IF NOT EXISTS listings_active_idx   ON listings (active);
CREATE INDEX IF NOT EXISTS listings_name_idx     ON listings (name);
