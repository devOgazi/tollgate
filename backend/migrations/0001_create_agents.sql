-- Migration 0001: agents table
--
-- Stores identity records for agents registered with Tollgate.
-- An agent is identified by its Stellar public key (Soroban Address).

CREATE TABLE IF NOT EXISTS agents (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Stellar/Soroban public key (G... address), unique per agent
    stellar_pubkey TEXT        NOT NULL UNIQUE,
    -- Optional human-readable label set by the grantor
    label         TEXT,
    -- API key hash (SHA-256 hex) used for off-chain auth; raw key never stored
    api_key_hash  TEXT,
    -- Timestamp of first registration
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast lookup by API key hash (used on every authenticated request)
CREATE INDEX IF NOT EXISTS agents_api_key_hash_idx ON agents (api_key_hash);
