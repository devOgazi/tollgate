-- Migration 0002: budgets table
--
-- Mirrors the on-chain BudgetPolicy state in Postgres so the backend can answer
-- GET /api/v1/wallets/budgets/:id without a round-trip to Soroban RPC.
-- The canonical source of truth is always the on-chain policy; this table is
-- populated / kept in sync by the indexer.

CREATE TABLE IF NOT EXISTS budgets (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Soroban contract ID of the BudgetPolicy contract instance
    contract_id     TEXT        NOT NULL,
    -- Grantor's Stellar public key
    grantor         TEXT        NOT NULL,
    -- Agent's Stellar public key (FK to agents table, nullable for loose coupling)
    agent_pubkey    TEXT        NOT NULL,
    -- Spending caps in the asset's smallest unit (stroops for XLM, 1e-7 USDC)
    max_total       BIGINT      NOT NULL CHECK (max_total > 0),
    max_per_call    BIGINT      NOT NULL CHECK (max_per_call > 0),
    -- Unix timestamp (seconds) after which the policy expires; 0 = no expiry
    window_end      BIGINT      NOT NULL DEFAULT 0,
    -- Running total debited against this budget (updated by indexer on each spend event)
    spent           BIGINT      NOT NULL DEFAULT 0 CHECK (spent >= 0),
    -- Settlement asset identifier, e.g. "XLM" or "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
    asset           TEXT        NOT NULL DEFAULT 'XLM',
    -- Whether the grantor has revoked this policy on-chain
    revoked         BOOLEAN     NOT NULL DEFAULT false,
    -- Ledger sequence number of the most recent on-chain update (for idempotent indexer writes)
    last_ledger_seq BIGINT      NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lookup by agent + contract (most common query pattern)
CREATE INDEX IF NOT EXISTS budgets_agent_idx       ON budgets (agent_pubkey);
CREATE INDEX IF NOT EXISTS budgets_grantor_idx     ON budgets (grantor);
CREATE INDEX IF NOT EXISTS budgets_contract_id_idx ON budgets (contract_id);
