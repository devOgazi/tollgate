-- Migration 0004: requests table
--
-- Tracks marketplace paid requests initiated via POST /api/v1/marketplace/requests.
-- Each row corresponds to one buyer→seller interaction backed by an on-chain escrow.

CREATE TABLE IF NOT EXISTS requests (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- FK to the listing being called
    listing_id      UUID        NOT NULL REFERENCES listings(id),
    -- Buyer's Stellar public key
    buyer_pubkey    TEXT        NOT NULL,
    -- Amount locked in escrow (must equal listing.price_per_call at time of request)
    amount          BIGINT      NOT NULL CHECK (amount > 0),
    asset           TEXT        NOT NULL DEFAULT 'XLM',
    -- On-chain escrow ID returned by Escrow::lock()
    escrow_id       BIGINT,
    -- Stellar transaction hash of the Escrow::lock() call
    lock_tx_hash    TEXT,
    -- Current lifecycle state of the request
    status          TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'locked', 'fulfilled', 'refunded', 'failed')),
    -- Stellar transaction hash of the Escrow::release() or Escrow::refund() call
    settle_tx_hash  TEXT,
    -- Unix timestamp after which the buyer may call refund (mirrors Escrow::timeout)
    timeout_at      BIGINT,
    -- Arbitrary metadata the seller may attach (e.g. result summary)
    result_meta     JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS requests_buyer_idx      ON requests (buyer_pubkey);
CREATE INDEX IF NOT EXISTS requests_listing_idx    ON requests (listing_id);
CREATE INDEX IF NOT EXISTS requests_status_idx     ON requests (status);
CREATE INDEX IF NOT EXISTS requests_escrow_id_idx  ON requests (escrow_id);
