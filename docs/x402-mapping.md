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

**Known limitation (Day 2):** Full XDR decoding of `resultMetaXdr` to verify the
exact amount and contract function invoked is deferred to Day 3 (requires
`@stellar/stellar-sdk`).  When the `amount` query parameter is supplied, the
response returns `valid: false` with a `reason` explaining the limitation.

---

## Fulfill / Release

**x402 step:** After the service delivers the requested resource, the seller
(or the facilitator on their behalf) calls `Escrow::release` to collect payment.

**Soroban contract call:** `Escrow::release`

```rust
pub fn release(
    env: Env,
    buyer: Address,   // must match the buyer recorded at lock time
    escrow_id: u64,   // returned by the original Escrow::lock call
)
```

The function:
- Asserts `record.status == Locked` (double-release is rejected).
- Transfers `amount` tokens from the Escrow contract to `record.seller`.
- Sets `record.status = Released`.
- Emits a `released` contract event (picked up by the indexer for reputation scoring).

**Backend route (Day 3):** `POST /api/v1/marketplace/requests/:id/fulfill`
calls `Escrow::release` on behalf of the seller using the facilitator's
signing key.

---

## Refund / Timeout

**x402 step:** If the seller does not fulfill the request before `timeout`, the
buyer may reclaim their funds by calling `Escrow::refund`.

**Soroban contract call:** `Escrow::refund`

```rust
pub fn refund(
    env: Env,
    buyer: Address,   // must match the buyer recorded at lock time
    escrow_id: u64,
)
```

The function:
- Asserts `record.status == Locked`.
- Asserts `env.ledger().timestamp() >= record.timeout` (prevents early reclaim).
- Transfers `amount` tokens from the Escrow contract back to `record.buyer`.
- Sets `record.status = Refunded`.
- Emits a `refunded` event.

The `timeout` value is set at lock time from the `timeout` field in the 402
payment terms.  The SDK surfaces a `refundAfter` date to the agent runtime so it
can schedule a retry or escalate to the user if delivery does not arrive.
