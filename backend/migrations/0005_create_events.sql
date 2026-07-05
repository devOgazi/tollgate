-- Migration 0005: events table
--
-- Stores normalized Soroban contract events consumed by the indexer service.
-- The indexer polls/streams all four contracts and writes one row per event,
-- powering the "Agent activity feed" described in the README's Frontend section.

CREATE TABLE IF NOT EXISTS events (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Which contract emitted this event
    contract_id     TEXT        NOT NULL,

    -- Short symbolic name matching the event's first topic, e.g. "locked",
    -- "released", "refunded", "listed", "delisted", "requested",
    -- "success", "failure", "created", "spent", "revoked"
    event_type      TEXT        NOT NULL,

    -- Ledger sequence number and timestamp (Unix seconds) of the ledger
    -- that included this event
    ledger          BIGINT      NOT NULL,
    ledger_at       TIMESTAMPTZ NOT NULL,

    -- Raw topics and body as JSON for forward-compatibility
    topics          JSONB       NOT NULL DEFAULT '[]',
    body            JSONB,

    -- Denormalised fields for fast dashboard queries
    -- The subject address (buyer, seller, agent, etc.) extracted from the event
    subject         TEXT,

    -- For escrow events: the escrow/request ID involved
    ref_id          BIGINT,

    -- Whether this event has been processed by downstream consumers
    -- (e.g. reputation updater, dashboard feed broadcaster)
    processed       BOOLEAN     NOT NULL DEFAULT false,

    -- Soroban event ID (contract_id + ledger + index) for idempotent inserts
    soroban_event_id TEXT       UNIQUE,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Queries: filter by contract or event type for the activity feed
CREATE INDEX IF NOT EXISTS events_contract_id_idx  ON events (contract_id);
CREATE INDEX IF NOT EXISTS events_event_type_idx   ON events (event_type);
CREATE INDEX IF NOT EXISTS events_subject_idx      ON events (subject);
CREATE INDEX IF NOT EXISTS events_ledger_idx       ON events (ledger);
CREATE INDEX IF NOT EXISTS events_processed_idx    ON events (processed) WHERE NOT processed;
