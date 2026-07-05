# x402 ↔ Soroban Mapping

This document describes how each step of the x402 payment handshake maps to a
specific Soroban contract call in Tollgate.

---

## Deposit / Lock

**x402 step:** The agent SDK receives an `HTTP 402 Payment Required` response from
a protected service.  The response body contains payment terms:

```json
{
  "amount": "500000",
  "asset": "XLM",
  "destination": "G...",
  "escrowContractId": "C...",
  "timeout": 1720000000
}
```

**Soroban contract call:** `Escrow::lock`

```rust
pub fn lock(
    env: Env,
    buyer: Address,       // agent's Soroban address (derived from session key)
    seller: Address,      // destination from the 402 terms
    token_addr: Address,  // token contract address matching `asset`
    amount: i128,         // amount from the 402 terms, in smallest unit
    timeout: u64,         // Unix timestamp from the 402 terms
) -> u64                  // escrow_id; agent SDK stores this for later release/refund
```

**Pre-flight check:** Before constructing the Soroban transaction, the SDK calls
`BudgetPolicy::check_spend` to enforce the on-chain spending cap:

```rust
pub fn check_spend(
    env: Env,
    agent: Address,  // the agent's address
    amount: i128,    // proposed spend — must be ≤ max_per_call and fit within remaining max_total
) -> bool
```

If `check_spend` returns `false`, the SDK rejects the request locally and returns
an error to the agent runtime — no transaction is submitted.

If `check_spend` returns `true`, the SDK submits the `Escrow::lock` transaction.
On success it calls `BudgetPolicy::record_spend` to debit the amount:

```rust
pub fn record_spend(
    env: Env,
    agent: Address,
    amount: i128,
)
```

`record_spend` panics (and the transaction is rolled back) if any policy constraint
would be violated — providing a hard on-chain enforcement layer that cannot be
bypassed even if the SDK is compromised.

**Result:** Funds move from the buyer's token balance to the Escrow contract.
The escrow record is stored on-chain with status `Locked`.  The `escrow_id`
returned by `lock` is included in the agent's next request to the service as
proof of payment.

**Marketplace routing:** For marketplace-listed services, `Escrow::lock` is
called automatically via a cross-contract call inside `Marketplace::create_request`:

```rust
pub fn create_request(
    env: Env,
    buyer: Address,    // agent making the request; must have pre-approved the token transfer
    listing_id: u64,   // on-chain listing registered via Marketplace::register_listing
    timeout: u64,      // Unix timestamp for the escrow expiry
) -> u64               // marketplace request id
```

`create_request` looks up the listing's `token_addr` and `price_per_call`, then
calls `Escrow::lock` internally.  It returns the marketplace request ID; the
underlying escrow ID is stored in the `MarketRequest` record.

---

## Verify

**x402 step:** The protected service (or its backend facilitator) receives the
agent's request with an `X-Payment` or equivalent header containing the
Stellar transaction hash of the `Escrow::lock` call.

**Backend endpoint:** `GET /api/v1/facilitator/verify`

```
GET /api/v1/facilitator/verify?txHash=<64-char-hex>[&amount=<int>][&asset=<str>]
```

**Implementation** (`backend/src/facilitator/verify.ts`):

1. Validates the `txHash` query parameter (must be a 64-character hex string).
2. Concurrently queries:
   - **Horizon REST API** (`GET /transactions/{txHash}`) — confirms the
     transaction exists and `successful === true`.
   - **Soroban RPC** (`getTransaction` JSON-RPC method) — confirms
     `status === "SUCCESS"` and retrieves the raw `resultMetaXdr` for
     future XDR-level amount/contract verification.
3. Returns a `VerifyResult` JSON object:

```typescript
interface VerifyResult {
  valid: boolean;                                      // true only on SUCCESS
  txHash: string;
  status: "SUCCESS" | "FAILED" | "NOT_FOUND" | "ERROR";
  ledger?: number;                                     // ledger sequence number
  createdAt?: string;                                  // ISO-8601 timestamp
  sourceAccount?: string;                              // buyer's Stellar address
  amountMatch?: boolean;                               // present when `amount` param supplied
  reason?: string;                                     // human-readable failure reason
}
```

**Response codes:**
- `200 OK` — always used for pass/fail answers (check `valid` field).
- `400 Bad Request` — malformed query parameters.
- `502 Bad Gateway` — Horizon or Soroban RPC unreachable.

**Known limitation:** Full XDR decoding of `resultMetaXdr` to verify the
exact amount and contract function invoked requires `@stellar/stellar-sdk`
(Day 4 work).  When the `amount` query parameter is supplied, the response
returns `valid: false` with a `reason` explaining the limitation.

---

## Fulfill / Release

**x402 step:** After the service delivers the requested resource, the seller
(or the facilitator on their behalf) triggers `Escrow::release` to collect
payment.

### On-chain: `Escrow::release`

```rust
pub fn release(
    env: Env,
    buyer: Address,   // must match the buyer recorded at Escrow::lock time
    escrow_id: u64,   // returned by the original Escrow::lock call
)
```

The function:
- Asserts `record.buyer == buyer` (caller must be the recorded buyer).
- Asserts `record.status == EscrowStatus::Locked` (double-release is rejected).
- Transfers `record.amount` tokens from the Escrow contract to `record.seller`.
- Sets `record.status = EscrowStatus::Released`.
- Emits a `released` contract event: topics `["released", escrow_id]`, body `seller_address`.

### Backend endpoint: `POST /api/v1/marketplace/requests/:id/fulfill`

```
POST /api/v1/marketplace/requests/:id/fulfill
Content-Type: application/json

{
  "settleTxHash": "<stellar-tx-hash-of-Escrow::release>",   // optional
  "resultMeta": { "summary": "..." }                        // optional seller metadata
}
```

**Flow:**
1. Seller submits `Escrow::release` on-chain (signed by their key).
2. Seller (or facilitator) POSTs to this endpoint with the settlement tx hash.
3. Backend updates the request row from `locked` → `fulfilled` in Postgres.
4. The indexer independently detects the `released` event and writes it to the
   `events` table, which triggers a `Reputation::record_success` call (Day 4).

**Response 200:**
```json
{
  "request": {
    "id": "...",
    "status": "fulfilled",
    "settleTxHash": "...",
    "updatedAt": "..."
  }
}
```

**Error responses:**
- `404 Not Found` — request ID does not exist.
- `422 Unprocessable Entity` — request is not in `locked` state (already fulfilled or refunded).

### Reputation update: `Reputation::record_result`

After a successful fulfill, the reputation contract is updated via:

```rust
pub fn record_result(
    env: Env,
    subject: Address,  // the seller's address
    success: bool,     // true for a fulfill, false for a timeout/refund
)
```

This is a thin wrapper that delegates to `record_success` or `record_failure`:

```rust
pub fn record_success(env: Env, subject: Address)  // increments successes counter
pub fn record_failure(env: Env, subject: Address)  // increments failures counter
```

The indexer detects `released` / `refunded` events and triggers the appropriate
call.  The resulting trust score in basis points [0, 10 000] is readable via:

```rust
pub fn trust_score_bps(env: Env, subject: Address) -> u64
```

---

## Refund / Timeout

**x402 step:** If the seller does not fulfill the request before `timeout`, the
buyer may reclaim their funds.

### On-chain: `Escrow::refund`

```rust
pub fn refund(
    env: Env,
    buyer: Address,   // must match the buyer recorded at Escrow::lock time
    escrow_id: u64,
)
```

The function:
- Asserts `record.buyer == buyer`.
- Asserts `record.status == EscrowStatus::Locked`.
- Asserts `env.ledger().timestamp() >= record.timeout` (prevents early reclaim).
- Transfers `record.amount` tokens from the Escrow contract back to `record.buyer`.
- Sets `record.status = EscrowStatus::Refunded`.
- Emits a `refunded` event: topics `["refunded", escrow_id]`, body `buyer_address`.

The `timeout` value is set at lock time from the `timeout` field in the 402
payment terms.  The SDK surfaces a `refundAfter` date to the agent runtime so it
can schedule a retry or escalate to the user if delivery does not arrive.

**Reputation consequence:** The indexer detects the `refunded` event and calls
`Reputation::record_result(seller, false)`, decrementing the seller's trust score.

---

## Reputation Scoring

Reputation state is tracked per-address in the `Reputation` contract.

### Reading a score

```rust
pub fn get_score(env: Env, subject: Address) -> ReputationScore

pub struct ReputationScore {
    pub subject: Address,
    pub successes: u64,
    pub failures: u64,
}

pub fn trust_score_bps(env: Env, subject: Address) -> u64
// Returns successes * 10_000 / (successes + failures), or 0 if no history.
```

### Backend endpoint: `GET /api/v1/agents/:id/reputation`

`:id` is the agent's Stellar public key.

**Response 200:**
```json
{
  "subject": "GABC...",
  "successes": 42,
  "failures": 3,
  "total": 45,
  "trustScoreBps": 9333,
  "recentEvents": [
    {
      "id": "...",
      "contractId": "C...",
      "eventType": "success",
      "ledger": 12345678,
      "ledgerAt": "2025-01-01T00:00:00Z"
    }
  ]
}
```

The backend aggregates event counts from the Postgres `events` table (populated
by the indexer) rather than reading from the contract on every request, avoiding
a round-trip to Soroban RPC on each dashboard load.

---

## End-to-End Flow Summary

```
1. Seller  →  Marketplace::register_listing(name, token_addr, price_per_call, endpoint)
             → emits "listed" event → indexer writes to events table

2. Buyer   →  Marketplace::create_request(listing_id, timeout)
             → cross-contract: Escrow::lock(buyer, seller, token, amount, timeout)
             → emits "requested" + "locked" events
             → indexer records both; buyer's funds are held in Escrow

3. Service →  Receives request + escrow proof
             → Calls GET /api/v1/facilitator/verify?txHash=<lock_tx>
             → Backend confirms transaction success on Horizon/Soroban RPC
             → Service delivers the resource

4. Seller  →  Escrow::release(buyer, escrow_id)
             → funds transferred to seller
             → emits "released" event → indexer: Reputation::record_result(seller, true)

   OR (on timeout):

4. Buyer   →  Escrow::refund(buyer, escrow_id)   [after timeout]
             → funds returned to buyer
             → emits "refunded" event → indexer: Reputation::record_result(seller, false)

5. Anyone  →  GET /api/v1/agents/:seller/reputation
             → returns trust score derived from on-chain success/failure history
```
